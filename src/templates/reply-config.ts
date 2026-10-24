import { DEFAULT_REPLIES, REPLY_FIELDS, templateError } from './replies.js';
import type { Replies, ReplyKey } from './replies.js';
import { replyPresentation } from './presentation.js';

export const MESSAGE_KEYS = ['help', 'lobby', 'create', 'quit', 'panel', 'menu', 'load', 'eliminate', 'timeoutEliminate', 'finish', 'noWinner', 'intel', 'noIntel', 'reminder', 'error'] as const;
export type MessageKey = typeof MESSAGE_KEYS[number];
export const BUTTON_ACTIONS = { help: '玩法帮助', status: '查看状态', solo: '创建单人免费', duo: '创建双人免费', multi: '创建多人免费', command: '自定义命令', link: '打开链接', join: '加入本局', ready: '准备', start: '开始对局', choose: '查看合法操作', quit: '请求认输', confirmCreate: '确认创建', confirmQuit: '确认认输', next: '下一页操作', choice: '选择此操作' };
export type ButtonAction = keyof typeof BUTTON_ACTIONS;
export const DYNAMIC = ['join', 'ready', 'start', 'choose', 'quit', 'confirmCreate', 'confirmQuit', 'next', 'choice'];
export const REQUIRED: Record<string, string[]> = { create: ['confirmCreate'], quit: ['confirmQuit'], panel: ['join', 'ready', 'start', 'choose', 'quit'], menu: ['choice', 'next'] };
export const BUTTON_ACTION_HELP = Object.fromEntries(Object.entries(BUTTON_ACTIONS).map(([key, label]) => [key, DYNAMIC.includes(key) ? label + '；动作必须保留一个，仅适用状态显示；身份与操作凭据由程序生成' : label + '；仅执行所选功能，不替换动态凭据']));
export interface ReplyButton { action: ButtonAction; label: string; data?: string; enter?: boolean }
export interface ReplyConfiguration { replies: Replies; buttons: Record<MessageKey, ReplyButton[][]>; historySeparator?: string }
const button = (action: ButtonAction, label: string): ReplyButton => ({ action, label, ...(DYNAMIC.includes(action) || action === 'link' ? {} : { enter: true }) });
export const DEFAULT_CONFIGURATION: ReplyConfiguration = { replies: DEFAULT_REPLIES, buttons: Object.fromEntries(MESSAGE_KEYS.map(key => [key, key === 'lobby' ? [[button('solo', '单人免费'), button('duo', '双人免费'), button('multi', '多人免费')]] : key === 'panel' ? [[button('join', '加入'), button('ready', '准备'), button('start', '开始')], [button('choose', '🎯 选择操作'), button('quit', '🏳️ 认输')], [button('status', '查看状态')]] : key === 'create' ? [[button('confirmCreate', '✅ 确认创建')]] : key === 'quit' ? [[button('confirmQuit', '确认认输')]] : key === 'menu' ? [[button('choice', '选择 {{number}}')], [button('next', '下一页')]] : []])) as ReplyConfiguration['buttons'] };
export interface ConfigurationError {
    field: ReplyKey;
    target: 'text' | 'buttons' | 'historySeparator';
    message: string;
    row?: number;
    item?: number;
    control?: 'label' | 'action' | 'data' | 'enter';
    start: number;
    end: number;
}

