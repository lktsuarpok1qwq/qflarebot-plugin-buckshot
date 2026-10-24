import type { PluginContext } from '@qqbot/sdk';
import { requireRule } from '../game/types.js';

interface Lookup { started: number; value?: string }
export interface NicknameSnapshot { nickname?: Lookup }

// 复用入场协调记录领取一次查询；请求中断后使用默认名，不重新请求 QQ。
export async function admissionName(ctx: PluginContext, gameId: string, id: string, group: string, user: string, saved: NicknameSnapshot): Promise<string> {
    const key = [ctx.botId, gameId, id];
    let lookup = saved.nickname;

    if (!lookup) {
        const started = Date.now();
        const claim = await ctx.db.run("UPDATE {coord_ops} SET request=json_set(request,'$.nickname',json(?)) WHERE bot=? AND game_id=? AND id=? AND json_type(request,'$.nickname') IS NULL", JSON.stringify({ started }), ...key);

        if (claim.changes) {
            let value = '';

            try {
                const member = await ctx.api.group.member(group, user);

                if (member.member_openid === user && typeof member.username === 'string') { value = member.username.replace(/[\r\n<>\[\](){}`]/g, '').trim().slice(0, 24); }
            } catch {
                // 权限、限流及网络错误均只影响展示名，不影响入场或资金身份。
            }

            const stored = await ctx.db.run("UPDATE {coord_ops} SET request=json_set(request,'$.nickname.value',?) WHERE bot=? AND game_id=? AND id=? AND json_extract(request,'$.nickname.started')=? AND json_type(request,'$.nickname.value') IS NULL", value, ...key, started);

            if (stored.changes) { return value; }
        }

        const row = await ctx.db.first<{ request: string }>('SELECT request FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ...key);
        lookup = row ? (JSON.parse(row.request) as { nickname?: Lookup }).nickname : undefined;
    }

    requireRule(lookup, '入场记录已失效');

    if (lookup.value !== undefined) { return lookup.value; }

    requireRule(Date.now() - lookup.started >= 30000, '入场昵称查询中，请稍后重试');
    await ctx.db.run("UPDATE {coord_ops} SET request=json_set(request,'$.nickname.value','') WHERE bot=? AND game_id=? AND id=? AND json_type(request,'$.nickname.value') IS NULL", ...key);
    const row = await ctx.db.first<{ request: string }>('SELECT request FROM {coord_ops} WHERE bot=? AND game_id=? AND id=?', ...key);
    requireRule(row, '入场记录已失效');

    return (JSON.parse(row.request) as { nickname: Lookup }).nickname.value!;
}
