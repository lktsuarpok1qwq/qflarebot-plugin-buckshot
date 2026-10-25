import { isPrivateScope } from '../conversation.js';
import type { PluginContext, Session } from '@qqbot/sdk';
import type { BuckshotRoom } from '../room/durable.js';
import type { BuckshotPlayerRegistry } from '../room/registry.js';
import { cleanName, type AdmissionName } from '../room/names.js';
import type { view } from '../room/state.js';

type Identity = { gameId: string; groupId: string; userId: string; claimId: string };

// 不记录昵称、完整 OpenID、错误正文或请求凭据。
function diagnostic(error: unknown) {
    const e = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; traceId?: unknown } : {};

    return { status: typeof e.status === 'number' ? e.status : undefined, code: typeof e.code === 'number' ? e.code : undefined, traceId: typeof e.traceId === 'string' ? e.traceId.slice(0, 128) : undefined };
}

async function lookupName(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, registry: DurableObjectStub<BuckshotPlayerRegistry>, input: Identity, name: AdmissionName): Promise<void> {
    if (!name.token) { return; }

    const started = Date.now();
    let value = '', outcome = 'empty', details = {};

    try {
        try {
            const member = await ctx.api.group.member(input.groupId, input.userId);
            const matches = member?.member_openid === input.userId;
            value = matches ? cleanName(member.username) : '';
            outcome = value ? 'found' : matches ? 'empty' : 'identity_mismatch';
        } catch (error) {
            outcome = 'unavailable';
            details = diagnostic(error);
        }

        const saved = await registry.finishName(input.groupId, name.token, value);

        if (saved !== null) {
            await room.updateName(input.gameId, input.userId, input.claimId, saved, saved ? 0 : Date.now() + 300000);
        }
    } catch (error) {
        outcome = 'save_failed';
        details = diagnostic(error);
    }

    const record = { outcome, ...details, gameId: input.gameId, elapsedMs: Date.now() - started };

    if (outcome === 'found') { ctx.logger.debug('入场昵称后台补充', record); } else { ctx.logger.warn('昵称补充未完成', record); }
}

export function refreshName(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, registry: DurableObjectStub<BuckshotPlayerRegistry>, input: Identity, name: AdmissionName): void {
    if (name.token) { ctx.waitUntil(lookupName(ctx, room, registry, input, name)); }
}

// 已有有效昵称不增加 RPC；缺名时复用当前请求已有的房间快照，按持久化期限补查。
export async function supplementName(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, state: ReturnType<typeof view>, session: Session): Promise<void> {
    const member = state.members.find(m => m.id === session.userId);

    if (!member || member.nameLookupAt === 0 || !['WAITING', 'PREPARING', 'PLAYING'].includes(state.status)) { return; }

    const eventName = cleanName(session.userName);

    if (isPrivateScope(state.groupId) && !eventName) { return; }

    if (!eventName && (member.nameLookupAt ?? 0) > Date.now()) { return; }

    const input = { gameId: state.gameId, groupId: state.groupId, userId: session.userId, claimId: member.claimId ?? state.gameId };
    const run = async () => {
        try {
            const registry = ctx.durable.get<BuckshotPlayerRegistry>('BuckshotPlayerRegistry', `${ctx.botId}:${session.userId}`);
            // 不能在旧面板或离场后重新占用房间。
            const name = await registry.nameForOwner({ botId: ctx.botId, ...input }, eventName);

            if (!name) { return; }

            const updated = await room.updateName(input.gameId, input.userId, input.claimId, name.value, name.nextLookup ?? Date.now() + 30000);

            if (updated && name.value) {
                member.name = name.value;
                member.nameLookupAt = 0;
                const player = state.game?.players.find(p => p.id === session.userId);

                if (player) { player.name = name.value; }
            }

            if (eventName) { refreshName(ctx, room, registry, input, name); } else { await lookupName(ctx, room, registry, input, name); }
        } catch (error) { ctx.logger.warn('昵称补充未完成', { outcome: 'coordination_failed', ...diagnostic(error), gameId: state.gameId }); }
    };

    // 事件补名只等待本地存储；无昵称的 SDK 补查始终不阻塞玩家操作。
    if (eventName) { await run(); } else { ctx.waitUntil(run()); }
}
