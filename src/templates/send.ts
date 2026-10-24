import { button, keyboard, type OutgoingMessage, type PluginContext, type Session } from '@qqbot/sdk';
import type { ReplyConfiguration } from './reply-config.js';
import { createReplyPresentation, replyPresentation, type MessageInput } from './presentation.js';
import { renderTemplate } from './replies.js';

const persistent = new WeakSet<object>();

export function keepMessage(message: OutgoingMessage): boolean { return typeof message === 'object' && message !== null && persistent.has(message); }

const plainPresentation = createReplyPresentation(renderTemplate, value => value);

export function renderMessage(config: ReplyConfiguration, key: string, input: MessageInput = {}): OutgoingMessage {
    input = { ...input, now: input.now ?? Date.now() };
    const result = replyPresentation.message(config, key, input);

    // QQ 会折叠空白行并把行首编号解析为列表；传输层保留可见排版，纯文本不带控制字符。
    const markdown = result.text.replace(/^(\d+)\. /gm, '$1\\. ').replace(/^---$/gm, '***').replace(/^$/gm, '\u200b');

    if (new TextEncoder().encode(markdown).length > replyPresentation.maxBytes || !result.text.trim()) { throw Error('消息展开后的正文为空或超出上限'); }

    if (result.buttons.length > 5 || result.buttons.some(row => row.length > 5 || row.some(b => [...b.label].length > 10))) { throw Error('消息按钮超出上限'); }

    const commands: Record<string, string> = { help: '/恶魔轮盘 帮助', status: '/恶魔轮盘 状态', solo: '/恶魔轮盘 新建 单人', duo: '/恶魔轮盘 新建 双人', multi: '/恶魔轮盘 新建 多人' };
    const rows = result.buttons.map(row => row.map(b => {
        const data = b.data ?? commands[b.action];

        if (['solo', 'duo', 'multi'].includes(b.action) || b.action.startsWith('draft') && b.action !== 'draftAmount') {
            return button.callback(b.label, JSON.stringify({ setup: data.trim().split(/\s+/).slice(1) }), { id: 'buckshot' });
        }

        return b.action === 'link' ? button.link(b.label, data!) : b.action === 'command' || b.action === 'draftAmount' || commands[b.action] ? button.command(b.label, data!, { enter: b.enter }) : button.callback(b.label, data!, { id: 'buckshot' });
    }));

    const plain = plainPresentation.message(config, key, input, false).text;

    const outgoing = { text: plain, markdown: { content: markdown }, ...(rows.length ? { keyboard: keyboard(rows) } : {}) };

    if ((key === 'menu' && rows.length > 0) || ['lobby', 'create', 'quit'].includes(key) || key.startsWith('setup') || key === 'panel' && input.room?.status === 'WAITING') { persistent.add(outgoing); }

    return outgoing;
}

export async function waitForTime(time: number): Promise<void> {
    while (Date.now() < time) { await new Promise(resolve => setTimeout(resolve, time - Date.now())); }
}

export function recallLater(ctx: PluginContext, group: string, messageId: string, details: { gameId?: string; taskId?: string; loadId?: number } = {}): void {
    const sentAt = Date.now();
    ctx.waitUntil((async () => {
        await waitForTime(sentAt + 5000);
        let code: string | undefined;

        try {
            if (!await ctx.api.recallMessage({ scene: 'group', id: group }, messageId)) { code = 'RECALL_NOT_CONFIRMED:SDK_FALSE'; }
        } catch { code = 'RECALL_EXCEPTION:RESULT_UNKNOWN'; }

        if (code) { ctx.logger.warn('群消息自动撤回未确认', { ...details, code, attempts: 1, announcementAgeMs: Math.max(0, Date.now() - sentAt) }); }
    })());
}

export async function deliver(ctx: PluginContext, session: Session, message: OutgoingMessage | void): Promise<void> {
    if (!message) { return; }

    const result = await session.reply(message);

    if (session.scene === 'group' && !keepMessage(message) && result.ok && result.messageId) { recallLater(ctx, session.targetId, result.messageId); }
}
