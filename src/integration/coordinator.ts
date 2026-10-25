import { recoveryBatch } from './recovery.js';
import { cleanupSoon, recoverMessages } from '../templates/cleanup.js';
import { validateChallenge } from '../game/random.js';
import { targetFor, validateConversation } from '../conversation.js';
import { waitForTime } from '../templates/send.js';
import type { PluginContext, Session } from '@qqbot/sdk';
import type { BuckshotRoom } from '../room/durable.js';
import type { BuckshotPlayerRegistry } from '../room/registry.js';
import type { CreateInput, Request } from '../room/model.js';
import { identifier, payout, validateConfig } from '../config.js';
import { requireRule } from '../game/types.js';
import { processMoney } from './points.js';
import type { Action } from '../game/types.js';
import type { view } from '../room/state.js';
import { refreshName } from './nickname.js';
import type { AdmissionName } from '../room/names.js';

export function roomFor(ctx: PluginContext, group: string) {
    identifier(group);

    return ctx.durable.get<BuckshotRoom>('BuckshotRoom', `${ctx.botId}:${group}`);
}

export function registryFor(ctx: PluginContext, user: string) {
    return ctx.durable.get<BuckshotPlayerRegistry>('BuckshotPlayerRegistry', `${ctx.botId}:${user}`);
}

export async function coordinateCreate(ctx: PluginContext, input: CreateInput, eventName = input.member.name) {
    validateChallenge(input);
    validateConversation(input.groupId, input.mode, input.member.id);
    const room = roomFor(ctx, input.groupId), serialized = JSON.stringify(input);
    requireRule(!await room.isClosed(input.gameId), '创建编号已关闭');
    [input.botId, input.groupId, input.gameId, input.member.id, input.member.privateId].forEach(identifier);
    requireRule(input.botId === ctx.botId && ['solo', 'duo', 'multi'].includes(input.mode) && Number.isInteger(input.difficulty) && input.difficulty >= 0 && input.difficulty < 5, '创建参数无效');
    validateConfig(input.config.values);
    const cfg = input.config.values;
    requireRule(Number.isSafeInteger(input.stake) && input.stake >= 0 && (input.stake ? cfg.stakesEnabled && input.stake >= cfg.minStake && input.stake <= cfg.maxStake && (input.mode !== 'solo' || payout(input.stake, cfg.multipliers[input.difficulty]) <= 1e12 && payout(input.stake, cfg.multipliers[input.difficulty]) - input.stake <= cfg.rewardLimit) : cfg.freeEnabled), '下注范围或模式配置无效');
    const owner = await registryFor(ctx, input.member.id).owner();
    requireRule(!owner || owner.gameId === input.gameId && owner.groupId === input.groupId, '你已有尚未关闭的房间');
    const created = await ctx.db.first<{ game: string; intent: string }>('INSERT INTO {rooms}(bot,group_id,game,status,due,intent) VALUES(?,?,?,?,?,?) ON CONFLICT(bot,group_id) DO UPDATE SET game=excluded.game,status=excluded.status,due=excluded.due,revision=0,intent=excluded.intent WHERE {rooms}.status=? RETURNING game,intent', ctx.botId, input.groupId, input.gameId, 'CREATING', Date.now(), serialized, 'CLOSED');
    const saved = created ?? await ctx.db.first<{ game: string; intent: string }>('SELECT game,intent FROM {rooms} WHERE bot=? AND group_id=?', ctx.botId, input.groupId);
    requireRule(saved?.game === input.gameId && saved.intent === serialized, '本群已有房间或创建编号冲突');

    const registry = registryFor(ctx, input.member.id);
    let name: AdmissionName;

    try {
        name = await registry.claim({ botId: ctx.botId, userId: input.member.id, gameId: input.gameId, groupId: input.groupId, claimId: input.gameId, ...(input.challenge ? { challengeDate: input.challenge.date } : {}) }, eventName);
    } catch (error) {
        const actual = await registryFor(ctx, input.member.id).owner();

        if (actual && actual.gameId !== input.gameId || error instanceof Error && error.message === '今日挑战已使用，请明天再来') {
            await room.abandonCreation(input.gameId);
            await ctx.db.run('UPDATE {rooms} SET status=?,due=? WHERE bot=? AND group_id=? AND game=?', 'CLOSED', null, ctx.botId, input.groupId, input.gameId);
        }

        throw error;
    }

    const result = await room.create(input, name.value, name.value ? 0 : name.nextLookup ?? Date.now() + 30000, ctx.publicUrl);
    refreshName(ctx, room, registry, { gameId: input.gameId, groupId: input.groupId, userId: input.member.id, claimId: input.gameId }, name);
    await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'CREATE_ACCEPTED', ctx.botId, input.gameId, `create:${input.gameId}`);

    if (input.mode === 'solo') {
        await room.command({ gameId: input.gameId, expectedVersion: 1, actionId: `${input.gameId}:auto-start`, actor: input.member.id, action: { type: 'start' } });
    }

    return result;
}

