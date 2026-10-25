import { replayPublicKey } from './signing.js';
import { deleteReplay, validReplayKey } from './manage.js';
import { REPLAY_FILE as NAME } from './access.js';
import { replayPage } from './page.js';
import type { Route, RouteInput } from '@qqbot/sdk';
import { replayPrefix, REPLAY_ZONE } from './format.js';

export const replayRoutes: Route[] = [
    {
        method: 'GET', path: '/api/replay-key', auth: 'public', handler: async ({ ctx, request }) => {
            const key = await replayPublicKey(ctx.db, ctx.botId, new URL(request.url).searchParams.get('id') ?? '');

            return Response.json(key ?? { error: '签名来源不受当前服务信任' }, { status: key ? 200 : 404, headers: { 'cache-control': key ? 'public, max-age=86400, immutable' : 'no-store' } });
        }
    },
    { method: 'GET', path: '/replay/', auth: 'public', handler: () => new Response(replayPage, { headers: { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "sandbox allow-scripts allow-downloads allow-popups; default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } }) },
    {
        method: 'GET', path: '/api/replays', auth: 'admin', handler: async ({ ctx, request }) => {
            const date = new URL(request.url).searchParams.get('date') ?? '';

            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) { return Response.json({ error: '日期无效' }, { status: 400 }); }

            const prefix = replayPrefix(ctx.botId) + date + '/';
            const objects = await ctx.r2.list(prefix, { limit: 1001 });
            const items = objects.slice(0, 1000).flatMap(o => {
                if (!o.key.startsWith(prefix)) { return []; }

                const name = o.key.slice(prefix.length).match(NAME);

                return name ? [{ key: o.key, time: `${name[1]}:${name[2]}:${name[3]}`, mode: name[4], gameId: name[5], size: o.size }] : [];
            });

            return Response.json({ date, timezone: REPLAY_ZONE, items, complete: objects.length <= 1000 }, { headers: { 'cache-control': 'private, no-store' } });
        }
    },
    {
        method: 'POST', path: '/api/replay-delete', auth: 'admin', handler: async ({ ctx, request }) => {
            if (Number(request.headers.get('content-length')) > 4096) { return Response.json({ error: '请求过大' }, { status: 413 }); }

            const text = await request.text();

            if (new TextEncoder().encode(text).length > 4096) { return Response.json({ error: '请求过大' }, { status: 413 }); }

            let body;

            try { body = JSON.parse(text); } catch { return Response.json({ error: '请求无效' }, { status: 400 }); }

            if (!body || body.confirmed !== true || !validReplayKey(ctx.botId, body.key)) { return Response.json({ error: '回放或删除确认无效' }, { status: 400 }); }

            try {
                if (!await deleteReplay(ctx, body.key)) { return Response.json({ error: '该回放缺少安全删除所需的保存定位，未删除；不自动迁移旧回放' }, { status: 409 }); }

                return Response.json({ deleted: true, key: body.key });
            } catch { return Response.json({ error: '删除未确认，存储或回放保存协调暂不可用，请重试同一回放' }, { status: 409 }); }
        }
    },
    ...(['admin', 'public'] as const).map(auth => ({
        method: 'GET' as const, path: auth === 'admin' ? '/api/replay' : '/api/replay-shared', auth, handler: async ({ ctx, request }: RouteInput) => {
            const key = new URL(request.url).searchParams.get('key') ?? '';

            if (!validReplayKey(ctx.botId, key)) { return Response.json({ error: '回放文件无效' }, { status: 400 }); }

            const stream = await ctx.r2.getStream(key);

            return stream ? new Response(stream, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }) : Response.json({ error: '回放尚未保存、已删除或链接无效' }, { status: 404 });
        }
    }))
];
