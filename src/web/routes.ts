import { readBody, rate } from './http.js';
import { serveAssets, type Route } from '@qqbot/sdk';
import { roomFor, drain } from '../integration/coordinator.js';
import { decodeLocator, digest, encodeLocator } from './access.js';
import { requireRule } from '../game/types.js';
import type { Request as RoomRequest } from '../room/model.js';
import { assets } from './assets.js';

const cookieName = 'buckshot_play';
const publicErrors = new Set(['入口已失效，请私聊重新领取', '入口无效', '入口已过期，请私聊重新领取', '入口已使用，请私聊重新领取', '会话已失效，请私聊重新领取', '你不在本局', '当前没有可进入的网页对局', '网页入场已到期', '对局已失效', '操作无效', '目标无效', '操作编号冲突', '请求过快，请稍后再试', '请求过快，请稍后重试', '请求繁忙，请稍后重试', '请求格式错误', '缺少请求', '请求过大', '需要 HTTPS', '请求来源不符', '操作编号无效', '兑换请求无效']);
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };

function origin(request: Request) {
    const url = new URL(request.url), local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    requireRule(url.protocol === 'https:' || local, '需要 HTTPS');
    const supplied = request.headers.get('origin');
    requireRule(supplied === url.origin || request.method === 'GET' && !request.headers.has('upgrade') && !supplied && request.headers.get('sec-fetch-site') === 'same-origin', '请求来源不符');
}

function cookie(request: Request, value: string, clear = false) {
    return `${cookieName}=${value}; Path=/p/buckshot/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 14400}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

const staticRoute = serveAssets('/play/*', assets, { auth: 'public' });
export const webRoutes: Route[] = [{
    ...staticRoute, handler: async input => {
        const response = await staticRoute.handler(input);
        response.headers.set('referrer-policy', 'no-referrer');

        if (response.headers.get('content-type')?.startsWith('text/html')) { response.headers.set('cache-control', 'no-store'); }

        response.headers.set('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://thirdqq.qlogo.cn; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");

        return response;
    }
}, ...(['redeem', 'ready', 'state', 'action', 'events', 'logout'] as const).map(kind => ({
    method: ['state', 'events'].includes(kind) ? 'GET' as const : 'POST' as const, path: '/api/web/' + kind,
    handler: async ({ ctx, request }: Parameters<NonNullable<Route['handler']>>[0]) => {
        try {
            origin(request);
            rate(request);
            const input = request.method === 'POST' ? await readBody(request, 4096, true) : {};
            const token = kind === 'redeem' ? input.ticket : request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
            const loc = decodeLocator(token), room = roomFor(ctx, loc.group);

            if (kind === 'redeem') {
                const key = await room.webRedeem(loc.game, loc.actor, loc.key, String(input.proof ?? ''));

                return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': cookie(request, encodeLocator(loc.group, loc.game, loc.actor, key)) } });
            }

            const hash = await digest(loc.key);

            if (kind === 'events') {
                return room.fetch(new Request(request.url, { headers: { Upgrade: 'websocket', 'x-game': loc.game, 'x-player': loc.actor, 'x-session': hash } }));
            }

            if (kind === 'logout') {
                await room.webLogout(loc.game, loc.actor, hash);

                return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': cookie(request, '', true) } });
            }

            if (kind === 'state') { return Response.json(await room.webSnapshot(loc.game, loc.actor, hash), { headers }); }

            let snapshot;

            if (kind === 'ready') { snapshot = await room.webReady(loc.game, loc.actor, hash); } else {
                requireRule(typeof input.id === 'string' && /^[a-f0-9-]{36}$/.test(input.id) && Number.isSafeInteger(input.version), '操作编号无效');
                snapshot = await room.webAction(loc.game, loc.actor, hash, input.id, input.version as number, input.action as RoomRequest['action']);
            }

            if (['PREPARING', 'FINISHED', 'SETTLING', 'SETTLED', 'CANCELLED'].includes(snapshot.status)) { ctx.waitUntil(drain(ctx, loc.group)); }

            return Response.json(snapshot, { headers });
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            const safe = publicErrors.has(message);

            return Response.json({ error: safe ? message : '请求未确认，请稍后重试' }, { status: safe ? 409 : 503, headers });
        }
    }
}))];