export async function coordinateJoin(ctx: PluginContext, group: string, request: Request, eventName = '') {
    const started = Date.now();
    request = { ...request, action: request.action.type === 'join' ? { ...request.action, member: { ...request.action.member, claimId: request.actionId } } : request.action };
    const serialized = JSON.stringify({ group, request });
    const inserted = await ctx.db.run('INSERT OR IGNORE INTO {coord_ops}(bot,id,game_id,request,state) VALUES(?,?,?,?,?)', ctx.botId, request.actionId, request.gameId, serialized, 'PENDING');
    const prior = inserted.changes ? { request: serialized, state: 'PENDING' } : await ctx.db.first<{ request: string; state: string }>('SELECT request,state FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ctx.botId, request.gameId, request.actionId);
    requireRule(prior && prior.request === serialized, '加入编号冲突');
    requireRule(prior.state !== 'REJECTED', '该加入请求已拒绝，请查询状态后重新加入');
    const room = roomFor(ctx, group);

    // 已接受的原请求只返回状态，不能在离场后重新取得玩家占用。
    if (prior.state === 'DONE') { return room.publicState(); }

    if (!inserted.changes) {
        const accepted = await room.operation(request.gameId, request.actionId);

        if (accepted && !accepted.error) {
            await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'DONE', ctx.botId, request.gameId, request.actionId);

            return room.publicState();
        }
    }

    const registry = registryFor(ctx, request.actor);
    let name: AdmissionName;

    try {
        name = await registry.claim({ botId: ctx.botId, userId: request.actor, gameId: request.gameId, groupId: group, claimId: request.actionId }, eventName);
    } catch (error) {
        const owner = await registryFor(ctx, request.actor).owner();

        if (owner && (owner.gameId !== request.gameId || owner.claimId !== request.actionId)) {
            await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'REJECTED', ctx.botId, request.gameId, request.actionId);
        }

        throw error;
    }

    let result;

    const admittedAt = Date.now();

    try { result = await room.command(request, false, name.value, name.value ? 0 : name.nextLookup ?? Date.now() + 30000); } catch (error) {
        // 只有 Room 已持久化拒绝、且玩家未入房时才能补偿占用；未知结果留待恢复。
        const op = await room.operation(request.gameId, request.actionId);
        const state = await room.publicState();

        if (await room.isClosed(request.gameId) || op?.error && state?.gameId === request.gameId && !state.members.some(m => m.id === request.actor)) {
            await registryFor(ctx, request.actor).release(request.gameId, request.actionId);
            await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'REJECTED', ctx.botId, request.gameId, request.actionId);
        }

        throw error;
    }

    const roomMs = Date.now() - admittedAt;
    refreshName(ctx, room, registry, { gameId: request.gameId, groupId: group, userId: request.actor, claimId: request.actionId }, name);
    await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'DONE', ctx.botId, request.gameId, request.actionId);

    ctx.logger.debug('加入房间耗时', { coordinationMs: admittedAt - started, roomMs, totalMs: Date.now() - started });

    return result;
}

export interface DrainResult { room: ReturnType<typeof view> | null; moves: Action[]; panelHandled: boolean; continuing?: boolean }
interface DeliveryOptions { foreground?: boolean; budget?: { deadline: number; passiveReplies: number; remaining: number }; onComplete?: (result: DrainResult) => Promise<void> }

