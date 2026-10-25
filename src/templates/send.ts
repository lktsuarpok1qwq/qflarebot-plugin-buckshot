import { cleanupSoon } from './cleanup.js';
import type { RecallReceipt } from '../room/recalls.js';
import { scopeFor } from '../conversation.js';
import { button, keyboard, type OutgoingMessage, type PluginContext, type Session } from '@qqbot/sdk';
import type { BuckshotRoom } from '../room/durable.js';
import type { PanelReference } from '../room/model.js';
import { DEFAULTS } from '../config.js';
import { readRequestConfig, type RequestConfig } from '../integration/database.js';
import type { ReplyConfiguration } from './reply-config.js';
import { createReplyPresentation, preparePresentation, replyPresentation, type MessageInput } from './presentation.js';
import { renderTemplate } from './replies.js';

const transient = new WeakSet<object>();
const navigation = new WeakMap<object, string>();
const previousNavigation = new WeakMap<object, string>();
const replyKeys = new WeakMap<object, string>();
const lifetimes = new WeakMap<object, Pick<RecallReceipt, 'kind' | 'until' | 'gameId' | 'version'>>();

export function bindPreviousNavigation(message: OutgoingMessage | void, id: unknown): void {
    if (message && typeof message === 'object' && typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id) && !['error', 'setupBlocked'].includes(replyKeys.get(message) ?? '')) { previousNavigation.set(message, id); }
}

const panels = new WeakMap<object, PanelReference>();
const recallDelays = new WeakMap<object, number>();

export function panelReference(message: OutgoingMessage): PanelReference | undefined { return typeof message === 'object' && message !== null ? panels.get(message) : undefined; }

export function keepMessage(message: OutgoingMessage): boolean { return typeof message !== 'object' || message === null || !transient.has(message); }

const plainPresentation = createReplyPresentation(renderTemplate, value => value);

export function renderMessage(config: ReplyConfiguration, key: string, input: MessageInput = {}): OutgoingMessage {
    input = { ...input, now: input.now ?? Date.now() };
    const prepared = preparePresentation(input);
    const result = replyPresentation.message(config, key, input, true, prepared);

    // QQ 会折叠空白行并把行首编号解析为列表；传输层保留可见排版，纯文本不带控制字符。
    const markdown = result.text.replace(/^(\d+)\. /gm, '$1\\. ').replace(/^---$/gm, '***').replace(/^$/gm, '\u200b');

    if (new TextEncoder().encode(markdown).length > replyPresentation.maxBytes || !result.text.trim()) { throw Error('消息展开后的正文为空或超出上限'); }

    if (result.buttons.length > 5 || result.buttons.some(row => row.length > 5 || row.some(b => [...b.label].length > 10))) { throw Error('消息按钮超出上限'); }

    const navigationId = ['lobby', 'setupMode', 'setupAmount', 'setupDifficulty', 'create', 'quit', 'close', 'aiRoster'].includes(key) ? crypto.randomUUID() : undefined;
    const commands: Record<string, string> = { daily: '/恶魔轮盘 挑战', help: '/恶魔轮盘 帮助', status: '/恶魔轮盘 状态', solo: '/恶魔轮盘 新建 单人', duo: '/恶魔轮盘 新建 双人', multi: '/恶魔轮盘 新建 多人' };
    // 复用命令按钮：只填入，不自动发送；从实际文案提取，不另查状态。
    const plain = plainPresentation.message(config, key, input, false, prepared).text;
    const drafts = [...new Set([...plain.matchAll(/\/恶魔轮盘(?: (?:帮助|状态|战绩|挑战|历史(?: \d+)?|确认创建 [a-f0-9-]{36}))?/g)].map(m => m[0]))];
    const existing = result.buttons.flat().map(b => b.data);
    const shortcuts = drafts.filter(data => !existing.includes(data)).map(data => ({ action: 'command' as const, label: data.startsWith('/恶魔轮盘 确认创建 ') ? '填入确认指令' : data.includes('历史 ') ? '下一页历史' : ({ 帮助: '查看帮助', 状态: '查看状态', 战绩: '个人战绩', 历史: '查看历史', 挑战: '每日挑战' }[data.split(' ')[1]] ?? '进入大厅'), data, enter: false }));

    if (!['panel', 'menu'].includes(key) && result.buttons.length < 5 && shortcuts.length) { result.buttons.push(shortcuts.slice(0, 5)); }

    const rows = result.buttons.map(row => row.map(b => {
        // 指令消息携带发送者身份与可用昵称，入场仍走原房间和版本校验。
        if (b.action === 'join' && input.room) {
            return button.command(b.label, `/恶魔轮盘 操作 ${input.room.gameId} ${input.room.version} 加入`, { enter: true });
        }

        const data = b.data ?? commands[b.action];

        if (['solo', 'duo', 'multi'].includes(b.action) || b.action === 'daily' && navigationId || b.action.startsWith('draft') && b.action !== 'draftAmount') {
            return button.callback(b.label, JSON.stringify({ setup: data.trim().split(/\s+/).slice(1), ...(navigationId ? { navigation: navigationId } : {}) }), { id: 'buckshot' });
        }

        const callbackData = data && navigationId && !['link', 'command', 'draftAmount'].includes(b.action) && !commands[b.action] ? JSON.stringify({ ...JSON.parse(data), navigation: navigationId }) : data;

        return b.action === 'link' ? button.link(b.label, data!) : b.action === 'command' || b.action === 'draftAmount' || commands[b.action] ? button.command(b.label, data!, { enter: b.enter }) : button.callback(b.label, callbackData!, { id: 'buckshot' });
    }));

    const outgoing = { text: plain, markdown: { content: markdown }, ...(rows.length ? { keyboard: keyboard(rows) } : {}) };

    if (input.room?.recallSeconds !== undefined) { recallDelays.set(outgoing, input.room.recallSeconds); }

    replyKeys.set(outgoing, key);

    if (navigationId) { navigation.set(outgoing, navigationId); }

    const permanent = ['matchCancelled', 'finish', 'noWinner', 'dailyRewardPaid', 'statistics', 'statisticsText', 'matchStatistics'];

    if (!permanent.includes(key) && !input.parts?.some(p => permanent.includes(p.key))) { transient.add(outgoing); }

    if (navigationId) {
        const kind = key === 'create' || key === 'quit' || key === 'close' || key === 'aiRoster' ? key : 'choice';
        lifetimes.set(outgoing, { kind, until: input.expiresAt ?? input.now! + (['quit', 'close'].includes(key) ? (input.room?.confirmSeconds ?? 30) * 1000 : 600000), gameId: input.room?.gameId ?? input.values?.gameId, version: input.room?.version });
    }

    if (input.room && !input.room.reading && !input.room.actionWaiting && ['WAITING', 'PREPARING', 'PLAYING'].includes(input.room.status) && (key === 'panel' || key === 'menu' && !input.reason)) {
        panels.set(outgoing, { gameId: input.room.gameId, version: input.room.version, status: input.room.status, order: String(Date.now()).padStart(16, '0') + ':' + crypto.randomUUID() });
        transient.delete(outgoing);
    }

    return outgoing;
}

