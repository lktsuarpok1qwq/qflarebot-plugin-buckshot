import { loadTemplates } from './templates/settings.js';
import { renderMessage } from './templates/send.js';
import { ERROR_KEYS } from './templates/replies.js';
import type { ReplyConfiguration } from './templates/reply-config.js';
import { definePlugin } from '@qqbot/sdk';
import { BuckshotRoom, BuckshotPlayerRegistry } from './room/durable.js';
import { adminRoutes } from './admin/routes.js';
import { command, interact, operationId } from './integration/messages.js';
import { cron, drain, roomFor } from './integration/coordinator.js';
import { ensureDatabase } from './integration/database.js';

export { BuckshotRoom, BuckshotPlayerRegistry };

function failure(error: unknown, templates: ReplyConfiguration) { return renderMessage(templates, 'error', { values: { message: error instanceof Error ? ERROR_KEYS[error.message] ?? 'unknownError' : 'unknownError' } }); }

export default definePlugin({
    name: 'buckshot', displayName: '恶魔轮盘', description: '单人 AI、双人及多人群聊对局', apiVersion: 4,
    permissions: ['db', 'durable', 'proactive', 'recall', 'admin'], depends: { 'points.wallet': 'optional' },
    configSchema: { type: 'object', properties: {} },
    durableObjects: { BuckshotRoom, BuckshotPlayerRegistry },
    commands: Object.fromEntries(['恶魔轮盘', '恶魔轮盘 状态', '恶魔轮盘 退出', '恶魔轮盘 帮助'].map(name => [name, {
        description: name === '恶魔轮盘' ? '创建或操作恶魔轮盘房间' : name.slice(5), scenes: ['group'] as const,
        handler: async ({ ctx, session, argText }: import('@qqbot/sdk').CommandInput) => {
            const templates = await loadTemplates(ctx);

            try { return await command(ctx, session, [name.slice(5), argText].filter(Boolean).join(' '), templates); } catch (error) { return failure(error, templates); }
        }
    }])),
    buttons: {
        buckshot: async ({ ctx, session, buttonData }) => {
            const templates = await loadTemplates(ctx);

            try { return await interact(ctx, session, JSON.parse(buttonData), templates); } catch (error) { return failure(error, templates); }
        }
    },
    events: {
        'qq.group.member_removed': async ({ ctx, session }) => {
            if (session.scene !== 'group' || !session.userId) { return; }

            await ensureDatabase(ctx);
            const active = await ctx.db.first('SELECT 1 FROM {rooms} WHERE bot=? AND group_id=? AND status<>?', ctx.botId, session.targetId, 'CLOSED');

            if (!active) { return; }

            const changed = await roomFor(ctx, session.targetId).systemEvent(await operationId(session), session.userId, session.timestamp);

            if (changed) { await drain(ctx, session.targetId); }
        },
        'qq.group.robot_removed': async ({ ctx, session }) => {
            if (session.scene !== 'group') { return; }

            await ensureDatabase(ctx);
            const active = await ctx.db.first('SELECT 1 FROM {rooms} WHERE bot=? AND group_id=? AND status<>?', ctx.botId, session.targetId, 'CLOSED');

            if (!active) { return; }

            const changed = await roomFor(ctx, session.targetId).systemEvent(await operationId(session), null, session.timestamp);

            if (changed) { await drain(ctx, session.targetId); }
        }
    },
    cron: {
        'buckshot-work': {
            cron: '* * * * *', handler: async ({ ctx }) => {
                await ensureDatabase(ctx);
                await cron(ctx);
            }
        }
    },
    ui: { path: '/ui/', title: '恶魔轮盘', icon: 'crosshair' }, routes: adminRoutes
});