export async function drain(ctx: PluginContext, group: string, session?: Session, initial?: Awaited<ReturnType<BuckshotRoom['work']>>, deferWait = true, options: DeliveryOptions = {}): Promise<DrainResult> {
    const room = roomFor(ctx, group);
    // SDK 一次发送最多占用约 20 秒；8 秒后不再领取新任务，给宿主生命周期留出余量。
    const budget = options.budget ?? { deadline: Date.now() + 8000, passiveReplies: 0, remaining: 24 };
    const deadline = budget.deadline;
    let work = initial ?? await room.work(undefined, undefined, true, true, true);

    if (!work) { return { room: null, moves: [], panelHandled: false }; }

    for (const pending of work.pendingReleases) {
        await registryFor(ctx, pending.id).release(work.gameId, pending.claimId);
        await room.acknowledgeRelease(work.gameId, pending.id, pending.claimId);
    }

    if (work.moneyDue) {
        await processMoney(ctx, room, work);

        if (!work.task) { work = await room.work(work.gameId, undefined, Date.now() < deadline, true, true); }
    }

    if (work) { cleanupSoon(ctx, group, work.recallDue); }

    let panelHandled = false;

    // 前四条沿用事件凭据；连续行动余下消息使用已有的主动发送权限，给宿主返回值留一条被动额度。

    while (work && budget.remaining > 0) {
        if (!work.task && work.resumeAt !== undefined && work.resumeAt < deadline) {
            await waitForTime(work.resumeAt);
            work = await room.work(work.gameId, undefined, Date.now() < deadline, true, true);
        }

        if (!work?.task) {
            if (deferWait && work?.resumeAt !== undefined && work.resumeAt >= deadline) {
                const resumeAt = work.resumeAt, gameId = work.gameId;
                // 等待超出当前处理窗口时只接续一次，复用 SDK 后台生命周期，不轮询或递归延长。
                ctx.waitUntil((async () => {
                    await waitForTime(resumeAt);

                    try { await drain(ctx, group, undefined, await room.work(gameId, undefined, true, true, true), false); } catch { ctx.logger.warn('等待后接续未完成，等待持久化恢复', { gameId }); }
                })());
            }

            break;
        }

        const task = work.task;
        budget.remaining--;
        const target = task.private ? { scene: 'c2c' as const, id: task.target } : targetFor(task.target);
        const sameConversation = session?.scene === target.scene && session.targetId === target.id;
        let outcome: 'SENT' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN', messageId: string | undefined, errorCode: string | undefined, sentAt: number | undefined;

        try {
            if (task.kind === 'recall') {
                const ok = sameConversation ? await session!.recall(task.messageId) : await ctx.api.recallMessage(target, task.messageId!);
                outcome = ok ? 'SENT' : 'UNKNOWN';
                errorCode = ok ? undefined : 'RECALL_NOT_CONFIRMED:SDK_FALSE';
            } else {
                const rendered = task.payload!;
                const message = task.plain && typeof rendered !== 'string' ? rendered.text ?? task.text : rendered;
                const result = sameConversation && session!.canReply && budget.passiveReplies++ < 4
                    ? await session!.reply(message) : await ctx.api.sendMessage(target, message);
                sentAt = Date.now();
                messageId = result.messageId;
                errorCode = result.ok ? undefined : `HTTP_${result.status}:QQ_${result.code ?? 'NONE'}`;
                outcome = result.ok && !!messageId ? 'SENT' : result.status >= 400 && result.status < 500 ? 'FAILED' : 'UNKNOWN';

                if (task.panel) { panelHandled = true; }
            }
        } catch {
            outcome = 'UNKNOWN';
            errorCode = task.kind === 'recall' ? 'RECALL_EXCEPTION:RESULT_UNKNOWN' : 'SEND_EXCEPTION:RESULT_UNKNOWN';

            if (task.panel) { panelHandled = true; }
        }

        if (task.kind === 'recall' && outcome !== 'SENT') {
            ctx.logger.warn('装填公告撤回未确认', {
                gameId: work.gameId, taskId: task.id, loadId: task.loadId, attempts: task.attempts,
                code: errorCode, announcementAgeMs: task.announcementSentAt === undefined ? null : Math.max(0, Date.now() - task.announcementSentAt)
            });
        }

        work = await room.work(work.gameId, { id: task.id, lease: task.lease!, outcome, messageId, errorCode, sentAt }, budget.remaining > 0 && Date.now() < deadline, true, true);

        if (work) { cleanupSoon(ctx, group, work.recallDue); }

        if (options.foreground && outcome === 'SENT' && work && (work.task || work.resumeAt !== undefined || work.moneyDue || work.release.length || work.closeEmpty || work.pendingReleases.length)) {
            // 复用已经领取的下一任务、事件凭据和同一个时间预算，后台不重放动作、不增加轮询。
            const continuation = drain(ctx, group, session, work, deferWait, { budget }).then(result => options.onComplete?.(result)).catch(() => { ctx.logger.warn('消息后台续跑未完成，等待原任务恢复', { gameId: work!.gameId }); });
            ctx.waitUntil(continuation);

            return { room: work.room, moves: work.moves, panelHandled: true, continuing: true };
        }
    }

    if (work) {
        const released: string[] = [];

        try {
            for (const id of work.release) {
                const history = work.history ? (({ results, ...record }) => ({ ...record, ...(results[id] ? { result: results[id] } : {}) }))(work.history) : undefined;
                await registryFor(ctx, id).release(work.gameId, work.room!.members.find(m => m.id === id)?.claimId ?? work.gameId, history, !!work.room!.game);
                released.push(id);
            }
        } finally {
            // 只确认已成功释放的成员；中断后其余成员仍由原恢复路径处理。
            if (released.length || work.closeEmpty) { await room.markReleased(work.gameId, released); }
        }

        if (work.release.length || work.closeEmpty) { work = await room.work(work.gameId, undefined, false); }
    }

    return { room: work?.room ?? null, moves: work?.moves ?? [], panelHandled: panelHandled || !!work?.task || budget.remaining === 0 && !!work?.room?.tasks.length || !!work?.room?.tasks.some(t => t.state === 'UNKNOWN' || t.state === 'FAILED' || t.state === 'SENDING') };
}

