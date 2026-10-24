import type { PluginContext, Session } from '@qqbot/sdk';
import { BuckshotRoom, BuckshotPlayerRegistry } from '../room/durable.js';
import type { CreateInput, Request } from '../room/model.js';
import { identifier, payout, validateConfig } from '../config.js';
import { requireRule } from '../game/types.js';
import { processMoney } from './points.js';
import { admissionName, type NicknameSnapshot } from './nickname.js';

export function roomFor(ctx: PluginContext, group: string) {
    identifier(group);

    return ctx.durable.get<BuckshotRoom>('BuckshotRoom', `${ctx.botId}:${group}`);
}

export function registryFor(ctx: PluginContext, user: string) {
    return ctx.durable.get<BuckshotPlayerRegistry>('BuckshotPlayerRegistry', `${ctx.botId}:${user}`);
}

export async function coordinateCreate(ctx: PluginContext, input: CreateInput) {
    const room = roomFor(ctx, input.groupId), serialized = JSON.stringify(input);
    requireRule(!await room.isClosed(input.gameId), '创建编号已关闭');
    [input.botId, input.groupId, input.gameId, input.member.id, input.member.privateId].forEach(identifier);
    requireRule(input.botId === ctx.botId && ['solo', 'duo', 'multi'].includes(input.mode) && Number.isInteger(input.difficulty) && input.difficulty >= 0 && input.difficulty < 5, '创建参数无效');
    validateConfig(input.config.values);
    const cfg = input.config.values;
    requireRule(Number.isSafeInteger(input.stake) && input.stake >= 0 && (input.stake ? cfg.stakesEnabled && cfg.calibrated && input.stake >= cfg.minStake && input.stake <= cfg.maxStake && (input.mode !== 'solo' || payout(input.stake, cfg.multipliers[input.difficulty]) <= 1e12 && payout(input.stake, cfg.multipliers[input.difficulty]) - input.stake <= cfg.rewardLimit) : cfg.freeEnabled), '下注范围或模式配置无效');
    const owner = await registryFor(ctx, input.member.id).owner();
    requireRule(!owner || owner.gameId === input.gameId && owner.groupId === input.groupId, '你已有尚未关闭的房间');
    await ctx.db.run('INSERT INTO {rooms}(bot,group_id,game,status,due,intent) VALUES(?,?,?,?,?,?) ON CONFLICT(bot,group_id) DO UPDATE SET game=excluded.game,status=excluded.status,due=excluded.due,revision=0,intent=excluded.intent WHERE {rooms}.status=?', ctx.botId, input.groupId, input.gameId, 'CREATING', Date.now(), serialized, 'CLOSED');
    const saved = await ctx.db.first<{ game: string; intent: string }>('SELECT game,intent FROM {rooms} WHERE bot=? AND group_id=?', ctx.botId, input.groupId);
    requireRule(saved?.game === input.gameId && saved.intent === serialized, '本群已有房间或创建编号冲突');

    try {
        await registryFor(ctx, input.member.id).claim({ botId: ctx.botId, userId: input.member.id, gameId: input.gameId, groupId: input.groupId, claimId: input.gameId });
    } catch (error) {
        const actual = await registryFor(ctx, input.member.id).owner();

        if (actual && actual.gameId !== input.gameId) {
            await room.abandonCreation(input.gameId);
            await ctx.db.run('UPDATE {rooms} SET status=?,due=? WHERE bot=? AND group_id=? AND game=?', 'CLOSED', null, ctx.botId, input.groupId, input.gameId);
        }

        throw error;
    }

    const result = await room.create(input);
    await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'CREATE_ACCEPTED', ctx.botId, input.gameId, `create:${input.gameId}`);

    if (input.mode === 'solo') {
        await room.command({ gameId: input.gameId, expectedVersion: 1, actionId: `${input.gameId}:auto-start`, actor: input.member.id, action: { type: 'start' } });
    }

    return result;
}