export async function waitForTime(time: number): Promise<void> {
    while (Date.now() < time) { await new Promise(resolve => setTimeout(resolve, time - Date.now())); }
}

export async function deliver(ctx: PluginContext, session: Session, message: OutgoingMessage | void, request?: RequestConfig): Promise<void> {
    if (!message) { return; }

    const started = Date.now();
    const result = await session.reply(message);
    ctx.logger.debug('回复消息耗时', { elapsedMs: Date.now() - started, ok: result.ok });

    if (!['group', 'c2c'].includes(session.scene) || !result.ok || !result.messageId) { return; }

    const scope = scopeFor(session), panel = panelReference(message);

    if (!panel && keepMessage(message)) { return; }

    const object = typeof message === 'object' ? message : undefined;
    let seconds = object ? recallDelays.get(object) : undefined;

    if (seconds === undefined) {
        try { seconds = (await readRequestConfig(ctx, request)).values.recallSeconds; } catch {
            seconds = DEFAULTS.recallSeconds;
            ctx.logger.warn('撤回配置读取失败，使用默认等待时间', { code: 'RECALL_CONFIG_UNAVAILABLE' });
        }
    }

    const room = ctx.durable.get<BuckshotRoom>('BuckshotRoom', `${ctx.botId}:${scope}`);
    const receipt: RecallReceipt = {
        messageId: result.messageId, target: scope, key: object ? replyKeys.get(object) ?? 'message' : 'message', seconds, sentAt: Date.now(), owner: session.userId,
        ...(object ? lifetimes.get(object) : undefined), navigation: object ? navigation.get(object) : undefined, previous: object ? previousNavigation.get(object) : undefined
    };
    const save = async () => cleanupSoon(ctx, scope, await room.messageSent(ctx.botId, scope, receipt, panel ? { ...panel, messageId: result.messageId! } : undefined));

    try { await save(); } catch {
        ctx.logger.warn('消息回执保存等待重试', { key: receipt.key, gameId: receipt.gameId, code: 'MESSAGE_RECEIPT_PENDING' });
        ctx.waitUntil(save().catch(() => { ctx.logger.warn('消息回执未能保存', { key: receipt.key, gameId: receipt.gameId, code: 'MESSAGE_RECEIPT_UNKNOWN' }); }));
    }
}
