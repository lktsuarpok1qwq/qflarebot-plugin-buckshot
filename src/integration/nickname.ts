import type { PluginContext } from '@qqbot/sdk';
import type { BuckshotPlayerRegistry, BuckshotRoom } from '../room/durable.js';
import { cleanName, type AdmissionName } from '../room/names.js';

// 入场先完成；昵称只补充展示，不改变操作版本、时钟或资金身份，也不另发面板。
export function refreshName(ctx: PluginContext, room: DurableObjectStub<BuckshotRoom>, registry: DurableObjectStub<BuckshotPlayerRegistry>, input: { gameId: string; groupId: string; userId: string; claimId: string }, name: AdmissionName): void {
    if (!name.token) { return; }

    const token = name.token;
    ctx.waitUntil((async () => {
        const started = Date.now();
        let value = '', outcome = 'empty';

        try {
            try {
                const member = await ctx.api.group.member(input.groupId, input.userId);
                value = member?.member_openid === input.userId ? cleanName(member.username) : '';
                outcome = value ? 'found' : 'empty';
            } catch { outcome = 'unavailable'; }

            const saved = await registry.finishName(input.groupId, token, value);

            if (saved) { await room.updateName(input.gameId, input.userId, input.claimId, saved); }
        } catch { outcome = 'save_failed'; }

        ctx.logger.debug('入场昵称后台补充', { outcome, elapsedMs: Date.now() - started });
    })());
}