// 只接收明确的配置结构，浏览器和保存端共用；不接受脚本或动态凭据。
export function configurationError(value: unknown, selected?: ReplyKey): ConfigurationError | null {
    const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
    const exact = (v: unknown, keys: readonly string[]) => object(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
    const problem = (field: ReplyKey, target: ConfigurationError['target'], message: string): ConfigurationError => ({ field, target, message, start: 0, end: 0 });

    if (!exact(value, object(value) && Object.hasOwn(value, 'historySeparator') ? ['replies', 'buttons', 'historySeparator'] : ['replies', 'buttons'])) { return problem('help', 'text', '模板配置结构不符合要求'); }

    const config = value as unknown as ReplyConfiguration;

    if (Object.hasOwn(config, 'historySeparator') && (typeof config.historySeparator !== 'string'
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(config.historySeparator)
        || templateError('x' + config.historySeparator, [], [])
        || new TextEncoder().encode(config.historySeparator).length > 4096)) {
        return problem('panel', 'historySeparator', '项目间隔最多4096字节，不接受变量或控制字符；留空表示直接连接');
    }

    if (!exact(config.replies, Object.keys(REPLY_FIELDS)) || !exact(config.buttons, MESSAGE_KEYS)) {
        return problem('help', 'text', '请提交全部正文和按钮配置');
    }

    for (const key of (Object.keys(REPLY_FIELDS) as ReplyKey[]).filter(key => selected === undefined || key === selected)) {
        const field = REPLY_FIELDS[key];

        if (typeof config.replies[key] !== 'string') { return problem(key, 'text', '模板须为文字'); }

        const error = field.empty ? templateError('x' + config.replies[key], [], []) : templateError(config.replies[key], field.variables, field.required);

        if (error) { return { ...error, start: Math.max(0, error.start - (field.empty ? 1 : 0)), end: Math.max(0, error.end - (field.empty ? 1 : 0)), field: key, target: 'text' }; }

        if (new TextEncoder().encode(config.replies[key]).length > (field.empty ? 256 : 8000)) { return problem(key, 'text', '字段超过 UTF-8 字节上限'); }
    }

    for (const key of MESSAGE_KEYS.filter(key => selected === undefined || key === selected)) {
        const rows = config.buttons[key];

        if (!Array.isArray(rows) || rows.length > 5 || rows.some(row => !Array.isArray(row) || row.length < 1 || row.length > 5)) {
            return problem(key, 'buttons', '按钮最多 5 行，每行 1～5 个；不使用按钮时删除全部行');
        }

        if (key === 'menu' && rows.some(row => row.some(b => b?.action === 'choice') && row.length !== 1)) { return problem(key, 'buttons', '动态选择按钮须独占一行，按实际选项自动展开'); }

        const actions: string[] = [];

        for (const [rowIndex, row] of rows.entries()) {
            for (const [itemIndex, item] of row.entries()) {
                const buttonProblem = (message: string, control: ConfigurationError['control']): ConfigurationError => ({
                    ...problem(key, 'buttons', message), row: rowIndex, item: itemIndex, control
                });

                if (!object(item) || Object.keys(item).some(name => !['action', 'label', 'data', 'enter'].includes(name))
                    || !Object.hasOwn(BUTTON_ACTIONS, item.action) || typeof item.label !== 'string' || !item.label.trim()
                    || [...item.label.replaceAll('{{number}}', '8')].length > 10 || /[\r\n\u0000-\u001f]/.test(item.label)) {
                    return buttonProblem('按钮需要已知功能和 1～10 字的单行文字', object(item) && Object.hasOwn(BUTTON_ACTIONS, item.action) ? 'label' : 'action');
                }

                if (/\{\{|\}\}/.test(item.label.replaceAll(item.action === 'choice' ? '{{number}}' : '\u0000', ''))) { return buttonProblem('按钮文字只允许选择按钮使用 {{number}}', 'label'); }

                const dynamic = DYNAMIC.includes(item.action);

                if (dynamic) {
                    if (!(REQUIRED[key] ?? []).includes(item.action) || item.data !== undefined || item.enter !== undefined) {
                        return buttonProblem('动态按钮仅用于所属消息，参数由程序生成', 'action');
                    }
                } else if (item.action === 'link') {
                    if (!safeHttpUrl(item.data) || item.enter !== undefined) { return buttonProblem('链接按钮请填写有效的 HTTP 或 HTTPS 地址', 'data'); }
                } else {
                    if (item.action === 'command') {
                        if (typeof item.data !== 'string' || !item.data.trim() || /[\u0000-\u001f{}]/.test(item.data)) {
                            return buttonProblem('自定义命令须为单行文字，不接受变量或控制字符', 'data');
                        }
                    } else if (item.data !== undefined) { return buttonProblem('内置按钮不接受自定义参数', 'action'); }

                    if (typeof item.enter !== 'boolean') {
                        return buttonProblem('请选择直接发送或填入输入框', 'enter');
                    }
                }

                actions.push(item.action);
            }
        }

        for (const action of REQUIRED[key] ?? []) {
            if (actions.filter(name => name === action).length !== 1) {
                return problem(key, 'buttons', '必须保留且仅保留一个“' + BUTTON_ACTIONS[action as ButtonAction] + '”按钮');
            }
        }
    }

    if (new TextEncoder().encode(JSON.stringify(config)).length > 65536) { return problem(selected ?? 'help', 'text', '全部模板配置合计不能超过 64 KiB，请精简正文或按钮参数'); }

    let expanded;

    try { expanded = replyPresentation.budget(config, selected); } catch { return problem(selected ?? 'help', 'text', '模板展开失败，请检查变量与片段'); }

    return expanded ? problem(expanded.field, expanded.target ?? 'text', expanded.message) : null;
}

export function safeHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s<>"'\u0000-\u001f]/.test(value)) { return false; }

    try {
        const url = new URL(value);

        return !!url.hostname && !url.username && !url.password;
    } catch { return false; }
}
