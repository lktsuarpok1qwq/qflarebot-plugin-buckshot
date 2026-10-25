import { personalText } from './messages.js';
import type { Route } from '@qqbot/sdk';
import { registryFor } from '../integration/coordinator.js';
import { identifier } from '../config.js';
import { COUNTS, MONEY } from './model.js';

export function statisticsRange(from: string, to: string) {
    const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

    if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) { throw Error('请选择有效日期，范围最多 31 天'); }

    return { from, to };
}

export const statisticsRoutes: Route[] = [
    {
        method: 'GET', path: '/api/statistics', auth: 'admin', handler: async ({ ctx, request }) => {
            try {
                const q = new URL(request.url).searchParams, range = statisticsRange(q.get('from') ?? '', q.get('to') ?? '');
                const rows = await ctx.db.all(`SELECT day,mode,kind,paid,difficulty,${COUNTS.join(',')},${MONEY.map(k => `CAST(${k} AS TEXT) AS ${k}`).join(',')} FROM {stats_daily} WHERE bot=? AND day>=? AND day<=? ORDER BY day,mode,kind,paid,difficulty`, ctx.botId, range.from, range.to);

                return Response.json({ ...range, timezone: 'Asia/Shanghai', rows, observedAt: Date.now(), basis: '安全关闭日；已确认的轮盘原结算，不代表余额，后续纠错以 Points 流水为准' }, { headers: { 'cache-control': 'private,no-store' } });
            } catch (e) { return Response.json({ error: e instanceof Error ? e.message : '统计查询未完成' }, { status: 400 }); }
        }
    },
    {
        method: 'GET', path: '/api/player-statistics', auth: 'admin', handler: async ({ ctx, request }) => {
            const user = new URL(request.url).searchParams.get('user');
            identifier(user);
            const data = await registryFor(ctx, user).statistics();

            return Response.json({ ...data, text: personalText(data) }, { headers: { 'cache-control': 'private,no-store' } });
        }
    }
];
