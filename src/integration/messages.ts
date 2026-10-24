import { renderMessage } from '../templates/send.js';
import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import type { ReplyConfiguration } from '../templates/reply-config.js';
import { type OutgoingMessage, type PluginContext, type Session } from '@qqbot/sdk';
import { requireRule, type Mode } from '../game/types.js';
import type { CreateInput, Request } from '../room/model.js';
import { base } from './panel.js';
import { ensureDatabase, readConfig } from './database.js';
import { coordinateCreate, coordinateJoin, drain, roomFor } from './coordinator.js';
import { preflight } from './points.js';
import { identifier } from '../config.js';
import { admissionName } from './nickname.js';
import { chooseCreation, prepareCreate } from './creation.js';

export async function operationId(session: Session): Promise<string> {
    requireRule(session.id || session.messageId, '缺少稳定事件编号');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${session.botId}:${session.id || session.messageId}`));

    return 'e' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function command(ctx: PluginContext, session: Session, text: string, settings?: ReplyConfiguration): Promise<OutgoingMessage | void> {
    const templates = settings ?? DEFAULT_CONFIGURATION;
    requireRule(session.scene === 'group', '游戏操作请在群内进行');
    const args = text.trim().split(/\s+/), action = args[0] || '';

    if (action === '帮助') { return renderMessage(templates, 'help'); }

    if (action === '新建') { return chooseCreation(ctx, session, args.slice(1), templates); }

    if (action === '创建') { return prepareCreate(ctx, session, args.slice(1), templates); }

    if (action === '确认创建') { return confirmCreate(ctx, session, args[1], templates); }

    if (action === '操作') {
        const [, gameId, version, name, target, slot, stolenTarget] = args;
        const state = ['射击', '道具'].includes(name) ? await roomFor(ctx, session.targetId).publicState() : null;
        const resolve = (value: string) => state?.game?.players[Number(value) - 1]?.id ?? value;
        let value: Request['action'];

        if (name === '射击') { value = { type: 'play', move: { type: 'shoot', target: resolve(target) } }; } else if (name === '道具') {
            value = { type: 'play', move: { type: 'item', slot: Number(target) - 1, ...(slot ? { target: resolve(slot) } : {}), ...(stolenTarget ? { stolenSlot: Number(stolenTarget) - 1 } : {}), ...(args[7] ? { stolenTarget: resolve(args[7]) } : {}) } };
        } else {
            const type = ({ 加入: 'join', 准备: 'ready', 开始: 'start', 退出: 'confirmQuit', 确认退出: 'quit' } as const)[name as '加入'];
            requireRule(type, '操作无效');
            value = { type } as Request['action'];
        }

        return interact(ctx, session, { gameId, expectedVersion: Number(version), action: value }, templates);
    }

    const current = await roomFor(ctx, session.targetId).publicState();

    if (!current || current.status === 'CLOSED') {
        return renderMessage(templates, 'lobby');
    }

    if (action === '退出') {
        return interact(ctx, session, { ...base(current), action: { type: current.status === 'WAITING' ? 'leave' : 'confirmQuit' } }, templates);
    }

    requireRule(action === '' || action === '状态', '未知操作，发送 /恶魔轮盘 帮助');

    return renderMessage(templates, 'panel', { room: current });
}

async function confirmCreate(ctx: PluginContext, session: Session, gameId: string, templates: ReplyConfiguration, expected?: { mode: Mode; stake: number; difficulty: number }): Promise<OutgoingMessage | void> {
    identifier(gameId);
    await operationId(session);
    await ensureDatabase(ctx);
    const room = roomFor(ctx, session.targetId);
    const issued = await ctx.db.first<{ request: string }>('SELECT request FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ctx.botId, gameId, `create:${gameId}`);
    requireRule(issued, '创建确认已失效');
    const authorization = JSON.parse(issued.request) as { input: CreateInput; expiresAt: number };
    const authorized = authorization.input;
    requireRule(authorized.member.id === session.userId && authorized.groupId === session.targetId && authorized.botId === ctx.botId && (!expected || authorized.mode === expected.mode && authorized.stake === expected.stake && authorized.difficulty === expected.difficulty), '创建确认身份或参数不符');
    const saved = await ctx.db.first<{ intent: string }>('SELECT intent FROM {rooms} WHERE bot=? AND group_id=? AND game=?', ctx.botId, session.targetId, gameId);
    const prior = saved ? JSON.parse(saved.intent) as CreateInput : null;
    requireRule(!prior || prior.member.id === session.userId && prior.mode === authorized.mode && prior.stake === authorized.stake && prior.difficulty === authorized.difficulty, '创建编号冲突');

    if (!prior) {
        requireRule(authorization.expiresAt > Date.now(), '创建确认已过期');
        const current = await readConfig(ctx, session.targetId);
        requireRule(current.globalVersion === authorized.config.globalVersion && current.groupVersion === authorized.config.groupVersion, '创建配置已更新，请重新选择');
        await preflight(ctx, [session.userId], authorized.stake);
    }

    const create = prior ?? { ...authorized, member: { ...authorized.member, name: await admissionName(ctx, gameId, `create:${gameId}`, session.targetId, session.userId, JSON.parse(issued.request)) } };
    await coordinateCreate(ctx, create);

    if (create.mode === 'solo') {
        await drain(ctx, session.targetId, session);

        return;
    }

    return renderMessage(templates, 'panel', { room: (await room.publicState())! });
}

export async function interact(ctx: PluginContext, session: Session, data: unknown, settings?: ReplyConfiguration): Promise<OutgoingMessage | void> {
    const templates = settings ?? DEFAULT_CONFIGURATION;
    requireRule(session.scene === 'group' && data && typeof data === 'object', '仅群内操作');
    const input = data as { setup?: unknown; create?: { mode: Mode; stake: number; difficulty: number }; owner?: string; gameId: string; expectedVersion: number; action?: Request['action']; menu?: number };

    if (input.setup !== undefined) {
        requireRule(Array.isArray(input.setup) && input.setup.length >= 2 && input.setup.length <= 4 && input.setup.every(v => typeof v === 'string' && v.length > 0 && !/\s/.test(v)) && ['新建', '创建'].includes(input.setup[0]), '创建参数无效，发送 /恶魔轮盘 帮助');

        return input.setup[0] === '新建' ? chooseCreation(ctx, session, input.setup.slice(1), templates) : prepareCreate(ctx, session, input.setup.slice(1), templates);
    }

    const room = roomFor(ctx, session.targetId);

    if (input.create) {
        requireRule(input.owner === session.userId, '仅创建者可确认');

        return confirmCreate(ctx, session, input.gameId, templates, input.create);
    }

    if (input.menu !== undefined) {
        requireRule(Number.isSafeInteger(input.menu) && input.menu >= 0, '分页无效');
        const snapshot = await room.menu(input.gameId, session.userId);
        const changed = snapshot.room.version !== input.expectedVersion;

        return renderMessage(templates, 'menu', { ...snapshot, offset: changed ? 0 : input.menu, actor: session.userId, notice: changed ? 'menuRefreshed' : undefined });
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

        try { await coordinateJoin(ctx, session.targetId, request); } catch (error) {
            if (!(error instanceof Error) || error.message !== '面板已更新，请查询状态') { throw error; }

            return renderMessage(templates, 'panel', { room: (await room.publicState())!, notice: 'staleAction' });
        }
    } else {
        if (request.action.type === 'start' && !await room.operation(input.gameId, actionId)) { await preflight(ctx, current!.members.map(p => p.id), current!.stake); }

        const result = await room.act(request);

        if (result.stale) { return renderMessage(templates, 'panel', { room: result.room!, notice: 'staleAction' }); }

        initial = result.work;
    }

    const sent = await drain(ctx, session.targetId, session, initial);
    const result = sent.room!;

    if (request.action.type === 'confirmQuit') {
        return renderMessage(templates, 'quit', { values: { gameId: result.gameId, version: String(result.version) }, dynamic: { confirmQuit: JSON.stringify({ ...base(result), action: { type: 'quit' } }) } });
    }

    if (!sent.panelHandled && request.action.type !== 'play' && request.action.type !== 'quit') { return renderMessage(templates, 'panel', { room: result }); }
}
