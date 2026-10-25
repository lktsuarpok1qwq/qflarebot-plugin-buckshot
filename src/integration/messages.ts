import { personalText } from '../statistics/messages.js';
import { replayLink } from '../replay/access.js';
import { dateParts } from '../replay/format.js';
import { renderTemplate } from '../templates/replies.js';
import { scopeFor, validateConversation } from '../conversation.js';
import { deliver, renderMessage } from '../templates/send.js';
import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import type { ReplyConfiguration } from '../templates/reply-config.js';
import { type OutgoingMessage, type PluginContext, type Session } from '@qqbot/sdk';
import { requireRule, type Mode } from '../game/types.js';
import type { CreateInput, Request } from '../room/model.js';
import { eventName, supplementName } from './nickname.js';
import { base } from './panel.js';
import { ensureDatabase, readRequestConfig, type RequestConfig } from './database.js';
import { coordinateCreate, coordinateJoin, drain, roomFor, registryFor } from './coordinator.js';
import { preflight, preflightChallenge } from './points.js';
import { identifier } from '../config.js';
import { challengeDate } from '../game/random.js';
import { chooseCreation, prepareCreate, prepareChallenge } from './creation.js';

export async function operationId(session: Session): Promise<string> {
    requireRule(session.id || session.messageId, '缺少稳定事件编号');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${session.botId}:${session.id || session.messageId}`));

    return 'e' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function command(ctx: PluginContext, session: Session, text: string, settings?: ReplyConfiguration, requestConfig?: RequestConfig): Promise<OutgoingMessage | void> {
    const templates = settings ?? DEFAULT_CONFIGURATION;
    const scope = scopeFor(session);
    const args = text.trim().split(/\s+/), action = args[0] || '';

    if (action === '帮助') { return renderMessage(templates, 'help', { scene: session.scene as 'group' | 'c2c' }); }

    if (action === '战绩') {
        if (session.scene !== 'c2c') { return renderMessage(templates, 'statisticsPrivateOnly'); }

        return { text: personalText(await registryFor(ctx, session.userId).statistics()) };
    }

    if (action === '历史') {
        if (session.scene !== 'c2c') { return renderMessage(templates, 'historyPrivateOnly'); }

        const history = await registryFor(ctx, session.userId).replayHistory(args[1] === undefined ? undefined : Number(args[1]));
        const t = (key: string, values: Record<string, string> = {}) => renderTemplate(templates.replies[key], values);
        const modes: Record<string, string> = { solo: 'modeSolo', duo: 'modeDuo', multi: 'modeMulti' };
        const items = history.items.map(row => {
            const time = dateParts(row.created);

            return t('historyEntry', { time: time.date + ' ' + time.time, mode: t(modes[row.mode]), gameId: row.game, url: replayLink(row.object_key, ctx.publicUrl) });
        }).join('\n\n');

        return renderMessage(templates, 'history', { values: { items: items || t('historyEmpty'), next: history.next ? t('historyNext', { cursor: String(history.next) }) : '' } });
    }

    if (action === '挑战') { return prepareChallenge(ctx, session, args.slice(1), templates, requestConfig); }

    if (action === '新建') { return chooseCreation(ctx, session, args.slice(1), templates, requestConfig); }

    if (action === '创建') { return prepareCreate(ctx, session, args.slice(1), templates, undefined, requestConfig); }

    if (action === '确认创建') { return confirmCreate(ctx, session, args[1], templates, undefined, requestConfig); }

    if (action === '操作') {
        const [, gameId, version, name, target, slot, stolenTarget] = args;
        const state = ['射击', '道具'].includes(name) ? await roomFor(ctx, scope).publicState() : null;
        const resolve = (value: string) => state?.game?.players[Number(value) - 1]?.id ?? value;
        let value: Request['action'];

        if (name === '射击') { value = { type: 'play', move: { type: 'shoot', target: resolve(target) } }; } else if (name === '道具') {
            value = { type: 'play', move: { type: 'item', slot: Number(target) - 1, ...(slot ? { target: resolve(slot) } : {}), ...(stolenTarget ? { stolenSlot: Number(stolenTarget) - 1 } : {}), ...(args[7] ? { stolenTarget: resolve(args[7]) } : {}) } };
        } else {
            const type = ({ 加入: 'join', 准备: 'ready', 开始: 'start', 退出: 'confirmQuit', 确认退出: 'quit' } as const)[name as '加入'];
            requireRule(type, '操作无效');
            value = { type } as Request['action'];
        }

        return interact(ctx, session, { gameId, expectedVersion: Number(version), action: value }, templates, requestConfig);
    }

    const current = await roomFor(ctx, scope).publicState();

    if (!current || current.status === 'CLOSED') {
        if (eventName(session)) {
            try { await registryFor(ctx, session.userId).rememberName(scope, eventName(session)); } catch { ctx.logger.warn('入口昵称缓存未确认', { code: 'NAME_CACHE_UNAVAILABLE' }); }
        }

        return renderMessage(templates, 'lobby', { scene: session.scene as 'group' | 'c2c' });
    }

    if (action === '退出') {
        return interact(ctx, session, { ...base(current), action: { type: current.status === 'WAITING' ? 'leave' : 'confirmQuit' } }, templates, requestConfig);
    }

    requireRule(action === '' || action === '状态', '未知操作，发送 /恶魔轮盘 帮助');

    await supplementName(ctx, roomFor(ctx, scope), current, session);

    return renderMessage(templates, 'panel', { room: current });
}

async function confirmCreate(ctx: PluginContext, session: Session, gameId: string, templates: ReplyConfiguration, expected?: { mode: Mode; stake: number; difficulty: number }, requestConfig?: RequestConfig): Promise<OutgoingMessage | void> {
    const scope = scopeFor(session);
    identifier(gameId);
    await operationId(session);
    await ensureDatabase(ctx);
    const room = roomFor(ctx, scope);
    const issued = await ctx.db.first<{ request: string }>('SELECT request FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ctx.botId, gameId, `create:${gameId}`);
    requireRule(issued, '创建确认已失效');
    const authorization = JSON.parse(issued.request) as { input: CreateInput; expiresAt: number };
    const authorized = authorization.input;
    validateConversation(scope, authorized.mode, session.userId);
    requireRule(authorized.member.id === session.userId && authorized.groupId === scope && authorized.botId === ctx.botId && (!expected || authorized.mode === expected.mode && authorized.stake === expected.stake && authorized.difficulty === expected.difficulty), '创建确认身份或参数不符');
    const saved = await ctx.db.first<{ intent: string }>('SELECT intent FROM {rooms} WHERE bot=? AND group_id=? AND game=?', ctx.botId, scope, gameId);
    const prior = saved ? JSON.parse(saved.intent) as CreateInput : null;
    requireRule(!prior || prior.member.id === session.userId && prior.mode === authorized.mode && prior.stake === authorized.stake && prior.difficulty === authorized.difficulty, '创建编号冲突');

    if (!prior) {
        requireRule(authorization.expiresAt > Date.now(), '创建确认已过期');
        requireRule(!authorized.challenge || authorized.challenge.date === challengeDate(), '挑战日期已更新，请重新选择');
        const current = await readRequestConfig(ctx, requestConfig);
        requireRule(current.globalVersion === authorized.config.globalVersion, '创建配置已更新，请重新选择');
        await preflight(ctx, [session.userId], authorized.stake);

        if (authorized.challenge) { await preflightChallenge(ctx, session.userId, authorized.config.values.dailyReward); }
    }

    const create = prior ?? authorized;
    await coordinateCreate(ctx, create, eventName(session) || create.member.name);

    if (create.mode === 'solo') {
        await drain(ctx, scope, session, undefined, true, { foreground: true });

        return;
    }

    return renderMessage(templates, 'panel', { room: (await room.publicState())! });
}

export async function interact(ctx: PluginContext, session: Session, data: unknown, settings?: ReplyConfiguration, requestConfig?: RequestConfig): Promise<OutgoingMessage | void> {
    const templates = settings ?? DEFAULT_CONFIGURATION;
    const scope = scopeFor(session);
    requireRule(data && typeof data === 'object', '操作无效');
    const input = data as { setup?: unknown; create?: { mode: Mode; stake: number; difficulty: number }; owner?: string; gameId: string; expectedVersion: number; action?: Request['action']; menu?: number; path?: number[] };
    requireRule(session.scene !== 'c2c' || input.action?.type !== 'join', '私聊只支持单人对局');

    if (input.setup !== undefined) {
        requireRule(Array.isArray(input.setup) && input.setup.length >= 1 && input.setup.length <= 4 && input.setup.every(v => typeof v === 'string' && v.length > 0 && !/\s/.test(v)) && ['新建', '创建', '挑战'].includes(input.setup[0]), '创建参数无效，发送 /恶魔轮盘 帮助');

        return input.setup[0] === '挑战' ? prepareChallenge(ctx, session, input.setup.slice(1), templates, requestConfig) : input.setup[0] === '新建' ? chooseCreation(ctx, session, input.setup.slice(1), templates, requestConfig) : prepareCreate(ctx, session, input.setup.slice(1), templates, undefined, requestConfig);
    }

    const room = roomFor(ctx, scope);

    if (input.create) {
        requireRule(input.owner === session.userId, '仅创建者可确认');

        return confirmCreate(ctx, session, input.gameId, templates, input.create, requestConfig);
    }

    if (input.menu !== undefined) {
        requireRule(Number.isSafeInteger(input.menu) && input.menu >= 0, '分页无效');
        requireRule(input.path === undefined || Array.isArray(input.path) && input.path.length <= 3 && input.path.every(n => Number.isSafeInteger(n) && n >= 0 && n < 8), '操作无效');
        const snapshot = await room.menu(input.gameId, session.userId);
        await supplementName(ctx, room, snapshot.room, session);
        snapshot.name = snapshot.room.members.find(m => m.id === session.userId)?.name ?? snapshot.name;
        const changed = snapshot.room.version !== input.expectedVersion;

        return renderMessage(templates, 'menu', { ...snapshot, path: changed ? [] : input.path, offset: changed ? 0 : input.menu, actor: session.userId });
    }

    const actionId = await operationId(session);
    const needsState = input.action?.type === 'join' || input.action?.type === 'start';
    const current = needsState ? await room.publicState() : null;

    if (needsState) { requireRule(current && current.gameId === input.gameId, '房间已失效'); }

    requireRule(input.action, '操作无效');
    let request: Request = { gameId: input.gameId, expectedVersion: input.expectedVersion, actionId, actor: session.userId, action: input.action };

    let initial: Awaited<ReturnType<typeof room.work>> | undefined;

    if (request.action.type === 'join') {
        request = { ...request, action: { type: 'join', member: { id: session.userId, name: '', ready: false, privateId: session.userId } } };

        if (!await room.operation(input.gameId, actionId)) { await preflight(ctx, [session.userId], current!.stake); }

        try { await coordinateJoin(ctx, scope, request, eventName(session)); } catch (error) {
            if (!(error instanceof Error) || error.message !== '面板已更新，请查询状态') { throw error; }

            return renderMessage(templates, 'panel', { room: (await room.publicState())!, notice: 'staleAction' });
        }
    } else {
        if (request.action.type === 'start' && !await room.operation(input.gameId, actionId)) { await preflight(ctx, current!.members.map(p => p.id), current!.stake); }

        const result = await room.act(request);

        if (result.stale) {
            const snapshot = await room.menu(input.gameId, session.userId);
            await supplementName(ctx, room, snapshot.room, session);
            snapshot.name = snapshot.room.members.find(m => m.id === session.userId)?.name ?? snapshot.name;

            return renderMessage(templates, 'menu', { ...snapshot, actor: session.userId, notice: result.notice });
        }

        initial = result.work;
    }

    async function response(sent: import('./coordinator.js').DrainResult): Promise<OutgoingMessage | void> {
        const result = sent.room;

        if (!result) { return; }

        await supplementName(ctx, room, result, session);

        if (request.action.type === 'confirmQuit') {
            return renderMessage(templates, 'quit', { room: result, values: { gameId: result.gameId, version: String(result.version) }, dynamic: { confirmQuit: JSON.stringify({ ...base(result), action: { type: 'quit' } }) } });
        }

        if (request.action.type === 'play' && !sent.panelHandled && result.status === 'PLAYING' && !result.paused && !result.recovery && result.game?.current === session.userId) {
            return renderMessage(templates, 'menu', { room: result, moves: sent.moves, actor: session.userId });
        }

        if (!sent.panelHandled && request.action.type !== 'play' && request.action.type !== 'quit') { return renderMessage(templates, 'panel', { room: result }); }
    }

    const sent = await drain(ctx, scope, session, initial, true, {
        foreground: true, onComplete: async result => {
            if (request.action.type !== 'confirmQuit') { await deliver(ctx, session, await response(result), requestConfig); }
        }
    });

    if (sent.continuing && request.action.type !== 'confirmQuit') { return; }

    return response(sent);
}