export async function cron(ctx: PluginContext): Promise<void> {
    const stopAt = Date.now() + 20000;
    const batch = await recoveryBatch(ctx);
    ctx.waitUntil(recoverMessages(ctx, batch.cleanup));
    await ctx.db.run('DELETE FROM {coord_ops} WHERE rowid IN (SELECT rowid FROM {coord_ops} WHERE bot=? AND state IN (?,?) AND expires_at<=? LIMIT 20)', ctx.botId, 'CREATE_READY', 'NAVIGATION', Date.now());
    const pending = batch.joins;

    for (const row of pending) {
        const job = JSON.parse(row.request) as { group: string; request: Request };

        try { await coordinateJoin(ctx, job.group, job.request); } catch { ctx.logger.warn('加入协调等待恢复'); }
    }

    // 加入恢复可能产生新的房间待办，保持先恢复加入、再发现房间的顺序。
    const jobs = await ctx.db.all<{ group_id: string; status: string; intent: string; revision: number }>('SELECT group_id,status,intent,revision FROM {rooms} WHERE bot=? AND due<=? ORDER BY due LIMIT 8', ctx.botId, Date.now());

    for (const job of jobs) {
        if (Date.now() >= stopAt) { break; }

        try {
            if (job.status === 'CREATING') { await coordinateCreate(ctx, JSON.parse(job.intent) as CreateInput); }

            await drain(ctx, job.group_id);
        } catch {
            await ctx.db.run('UPDATE {rooms} SET due=? WHERE bot=? AND group_id=? AND revision=? AND due IS NOT NULL', Date.now() + 60000, ctx.botId, job.group_id, job.revision);
            ctx.logger.warn('轮盘协调任务未完成', { group: job.group_id.slice(-6) });
        }
    }
}
