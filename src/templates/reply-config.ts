import { DEFAULT_REPLIES } from './replies.js';
import type { Replies } from './replies.js';

export const MESSAGE_KEYS = ['help', 'lobby', 'create', 'quit', 'panel', 'menu', 'load', 'eliminate', 'timeoutEliminate', 'finish', 'noWinner', 'intel', 'noIntel', 'reminder', 'error'] as const;
export type MessageKey = typeof MESSAGE_KEYS[number];
export const BUTTON_ACTIONS = { help: '玩法帮助', status: '查看状态', solo: '创建单人免费', duo: '创建双人免费', multi: '创建多人免费', command: '自定义命令', link: '打开链接', join: '加入本局', ready: '准备', start: '开始对局', choose: '查看合法操作', quit: '请求认输', confirmCreate: '确认创建', confirmQuit: '确认认输', next: '下一页操作', previous: '上一页操作', choice: '选择此操作' };
export type ButtonAction = keyof typeof BUTTON_ACTIONS;
export const DYNAMIC = ['join', 'ready', 'start', 'choose', 'quit', 'confirmCreate', 'confirmQuit', 'next', 'previous', 'choice'];
export interface ReplyButton { action: ButtonAction; label: string; data?: string; enter?: boolean }
export interface ReplyConfiguration { replies: Replies; buttons: Record<MessageKey, ReplyButton[][]>; historySeparator?: string }
const button = (action: ButtonAction, label: string): ReplyButton => ({ action, label, ...(DYNAMIC.includes(action) || action === 'link' ? {} : { enter: true }) });
export const DEFAULT_CONFIGURATION: ReplyConfiguration = { replies: DEFAULT_REPLIES, buttons: Object.fromEntries(MESSAGE_KEYS.map(key => [key, key === 'lobby' ? [[button('solo', '单人免费'), button('duo', '双人免费'), button('multi', '多人免费')]] : key === 'panel' ? [[button('join', '加入'), button('ready', '准备'), button('start', '开始')], [button('choose', '🎯 选择操作'), button('quit', '🏳️ 认输')], [button('status', '查看状态')]] : key === 'create' ? [[button('confirmCreate', '✅ 确认创建')]] : key === 'quit' ? [[button('confirmQuit', '确认认输')]] : key === 'menu' ? [[button('choice', '{{number}}')], [button('previous', '上一页'), button('next', '下一页')]] : []])) as ReplyConfiguration['buttons'] };
