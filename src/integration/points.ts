import type { PluginContext } from '@qqbot/sdk';
import type { PointsService, OperationReceipt, Result } from 'qflarebot-plugin-points';
import type { MoneyTask, RoomState } from '../room/model.js';
import type { BuckshotRoom } from '../room/durable.js';
import { requireRule } from '../game/types.js';

export async function preflight(ctx: PluginContext, users: string[], stake: number): Promise<void> {
    if (!stake) { return; }

    const service = ctx.service<PointsService>('points.wallet');
    const policy = await service.getSourcePolicy({ source: 'buckshot' });
    requireRule(policy.ok && policy.data.registered && policy.data.enabled, 'Points 来源未授权');
    requireRule(policy.data.operationPermissions.includes('reserve') && policy.data.operationPermissions.includes('settle') && policy.data.operationPermissions.includes('release') && policy.data.operationPermissions.includes('renew'), 'Points 资金权限不完整');

    if (users.length === 1) {
        const result = await service.getBalance({ source: 'buckshot', userId: users[0] });
        requireRule(result.ok && result.data.status === 'active' && result.data.availableMinor >= stake, '账户未开通、暂停或余额不足');
    } else {
        const accounts = await service.checkAccounts({ source: 'buckshot', userIds: users });
        requireRule(accounts.ok && accounts.data.accounts.length === users.length && accounts.data.accounts.every(a => users.includes(a.userId) && a.exists), '有玩家尚未开通积分账户');
    }
}

export async function preflightChallenge(ctx: PluginContext, userId: string, amount: number): Promise<void> {
    if (!amount) { return; }

    const service = ctx.service<PointsService>('points.wallet');
    const policy = await service.getSourcePolicy({ source: 'buckshot' });
    requireRule(policy.ok && policy.data.registered && policy.data.enabled && policy.data.operationPermissions.includes('credit'), '每日挑战奖励未获 Points 发放授权');
    const account = await service.checkAccounts({ source: 'buckshot', userIds: [userId] });
    requireRule(account.ok && account.data.accounts.length === 1 && account.data.accounts[0].userId === userId && account.data.accounts[0].exists, '请先开通积分账户再参加有奖挑战');
}

async function execute(service: PointsService, task: MoneyTask, state: Pick<RoomState, 'gameId' | 'stake' | 'mode'>): Promise<Result<OperationReceipt>> {
    if (task.kind === 'reserve') {
        const input = task.input as Parameters<PointsService['reserveBundle']>[0];

        if (state.mode === 'solo') {
            const { funds, ...rest } = input;

            return service.reserve({ ...rest, ...funds[0] });
        }

        return service.reserveBundle(input);
    }

    if (task.kind === 'credit') { return service.credit(task.input as Parameters<PointsService['credit']>[0]); }

    if (task.kind === 'settle') { return service.settle(task.input as Parameters<PointsService['settle']>[0]); }

    if (task.kind === 'release') { return service.release(task.input as Parameters<PointsService['release']>[0]); }

    return service.renewReservation(task.input as Parameters<PointsService['renewReservation']>[0]);
}

export async function processMoney(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, state: Pick<RoomState, 'gameId' | 'stake' | 'mode'>): Promise<void> {
    const task = await room.claimMoney(state.gameId);

    if (!task) { return; }

    let outcome: 'DONE' | 'UNKNOWN' | 'FAILED' = 'UNKNOWN';

    try {
        const service = ctx.service<PointsService>('points.wallet');
        // 首次领取直接调用幂等方法；未知结果先核对原编号，NOT_FOUND 也只重用原参数。
        const lookup = task.state === 'PENDING' ? { ok: true as const, data: { status: 'NOT_FOUND' as const } } : await service.getOperation({ source: 'buckshot', operationId: task.id });

        if (lookup.ok && lookup.data.status === 'COMMITTED' && lookup.data.receipt.operationId === task.id) { outcome = 'DONE'; } else if (lookup.ok && lookup.data.status === 'REJECTED') { outcome = 'FAILED'; } else if (lookup.ok && lookup.data.status === 'NOT_FOUND') {
            let alreadyReturned = false;

            if (task.kind !== 'reserve' && task.kind !== 'credit') {
                const ids = task.kind === 'settle' ? (task.input as Parameters<PointsService['settle']>[0]).funds.map(f => f.reservationId) : [(task.input as { reservationId: string }).reservationId];
                const snapshot = await service.getReservations({ source: 'buckshot', reservationIds: ids });
                requireRule(snapshot.ok && snapshot.data.funds.length === ids.length && snapshot.data.funds.every(f => ids.includes(f.reservationId) && f.record?.referenceId === `buckshot:${state.gameId}` && f.record.amountMinor === state.stake), '预留状态无法确认');
                alreadyReturned = task.kind === 'renew' && snapshot.data.funds.every(f => !f.record?.effectiveActive && f.record?.status !== 'consumed') || task.kind === 'release' && snapshot.data.funds.every(f => f.record?.status === 'released' || f.record?.status === 'expired');

                if (!alreadyReturned && task.kind !== 'release') { requireRule(snapshot.data.funds.every(f => f.record?.effectiveActive), '本金已失效，禁止重新扣款'); }
            }

            if (alreadyReturned) {
                await room.moneyResult(state.gameId, task.id, task.lease!, 'DONE', 'Points 预留查询确认本金已退回或到期', 'inactive');

                return;
            }

            const result = await execute(service, task, state);

            if (result.ok && result.data.operationId === task.id) { outcome = 'DONE'; } else {
                const verified = await service.getOperation({ source: 'buckshot', operationId: task.id });

                if (verified.ok && verified.data.status === 'COMMITTED' && verified.data.receipt.operationId === task.id) { outcome = 'DONE'; } else if (verified.ok && verified.data.status === 'REJECTED') { outcome = 'FAILED'; }
            }
        }
    } catch { outcome = 'UNKNOWN'; }

    await room.moneyResult(state.gameId, task.id, task.lease!, outcome, outcome === 'DONE' ? `Points 操作 ${task.id} 已提交` : undefined);
}
