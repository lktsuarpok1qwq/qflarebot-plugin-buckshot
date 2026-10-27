import { trackWebLink } from '../templates/send.js';
import { button, keyboard, type PluginContext, type Session, type OutgoingMessage } from '@qqbot/sdk';
import { registryFor, roomFor } from '../integration/coordinator.js';
import { eventName } from '../integration/nickname.js';
import { operationId } from '../integration/messages.js';
import { DEFAULT_REPLIES, renderTemplate, formatRoomId } from '../templates/replies.js';
import { requireRule } from '../game/types.js';

export async function claimWebLink(ctx: PluginContext, session: Session): Promise<OutgoingMessage | void> {
    if (session.scene !== 'c2c') { return { text: DEFAULT_REPLIES.webPrivate }; }

    try {
        const name = eventName(session), registry = registryFor(ctx, session.userId), owner = await registry.webOwner(name);
        requireRule(owner && owner.botId === ctx.botId, '当前没有可进入的网页对局');
        const base = ctx.publicUrl;
        requireRule(base && (/^https:\/\//.test(base) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)), '网页入口尚未配置 HTTPS 地址，请联系管理员');
        const room = roomFor(ctx, owner.groupId), event = await operationId(session);
        const { ticket, recallSeconds } = await room.webEntry(owner.gameId, session.userId, event, owner.claimId ?? owner.gameId, name);

        if (!ticket) { return; }

        const url = new URL('/p/buckshot/play/', base);
        url.hash = new URLSearchParams({ ticket }).toString();

        return trackWebLink({ text: renderTemplate(DEFAULT_REPLIES.webLink, { gameId: formatRoomId(owner.gameId), url: url.href }), markdown: { content: renderTemplate(DEFAULT_REPLIES.webLink, { gameId: formatRoomId(owner.gameId), url: url.href }) }, keyboard: keyboard([[button.command(DEFAULT_REPLIES.webClaim, '/恶魔轮盘 进入', { enter: false })]]) }, { scope: owner.groupId, gameId: owner.gameId, event, seconds: recallSeconds, until: Date.now() + 300000 });
    } catch (error) { return { text: error instanceof Error ? error.message : '领取失败，请稍后重试' }; }
}
