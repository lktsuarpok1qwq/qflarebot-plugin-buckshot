import type { PluginContext } from '@qqbot/sdk';
import { replayPrefix, REPLAY_ZONE } from './format.js';
import { REPLAY_FILE } from './access.js';

export function replayDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
        && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

export function replayDay(value: string, days: number): string {
    return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

// SDK 无游标；续读同日时跳过已读取的对象，日期间不重复读取。每次限制元数据和日期数量。
export async function listReplays(ctx: PluginContext, params: URLSearchParams): Promise<Response> {
    const start = params.get('start') ?? '', end = params.get('end') ?? '';

    if (!replayDate(start) || !replayDate(end) || start > end || Date.parse(end) - Date.parse(start) > 30 * 86400000) {
        return Response.json({ error: '请选择有效日期范围，最多 31 天' }, { status: 400 });
    }

    const skip = params.get('skip') ?? '';
    const skipped = new Set(skip ? skip.split(',') : []);

    if (skip.length > 341 || skipped.size > 31 || [...skipped].some(day => !replayDate(day) || day < start || day > end)) {
        return Response.json({ error: '已加载日期无效，请重新查询' }, { status: 400 });
    }

    let day = end, offset = 0, after = '';
    const cursor = params.get('cursor');

    if (cursor) {
        try {
            if (cursor.length > 4096) { throw Error(); }

            const saved = JSON.parse(cursor);

            if (saved.start !== start || saved.end !== end || saved.skip !== skip || !replayDate(saved.day) || saved.day < start || saved.day > end || !Number.isSafeInteger(saved.offset) || saved.offset < 0 || typeof saved.after !== 'string' || saved.after && !saved.after.startsWith(replayPrefix(ctx.botId) + saved.day + '/')) { throw Error(); }

            day = saved.day;
            offset = saved.offset;
            after = saved.after;
        } catch { return Response.json({ error: '续读位置无效，请重新查询' }, { status: 400 }); }
    }

    // 防止单次请求通过 SDK 自动翻页无限读取；超量仍保留未完成标记，不冒充完整列表。
    if (offset > 20000) { return Response.json({ error: '当天回放过多，已达到单日查询上限' }, { status: 400 }); }

    const items: { key: string; date: string; time: string; mode: string; gameId: string; size: number; daily: boolean }[] = [];
    let read = 0, scanned = 0;

    while (day >= start && read < 1000 && scanned < 8) {
        if (skipped.has(day)) {
            day = replayDay(day, -1);
            offset = 0;
            after = '';
            continue;
        }

        const prefix = replayPrefix(ctx.botId) + day + '/', remaining = 1000 - read;
        const objects = await ctx.r2.list(prefix, { limit: offset + remaining + 1 });
        const startIndex = after ? objects.findIndex(o => o.key > after) : 0;

        if (startIndex === -1 && objects.length === offset + remaining + 1) {
            offset += remaining;
            break;
        }

        const begin = startIndex < 0 ? objects.length : startIndex, batch = objects.slice(begin, begin + remaining);
        scanned++;
        read += batch.length;

        for (const object of batch) {
            if (!object.key.startsWith(prefix)) { continue; }

            const name = object.key.slice(prefix.length).match(REPLAY_FILE);

            if (name) { items.push({ key: object.key, date: day, time: `${name[1]}:${name[2]}:${name[3]}`, mode: name[4], gameId: name[5], size: object.size, daily: !!name[7] }); }
        }

        if (objects.length > begin + remaining || objects.length === offset + remaining + 1) {
            offset = begin + batch.length;
            after = batch.at(-1)!.key;
            break;
        }

        day = replayDay(day, -1);
        offset = 0;
        after = '';
    }

    const next = day >= start ? JSON.stringify({ start, end, day, offset, after, skip }) : null;

    return Response.json({ start, end, timezone: REPLAY_ZONE, items, complete: next === null, next }, { headers: { 'cache-control': 'private, no-store' } });
}
