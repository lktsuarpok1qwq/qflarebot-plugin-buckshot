import type { PluginContext } from '@qqbot/sdk';
import type { BuckshotRoom } from '../room/durable.js';
import { REPLAY_FILE } from './access.js';
import { replayPrefix } from './format.js';

export function validReplayKey(bot: string, key: unknown): key is string {
    if (typeof key !== 'string' || key.length > 1024) { return false; }

    const prefix = replayPrefix(bot), rest = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    const date = rest.slice(0, 10);

    return /^\d{4}-\d{2}-\d{2}\//.test(rest) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date && REPLAY_FILE.test(rest.slice(11));
}

export async function deleteReplay(ctx: PluginContext, key: string): Promise<boolean> {
    const object = await ctx.r2.head(key);

    // 不猜测旧对象的归档所有者，避免无法取消的旧任务重新发布。
    if (!object) { return true; }

    const owner = object.metadata?.room;

    if (!owner || !/^[a-f0-9]{64}$/.test(owner)) { return false; }

    const rooms = ctx.durable.namespace<BuckshotRoom>('BuckshotRoom');
    await rooms.get(rooms.idFromString(owner)).deleteReplay(key);

    return true;
}