export async function coordinateJoin(ctx: PluginContext, group: string, request: Request) {
    request = { ...request, action: request.action.type === 'join' ? { ...request.action, member: { ...request.action.member, claimId: request.actionId } } : request.action };
    const serialized = JSON.stringify({ group, request });
    await ctx.db.run('INSERT OR IGNORE INTO {coord_ops}(bot,id,game_id,request,state) VALUES(?,?,?,?,?)', ctx.botId, request.actionId, request.gameId, serialized, 'PENDING');
    const prior = await ctx.db.first<{ request: string; state: string }>('SELECT request,state FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ctx.botId, request.gameId, request.actionId);
    const saved = prior ? JSON.parse(prior.request) as { group: string; request: Request } & NicknameSnapshot : null;
    requireRule(prior && saved && JSON.stringify({ group: saved.group, request: saved.request }) === serialized, '加入编号冲突');
    requireRule(prior.state !== 'REJECTED', '该加入请求已拒绝，请查询状态后重新加入');

    try {
        await registryFor(ctx, request.actor).claim({ botId: ctx.botId, userId: request.actor, gameId: request.gameId, groupId: group, claimId: request.actionId });
    } catch (error) {
        const owner = await registryFor(ctx, request.actor).owner();

        if (owner && (owner.gameId !== request.gameId || owner.claimId !== request.actionId)) {
            await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'REJECTED', ctx.botId, request.gameId, request.actionId);
        }

        throw error;
    }

    if (request.action.type === 'join') {
        const name = await admissionName(ctx, request.gameId, request.actionId, group, request.actor, saved);
        request = { ...request, action: { ...request.action, member: { ...request.action.member, name } } };
    }

    const room = roomFor(ctx, group);
    let result;

    try { result = await room.command(request); } catch (error) {
        // 只有 Room 已持久化拒绝、且玩家未入房时才能补偿占用；未知结果留待恢复。
        const op = await room.operation(request.gameId, request.actionId);
        const state = await room.publicState();

        if (await room.isClosed(request.gameId) || op?.error && state?.gameId === request.gameId && !state.members.some(m => m.id === request.actor)) {
            await registryFor(ctx, request.actor).release(request.gameId, request.actionId);
            await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'REJECTED', ctx.botId, request.gameId, request.actionId);
        }

        throw error;
    }

    await ctx.db.run('UPDATE {coord_ops} SET state=? WHERE bot=? AND game_id=? AND id=?', 'DONE', ctx.botId, request.gameId, request.actionId);

    return result;
}

export async function drain(ctx: PluginContext, group: string, session?: Session, initial?: Awaited<ReturnType<BuckshotRoom['work']>>) {
    const room = roomFor(ctx, group);
    // SDK 一次发送最多占用约 20 秒；8 秒后不再领取新任务，给宿主生命周期留出余量。
    const deadline = Date.now() + 8000;
    let work = initial ?? await room.work(undefined, undefined, true, true);

    if (!work) { return { room: null, panelHandled: false }; }

    for (const pending of work.pendingReleases) {
        await registryFor(ctx, pending.id).release(work.gameId, pending.claimId);
        await room.acknowledgeRelease(work.gameId, pending.id, pending.claimId);
    }

    if (work.moneyDue) {
        await processMoney(ctx, room, work);

        if (!work.task) { work = await room.work(work.gameId, undefined, Date.now() < deadline, true); }
    }

    let panelHandled = false, passiveReplies = 0;

    // 前四条沿用事件凭据；连续行动余下消息使用已有的主动发送权限，给宿主返回值留一条被动额度。

    for (let i = 0; work?.task && i < 24; i++) {
        const task = work.task;
        let outcome: 'SENT' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN', messageId: string | undefined, errorCode: string | undefined;

        try {
            if (task.kind === 'recall') {
                const ok = session?.scene === 'group' && session.targetId === group ? await session.recall(task.messageId) : await ctx.api.recallMessage({ scene: 'group', id: group }, task.messageId!);
                outcome = ok ? 'SENT' : 'UNKNOWN';
                errorCode = ok ? undefined : 'RECALL_NOT_CONFIRMED:SDK_FALSE';
            } else {
                const rendered = task.payload!;
                const message = task.plain && typeof rendered !== 'string' ? rendered.text ?? task.text : rendered;
                const result = !task.private && session?.scene === 'group' && session.targetId === group && session.canReply && passiveReplies++ < 4
                    ? await session.reply(message) : await ctx.api.sendMessage({ scene: task.private ? 'c2c' : 'group', id: task.target }, message);
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

        work = await room.work(work.gameId, { id: task.id, lease: task.lease!, outcome, messageId, errorCode }, i < 23 && Date.now() < deadline, true);
    }

    if (work) {
        for (const id of work.release) {
            await registryFor(ctx, id).release(work.gameId);
            await room.markReleased(work.gameId, id);
        }

        if (work.closeEmpty) { await room.markReleased(work.gameId, ''); }

        if (work.release.length || work.closeEmpty) { work = await room.work(work.gameId, undefined, false); }
    }

    return { room: work?.room ?? null, panelHandled: panelHandled || !!work?.room.tasks.some(t => t.state === 'UNKNOWN' || t.state === 'FAILED' || t.state === 'SENDING') };
}

export async function cron(ctx: PluginContext): Promise<void> {
    const stopAt = Date.now() + 20000;
    await ctx.db.run('DELETE FROM {coord_ops} WHERE rowid IN (SELECT rowid FROM {coord_ops} WHERE bot=? AND state=? AND expires_at<=? LIMIT 20)', ctx.botId, 'CREATE_READY', Date.now());
    const pending = await ctx.db.all<{ request: string }>('SELECT request FROM {coord_ops} WHERE bot=? AND state=? LIMIT 4', ctx.botId, 'PENDING');

    for (const row of pending) {
        const job = JSON.parse(row.request) as { group: string; request: Request };

        try { await coordinateJoin(ctx, job.group, job.request); } catch { ctx.logger.warn('加入协调等待恢复'); }
    }

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
