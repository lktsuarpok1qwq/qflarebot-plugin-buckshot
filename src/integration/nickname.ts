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

// 仅使用 SDK 已解析的身份字段，不从消息正文或按钮参数猜测昵称。
export function eventName(session: Session, userId = session.userId): string {
    const own = userId === session.userId ? cleanName(session.userName) : '';

    return own || cleanName(session.mentions?.find(m => !m.bot && m.id === userId)?.username);
}

// 复用已有快照；只为缺名的本局玩家补缓存，不监听全群消息或逐人查询。
export async function supplementName(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, state: ReturnType<typeof view>, session: Session): Promise<void> {
    if (!['WAITING', 'WEB_JOINING', 'PREPARING', 'PLAYING'].includes(state.status)) { return; }

    for (const member of state.members) {
        if (member.nameLookupAt === 0) { continue; }

        const fresh = eventName(session, member.id);

        if (state.web && !fresh) { continue; }

        if (!fresh && (member.id !== session.userId || isPrivateScope(state.groupId) || (member.nameLookupAt ?? 0) > Date.now())) { continue; }

        const input = { gameId: state.gameId, groupId: state.groupId, userId: member.id, claimId: member.claimId ?? state.gameId };
        const run = async () => {
            try {
                const registry = ctx.durable.get<BuckshotPlayerRegistry>('BuckshotPlayerRegistry', `${ctx.botId}:${member.id}`);
                // 原占用与入场编号必须仍有效，旧面板不能复活占用。
                const name = await registry.nameForOwner({ botId: ctx.botId, ...input }, fresh);

                if (!name) { return; }

                const updated = await room.updateName(input.gameId, input.userId, input.claimId, name.value, name.nextLookup ?? Date.now() + 30000);

                if (updated && name.value) {
                    member.name = name.value;
                    member.nameLookupAt = 0;
                    const player = state.game?.players.find(p => p.id === member.id);

                    if (player) { player.name = name.value; }
                }

                if (state.web) { return; }

                if (fresh) { refreshName(ctx, room, registry, input, name); } else { await lookupName(ctx, room, registry, input, name); }
            } catch (error) { ctx.logger.warn('昵称补充未完成', { outcome: 'coordination_failed', ...diagnostic(error), gameId: state.gameId }); }
        };

        // 事件补名只等待本地存储；SDK 查询不阻塞操作。
        if (fresh) { await run(); } else { ctx.waitUntil(run()); }
    }
}
