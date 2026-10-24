import { button, keyboard, type OutgoingMessage } from '@qqbot/sdk';
import type { ReplyConfiguration } from './reply-config.js';
import { createReplyPresentation, replyPresentation, type MessageInput } from './presentation.js';
import { REPLY_FIELDS, renderTemplate } from './replies.js';

const plainPresentation = createReplyPresentation(renderTemplate, value => value, REPLY_FIELDS);

export function renderMessage(config: ReplyConfiguration, key: string, input: MessageInput = {}): OutgoingMessage {
    const result = replyPresentation.message(config, key, input);

    if (new TextEncoder().encode(result.text).length > replyPresentation.maxBytes || !result.text.trim()) { throw Error('消息展开后的正文为空或超出上限'); }

    if (result.buttons.length > 5 || result.buttons.some(row => row.length > 5 || row.some(b => [...b.label].length > 10))) { throw Error('消息按钮超出上限'); }

    const commands: Record<string, string> = { help: '/恶魔轮盘 帮助', status: '/恶魔轮盘 状态', solo: '/恶魔轮盘 创建 单人 免费 普通', duo: '/恶魔轮盘 创建 双人 免费', multi: '/恶魔轮盘 创建 多人 免费' };
    const rows = result.buttons.map(row => row.map(b => b.action === 'link' ? button.link(b.label, b.data!) : b.action === 'command' || commands[b.action] ? button.command(b.label, b.data ?? commands[b.action], { enter: b.enter }) : button.callback(b.label, b.data!, { id: 'buckshot' })));

    const plain = plainPresentation.message(config, key, input).text;

    return { text: plain, markdown: { content: result.text }, ...(rows.length ? { keyboard: keyboard(rows) } : {}) };
}
