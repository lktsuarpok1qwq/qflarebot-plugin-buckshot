import { statisticsRoutes } from '../statistics/routes.js';
import { replayRoutes } from '../replay/routes.js';
import type { Route } from '@qqbot/sdk';
import type { PointsService } from 'qflarebot-plugin-points';
import { identifier } from '../config.js';
import { requireRule } from '../game/types.js';
import type { Request } from '../room/model.js';
import { configView, ensureDatabase, saveConfig } from '../integration/database.js';
import { drain, registryFor, roomFor } from '../integration/coordinator.js';
import { page } from './page.js';
import { decodeAdminConfig } from './multipliers.js';

async function body(request: globalThis.Request, maxBytes = 16384): Promise<Record<string, unknown>> {
    const text = await request.text();
    requireRule(new TextEncoder().encode(text).length <= maxBytes, '请求过大');
    const value = JSON.parse(text);
    requireRule(value && typeof value === 'object' && !Array.isArray(value), '请求格式错误');

    return value;
}

const routes: Route[] = [
    ...replayRoutes,
    ...statisticsRoutes,
    { method: 'GET', path: '/ui/', auth: 'admin', handler: () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }) },
    {
        method: 'GET', path: '/api/config', auth: 'admin', handler: async ({ ctx, request }) => {
            requireRule(!new URL(request.url).searchParams.size, '配置不支持分组查询');

            return Response.json(await configView(ctx));
        }
    },
    {
        method: 'POST', path: '/api/config', auth: 'admin', handler: async ({ ctx, request }) => {
            const input = await body(request) as Parameters<typeof saveConfig>[1];

            return Response.json(await saveConfig(ctx, { ...input, value: decodeAdminConfig(input.value) }));
        }
    },
    {
        method: 'GET', path: '/api/operation', auth: 'admin', handler: async ({ ctx, request }) => {
            const id = new URL(request.url).searchParams.get('id');
            identifier(id);
            const row = await ctx.db.first<{ result: string }>('SELECT result FROM {config_ops} WHERE bot=? AND id=?', ctx.botId, id);

            const result = row ? JSON.parse(row.result) : null;

            return Response.json(result ? { status: result.status === 'REJECTED' ? 'REJECTED' : 'DONE', result } : { status: 'NOT_FOUND' });
        }
    },
    {
        method: 'GET', path: '/api/rooms', auth: 'admin', handler: async ({ ctx, request }) => {
            const after = new URL(request.url).searchParams.get('after') || '';
            const rows = await ctx.db.all<{ group_id: string; game: string; status: string }>('SELECT group_id,game,status FROM {rooms} WHERE bot=? AND group_id>? AND status<>\'CLOSED\' ORDER BY group_id LIMIT 21', ctx.botId, after);

            return Response.json({ items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].group_id : null, observedAt: Date.now(), complete: false });
        }
    },
    {
        method: 'GET', path: '/api/room', auth: 'admin', handler: async ({ ctx, request }) => {
            const group = new URL(request.url).searchParams.get('group');
            identifier(group);

            return Response.json({ group, room: await roomFor(ctx, group).publicState() });
        }
    },
    {
        method: 'GET', path: '/api/room-operation', auth: 'admin', handler: async ({ ctx, request }) => {
            const params = new URL(request.url).searchParams;
            const group = params.get('group'), gameId = params.get('game'), operationId = params.get('id');
            identifier(group);
            identifier(gameId);
            identifier(operationId);

            return Response.json({ group, gameId, operationId, ...await roomFor(ctx, group).operationState(gameId, operationId) });
        }
    },
    {
        method: 'POST', path: '/api/room', auth: 'admin', handler: async ({ ctx, request }) => {
            const input = await body(request);
            identifier(input.group);
            const command = input.command as Request;
            requireRule(command && ['pause', 'resume', 'cancel', 'retry', 'reconcile'].includes(command.action?.type), '管理操作无效');
            const room = roomFor(ctx, input.group);
            await room.command({ ...command, actor: 'admin' }, true);
            await drain(ctx, input.group);

            return Response.json({ group: input.group, operationId: command.actionId, gameId: command.gameId, status: 'DONE', room: await room.publicState() });
        }
    },
    {
        method: 'POST', path: '/api/occupancy', auth: 'admin', handler: async ({ ctx, request }) => {
            const input = await body(request);
            identifier(input.userId);
            const registry = registryFor(ctx, input.userId), owner = await registry.owner();

            if (input.release) {
                requireRule(owner, '没有占用');
                requireRule(await roomFor(ctx, owner.groupId).safeToRelease(owner.gameId, input.userId), '房间尚未安全关闭或玩家仍在房间');
                await registry.release(owner.gameId, owner.claimId);
            }

            return Response.json({ userId: input.userId, owner: input.release ? null : owner });
        }
    },
    {
        method: 'POST', path: '/api/points', auth: 'admin', handler: async ({ ctx, request }) => {
            const input = await body(request), service = ctx.service<PointsService>('points.wallet');
            requireRule(input.action === 'register' || input.action === 'query', '操作无效');

            if (input.action === 'register') { return Response.json(await service.registerSource({ source: 'buckshot' })); }

            return Response.json(await service.getSourcePolicy({ source: 'buckshot' }));
        }
    }
];
export const adminRoutes: Route[] = routes.map(route => ({
    ...route, handler: async input => {
        if (route.path === '/ui/' || route.path === '/replay/') { return route.handler(input); }

        try {
            if (!['/api/replay-key', '/api/replays', '/api/replay', '/api/replay-shared', '/api/room', '/api/room-operation', '/api/occupancy', '/api/points', '/api/player-statistics'].includes(route.path)) { await ensureDatabase(input.ctx); }

            return await route.handler(input);
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '操作未完成' }, { status: 409 }); }
    }
}));
