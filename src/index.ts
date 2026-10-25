import { scopeFor } from './conversation.js';
import { DEFAULT_CONFIGURATION } from './templates/reply-config.js';
import { bindPreviousNavigation, deliver, renderMessage } from './templates/send.js';
import { ERROR_KEYS } from './templates/replies.js';
import type { ReplyConfiguration } from './templates/reply-config.js';
import { definePlugin } from '@qqbot/sdk';
import { BuckshotRoom } from './room/durable.js';
import { BuckshotPlayerRegistry } from './room/registry.js';
import { adminRoutes } from './admin/routes.js';
import { command, interact, operationId } from './integration/messages.js';
import { cron, drain, roomFor } from './integration/coordinator.js';
import { ensureDatabase, type RequestConfig } from './integration/database.js';

export { BuckshotRoom, BuckshotPlayerRegistry };

function failure(error: unknown, templates: ReplyConfiguration) { return renderMessage(templates, 'error', { values: { message: error instanceof Error ? ERROR_KEYS[error.message] ?? 'unknownError' : 'unknownError' } }); }

export default definePlugin({
    name: 'buckshot', displayName: '恶魔轮盘', description: '群聊单人及多人对局、私聊单人 AI', apiVersion: 4,
    permissions: ['db', 'durable', 'proactive', 'recall', 'admin'], depends: { 'points.wallet': 'optional' },
    configSchema: { type: 'object', properties: {} },
    durableObjects: { BuckshotRoom, BuckshotPlayerRegistry },
    commands: Object.fromEntries(['恶魔轮盘', '恶魔轮盘 状态', '恶魔轮盘 退出', '恶魔轮盘 帮助', '恶魔轮盘 历史', '恶魔轮盘 战绩', '恶魔轮盘 挑战'].map(name => [name, {
        description: name === '恶魔轮盘' ? '创建或操作恶魔轮盘房间' : name.slice(5), scenes: ['group', 'c2c'] as const,
        handler: async ({ ctx, session, argText }: import('@qqbot/sdk').CommandInput) => {
            const templates = DEFAULT_CONFIGURATION;

            const requestConfig: RequestConfig = {};
            let message;

            try { message = await command(ctx, session, [name.slice(5), argText].filter(Boolean).join(' '), templates, requestConfig); } catch (error) { message = failure(error, templates); }

            await deliver(ctx, session, message, requestConfig);
        }
    }])),
    buttons: {
        buckshot: async ({ ctx, session, interaction, buttonData }) => {
            const templates = DEFAULT_CONFIGURATION;

            const requestConfig: RequestConfig = {};
            let message;

            try {
                const input = JSON.parse(buttonData);

                // 仅确认收到按钮；游戏授权、落盘与资金结果仍由原业务流程确认。
                if (!interaction.acked) {
                    ctx.waitUntil(interaction.ack(0).then(ok => {
                        if (!ok) { ctx.logger.warn('按钮回执未确认', { code: 'ACK_NOT_CONFIRMED' }); }
                    }).catch(() => { ctx.logger.warn('按钮回执未确认', { code: 'ACK_EXCEPTION' }); }));
                }

                message = await interact(ctx, session, input, templates, requestConfig);

                if (input.navigation) { bindPreviousNavigation(message, input.navigation); }
            } catch (error) { message = failure(error, templates); }

            await deliver(ctx, session, message, requestConfig);
        }
    },
    events: {
        'qq.group.member_removed': async ({ ctx, session }) => {
            if (session.scene !== 'group' || !session.userId) { return; }

            const scope = scopeFor(session);
            await ensureDatabase(ctx);
            const active = await ctx.db.first('SELECT 1 FROM {rooms} WHERE bot=? AND group_id=? AND status<>?', ctx.botId, scope, 'CLOSED');

            if (!active) { return; }

            const changed = await roomFor(ctx, scope).systemEvent(await operationId(session), session.userId, session.timestamp);

            if (changed) { await drain(ctx, scope); }
        },
        'qq.group.robot_removed': async ({ ctx, session }) => {
            if (session.scene !== 'group') { return; }

            const scope = scopeFor(session);
            await ensureDatabase(ctx);
            const active = await ctx.db.first('SELECT 1 FROM {rooms} WHERE bot=? AND group_id=? AND status<>?', ctx.botId, scope, 'CLOSED');

            if (!active) { return; }

            const changed = await roomFor(ctx, scope).systemEvent(await operationId(session), null, session.timestamp);

            if (changed) { await drain(ctx, scope); }
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
