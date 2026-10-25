import type { PluginContext } from '@qqbot/sdk';
import type { BuckshotRoom } from '../room/durable.js';
import { targetFor } from '../conversation.js';

const running = new WeakMap<PluginContext, Map<string, { next: number | null }>>();

// 正常路径按秒清理，租约防止多个请求重复撤回；长等待和请求中断由 DO Alarm + 原 Cron 接续。
export function cleanupSoon(ctx: PluginContext, scope: string, due: number | null): void {
    if (due === null || due > Date.now() + 20000) { return; }

    let scopes = running.get(ctx);

    if (!scopes) {
        scopes = new Map();
        running.set(ctx, scopes);
    }

    const current = scopes.get(scope);

    if (current) {
        current.next = Math.min(current.next ?? Infinity, due);

        return;
    }

    const pending = { next: due as number | null }, stop = Date.now() + 22000, budget = { remaining: 24 };
    scopes.set(scope, pending);
    const job = (async () => {
        // 新回执可能在最后一批 ACK 和后台任务结束之间到达，保留这一唤醒，不丢给定时恢复。
        while (pending.next !== null && Date.now() <= stop && budget.remaining > 0) {
            const next = pending.next;
            pending.next = null;
            await cleanMessages(ctx, scope, next, stop, budget);
        }
    })().catch(() => {
        ctx.logger.warn('消息清理等待恢复', { code: 'RECALL_WORK_INTERRUPTED', scope: scope.slice(-6) });
    }).finally(() => { scopes!.delete(scope); });
    ctx.waitUntil(job);
}

export async function cleanMessages(ctx: PluginContext, scope: string, firstDue = Date.now(), stop = Date.now() + 22000, budget = { remaining: 24 }): Promise<void> {
    const room = ctx.durable.get<BuckshotRoom>('BuckshotRoom', `${ctx.botId}:${scope}`);
    let due: number | null = firstDue;

    while (budget.remaining > 0 && due !== null && due <= stop) {
        // 合并相差数毫秒的回执，不按微小到期差拆出大量 RPC。
        while (due + 25 > Date.now()) { await new Promise(resolve => setTimeout(resolve, due! + 25 - Date.now())); }

        const jobs = await room.claimRecalls(Math.min(12, budget.remaining));

        if (!jobs.length) { break; }

        budget.remaining -= jobs.length;
        const results = [];

        for (const job of jobs) {
            let ok = false, code = 'RECALL_NOT_CONFIRMED:SDK_FALSE';

            try { ok = await ctx.api.recallMessage(targetFor(job.target), job.messageId); } catch { code = 'RECALL_EXCEPTION:RESULT_UNKNOWN'; }

            if (!ok) {
                ctx.logger.warn('消息自动撤回未确认', { key: job.key, gameId: job.gameId, message: job.messageId.slice(-8), scene: targetFor(job.target).scene, code, attempts: job.attempts, terminal: job.attempts >= 3, announcementAgeMs: Math.max(0, Date.now() - job.sentAt) });
            }

            results.push({ messageId: job.messageId, target: job.target, lease: job.lease!, ok });
        }

        due = await room.recallsDone(results);
    }
}

export async function recoverMessages(ctx: PluginContext): Promise<void> {
    const rows = await ctx.db.all<{ id: string; expires_at: number }>('SELECT id,expires_at FROM {coord_ops} WHERE bot=? AND game_id=? AND state=? AND expires_at<=? ORDER BY expires_at LIMIT 8', ctx.botId, 'message-cleanup', 'CLEANUP', Date.now());

    const stop = Date.now() + 20000, budget = { remaining: 24 };

    for (const row of rows) {
        if (Date.now() >= stop || budget.remaining === 0) { break; }

        try {
            await cleanMessages(ctx, row.id, Date.now(), stop, budget);
            await ctx.db.run('DELETE FROM {coord_ops} WHERE bot=? AND game_id=? AND id=? AND expires_at=?', ctx.botId, 'message-cleanup', row.id, row.expires_at);
        } catch { ctx.logger.warn('消息清理等待下次恢复', { code: 'RECALL_RECOVERY_PENDING', scope: row.id.slice(-6) }); }
    }
}
