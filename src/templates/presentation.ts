import { isPrivateScope } from '../conversation.js';
import { menuEntries } from './menu.js';
import { qqAt } from '@qqbot/sdk';
import { formatPoints } from '../amounts.js';
import { renderTemplate, escapeMarkdown } from './replies.js';
import type { ReplyConfiguration, ReplyButton } from './reply-config.js';
import type { view } from '../room/state.js';
import type { Action } from '../game/types.js';

export interface Part { key: string; values: Record<string, string>; users?: Record<string, string> }
export interface MessageInput { aiMenu?: 'add' | 'remove'; path?: number[]; scene?: 'group' | 'c2c'; mentionCurrent?: boolean; now?: number; values?: Record<string, string>; room?: ReturnType<typeof view>; parts?: Part[]; moves?: Action[]; offset?: number; actor?: string; dynamic?: Record<string, string>; choices?: string[]; reason?: string; name?: string; notice?: string }

const variables = new WeakMap<ReplyConfiguration['replies'], Map<string, { source: string; names: string[] }>>();

// 两种发送格式共用玩家查找、金额和菜单分页，只分别展开各自的转义正文。
export function preparePresentation(input: MessageInput) {
    const s = input.room, moves = input.moves ?? [], requested = input.offset ?? 0;
    const menu = menuEntries(moves, s?.game?.players ?? [], input.actor ?? '', input.path);
    const offset = requested < menu.entries.length ? requested : 0;
    const players = new Map(s?.game?.players.map(p => [p.id, p]));
    const missingNames = new Set(s?.members.filter(m => (m.nameLookupAt ?? 0) > 0).map(m => m.id));
    const canQuit = !input.reason && s?.status === 'PLAYING' && !s.paused && !s.recovery && !!s.game?.players.some(p => p.id === input.actor && !p.ai && p.life > 0);
    const capacity = 25 - Number(canQuit) - Number(menu.path.length > 0), count = menu.entries.length <= capacity ? capacity : capacity - 2;
    const now = input.now ?? Date.now();

    return {
        menu, players, missingNames, current: s?.game ? players.get(s.game.current) : undefined, offset, count, canQuit, selected: menu.entries.slice(offset, offset + count),
        stake: s?.stake ? formatPoints(s.stake) : '', seconds: s ? String(Math.ceil(Math.max(0, s.deadline === undefined ? s.remainingMs : s.deadline - now) / 1000)) : '', reading: Math.max(0, (s?.aiReadUntil ?? 0) - now)
    };
}

// 普通文字与 Markdown 共用组成规则，变量分别按发送格式处理。
export function createReplyPresentation(render: typeof renderTemplate, escape: typeof escapeMarkdown) {
    const maxBytes = 16000;

    function text(config: ReplyConfiguration, key: string, values: Record<string, string> = {}, raw: string[] = []): string {
        const source = config.replies[key];

        if (typeof source !== 'string') { throw Error('模板字段不存在：' + key); }

        let cached = variables.get(config.replies);

        if (!cached) { variables.set(config.replies, cached = new Map()); }

        let entry = cached.get(key);

        if (entry?.source !== source) {
            entry = { source, names: [...source.matchAll(/\{\{([^{}]*)\}\}/g)].map(m => m[1]) };
            cached.set(key, entry);
        }

        const used = entry.names;

        if (!used.length) { return source; }

        if (used.some(k => !Object.hasOwn(values, k))) { throw Error('缺少模板数据：' + key); }

        const output = render(source, Object.fromEntries(used.map(k => [k, raw.includes(k) ? values[k] : escape(String(values[k]))])));

        return output;
    }

    function part(config: ReplyConfiguration, p: Part, name: (id: string, value: string) => string) {
        const v = { ...p.values }, raw: string[] = [];

        for (const [key, id] of Object.entries(p.users ?? {})) {
            v[key] = name(id, v[key] ?? '');
            raw.push(key);
        }

        if (v.shell !== undefined) {
            v.shell = text(config, v.shell === '1' ? 'live' : 'blank', {}, []);
            raw.push('shell');
        }

        if (v.item !== undefined) {
            v.item = text(config, 'item' + v.item, {}, []);
            raw.push('item');
        }

        if (p.key === 'item') {
            v.target = v.target ? text(config, 'target', { name: v.target }, raw.includes('target') ? ['name'] : []) : '';
            raw.push('target');
        }

        return text(config, p.key, v, raw) + (v.replayUrl && ['finish', 'noWinner'].includes(p.key) ? '\n' + text(config, 'replayLink', { url: v.replayUrl }, ['url']) : '');
    }

    function buttons(config: ReplyConfiguration, key: string, dynamic: Record<string, string> = {}, choices: string[] = [], labels: string[] = []) {
        const rows: ReplyButton[][] = [];
        const flat: ReplyButton[] = [];

        for (const row of config.buttons[key as keyof typeof config.buttons] ?? []) {
            const result: ReplyButton[] = [];

            for (const item of row) {
                if (item.action === 'choice') {
                    result.push(...choices.map((data, i) => ({ ...item, label: labels[i] ?? item.label.replaceAll('{{number}}', String(i + 1)), data })));
                } else if (item.action === 'link') {
                    const data = item.data ?? dynamic.link;

                    if (data) { result.push({ ...item, data }); }
                } else if (item.action.startsWith('draft') || ['addAI', 'removeAI', 'join', 'ready', 'start', 'choose', 'quit', 'confirmCreate', 'confirmQuit', 'next', 'previous', 'menuBack'].includes(item.action)) {
                    if (dynamic[item.action]) { result.push({ ...item, data: dynamic[item.action] }); }
                } else { result.push({ ...item }); }
            }

            if (key === 'menu') { flat.push(...result); } else if (result.length) { rows.push(result); }
        }

        if (key === 'menu') {
            for (let i = 0; i < flat.length; i += 5) { rows.push(flat.slice(i, i + 5)); }
        }

        return rows;
    }

    function message(config: ReplyConfiguration, key: string, input: MessageInput = {}, withButtons = true, prepared = preparePresentation(input)) {
        const values = { ...input.values }, raw: string[] = [], dynamic = { ...input.dynamic };
        let choices = input.choices ?? [];
        let labels: string[] = [];
        const t = (k: string, v: Record<string, string> = {}, r: string[] = []) => text(config, k, v, r);

        const group = input.scene === 'group' || input.scene === undefined && !!input.room && !isPrivateScope(input.room.groupId);
        const name = (id: string, value: string) => group && prepared.missingNames.has(id) ? qqAt(id) : escape(value);
        const displayName = (p: { id?: string; name: string; ai?: boolean; life?: number }, mention = true) => t(p.ai ? 'dealerName' : p.life === 0 ? 'eliminatedName' : input.room?.mode !== 'solo' && input.room?.status === 'PLAYING' && p.id === input.room.game?.current ? 'activeName' : 'humanName', { name: !p.ai && mention ? name(p.id ?? '', p.name) : escape(p.name) }, ['name']);

        if (key === 'aiRoster') {
            const s = input.room!, base = { gameId: s.gameId, expectedVersion: s.version };
            const adding = input.aiMenu === 'add';
            labels = adding ? [0, 1, 2, 3, 4].map(n => t('level' + n)) : (s.opponents ?? []).map(p => p.name);
            choices = adding ? [0, 1, 2, 3, 4].map(difficulty => JSON.stringify({ ...base, action: { type: 'addAI', difficulty } })) : (s.opponents ?? []).map(p => JSON.stringify({ ...base, action: { type: 'removeAI', target: p.id } }));
            values.title = t(adding ? 'aiAddTitle' : 'aiRemoveTitle');
            values.items = labels.map((label, i) => `${i + 1}. ${label}`).join('\n') || t('aiEmpty');
            raw.push('title', 'items');
        } else if (key === 'panel') {
            const s = input.room!;
            const rows = s.game ? s.game.players.map((p, i) => t('player', { number: String(i + 1), name: displayName(p), life: String(p.life), control: p.control === 'none' ? '' : t('controlled'), inventory: p.inventory.length ? p.inventory.map((item, n) => t('inventoryItem', { number: String(n + 1), item: t('item' + item) }, ['item'])).join(t('inventorySeparator')) : t('inventoryEmpty') }, ['name', 'inventory', 'control'])) : [...s.members, ...(s.opponents ?? []).map(p => ({ ...p, ai: true, ready: true }))].map(p => t('member', { name: displayName(p), ready: t(p.ready ? 'ready' : 'notReady') }, ['name', 'ready']));
            const { seconds, reading, current } = prepared;
            const timer = reading && s.status === 'PLAYING' && !s.paused && !s.recovery ? t('timerReading', { seconds: String(Math.ceil(reading / 1000)) }) : s.status !== 'PLAYING' ? t(s.game ? 'timerEnded' : 'timerWaiting') : t(s.paused || s.recovery ? 'timerPaused' : 'timer', { seconds });
            const currentName = current ? group && input.mentionCurrent && !current.ai && s.status === 'PLAYING' && !s.paused && !s.recovery ? qqAt(current.id) : current.ai ? escape(current.name) : name(current.id, current.name) : '';
            Object.assign(values, { gameId: s.gameId, version: String(s.version), status: t('status' + s.status), paused: s.paused ? t('paused') : '', recovery: s.recovery ? t('recovery') : '', stake: s.stake ? t('stake', { amount: prepared.stake }) : t('free'), items: rows.filter(Boolean).join(config.historySeparator ?? t('playerSeparator')), timer, turn: s.game ? t('turn', { name: currentName, direction: t(s.game.direction === 1 ? 'forward' : 'reverse') }, ['name', 'direction']) : t('waiting') });

            if (s.challengeDate) { values.stake += '\n' + t('dailyLabel', { date: s.challengeDate }); }

            if (s.showAIStyle && s.aiPersonality) { values.stake += '\n' + t('dealerStyle', { style: t('personality' + s.aiPersonality) }, ['style']); }

            raw.push('timer', 'status', 'paused', 'recovery', 'stake', 'items', 'turn');

            if (s.status === 'WAITING' && s.mode === 'multi' && s.stake === 0 && !isPrivateScope(s.groupId) && !s.paused && !s.recovery) {
                if (s.members.length + (s.opponents?.length ?? 0) < 4) { dynamic.addAI = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, aiMenu: 'add' }); }

                if (s.opponents?.length) { dynamic.removeAI = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, aiMenu: 'remove' }); }

                values.turn = t('aiWaiting');
            }

            if (withButtons) { for (const action of s.status === 'WAITING' ? ['join', 'ready', 'start'] : s.status === 'PLAYING' ? ['choose', 'quit'] : []) { dynamic[action] = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, ...(action === 'choose' ? { menu: 0 } : { action: { type: action === 'quit' ? 'confirmQuit' : action } }) }); } }
        } else if (key === 'menu') {
            if (input.reason === 'menuSpectator' || input.reason === 'menuOtherTurn') { return { text: t(input.reason, { name: name(input.actor ?? '', input.name ?? '') }, ['name']), buttons: [] }; }

            const s = input.room!, moves = input.moves ?? [];
            const { offset, count, canQuit, selected, players, menu } = prepared;
            const player = (id: string) => players.get(id)!;
            const lines = selected.map((entry, i) => {
                const move = entry.display, number = String(i + 1);

                if (entry.player) { return t('menuTarget', { number, target: displayName(player(entry.player), false) }, ['target']); }

                if (move.type === 'shoot') { return t('menuShot', { number, target: displayName(player(move.target), false) }, ['target']); }

                return move.type === 'item' ? t('menuItem', { number, slot: String(move.slot + 1), item: t('item' + (entry.item ?? player(input.actor!).inventory[move.slot])), target: '', stolen: '', stolenTarget: '' }, ['item']) : '';
            });
            values.items = lines.reduce((body, line, i) => body + (i ? t(selected[i].display.type !== selected[i - 1].display.type ? 'menuGroupSeparator' : 'menuSeparator') : '') + line, '');

            if (menu.stage) { values.items = t(menu.stage, { item: t('item' + menu.item) }, ['item']) + '\n' + values.items; }

            values.panel = message(config, 'panel', { ...input, notice: undefined, mentionCurrent: input.mentionCurrent ?? false }, false, prepared).text;
            raw.push('panel', 'items');

            if (withButtons) {
                const base = { gameId: s.gameId, expectedVersion: s.version };
                choices = selected.map(entry => JSON.stringify({ ...base, ...(entry.path ? { menu: 0, path: entry.path } : { action: { type: 'play', move: entry.move } }) }));

                if (menu.path.length) { dynamic.menuBack = JSON.stringify({ ...base, menu: 0, path: menu.back }); }

                if (canQuit) { dynamic.quit = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, action: { type: 'confirmQuit' } }); }

                if (offset > 0) { dynamic.previous = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, path: menu.path, menu: Math.max(0, offset - count) }); }

                if (offset + count < menu.entries.length) { dynamic.next = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, path: menu.path, menu: offset + count }); }
            }

            if (!selected.length) { values.items = t(input.reason ?? 'menuEmpty', { name: input.name ?? '' }); }
        } else if (key.startsWith('setup')) {
            values.mode = t('mode' + values.mode);
            raw.push('mode');

            if (key === 'setupDifficulty') {
                values.stake = Number(values.stake) ? t('stake', { amount: formatPoints(Number(values.stake)) }) : t('free');

                if (values.challengeDate) { values.stake += '\n' + t('dailyLabel', { date: values.challengeDate }) + '\n' + t('dailyHint'); }

                raw.push('stake');
            }

            if (key === 'setupBlocked') {
                values.reason = t(input.reason!);
                raw.push('reason');
            }
        } else if (key === 'create') {
            const mode = values.mode;
            values.mode = t('mode' + mode);
            values.difficulty = mode === 'Solo' ? t('level' + values.difficulty) : t(mode === 'Multi' && !Number(values.stake) ? 'multiFreeMatch' : 'humanMatch');
            values.stake = Number(values.stake) ? t('stake', { amount: formatPoints(Number(values.stake)) }) : t('free');

            if (values.challengeDate) { values.stake += '\n' + t('dailyLabel', { date: values.challengeDate }) + '\n' + t('dailyHint'); }

            values.reward = values.challengeDate ? t('dailyReward', { amount: formatPoints(Number(values.dailyReward || 0)) }) : values.reward ? (mode === 'Solo' ? t('soloReward', { amount: formatPoints(Number(values.reward)) }) : t('multiReward')) : '';
            raw.push('mode', 'difficulty', 'stake', 'reward');
        } else if (key === 'error') {
            values.message = t(values.message || 'unknownError');
            raw.push('message');
        } else if (input.parts?.length) {
            const link = input.parts.find(p => p.key === 'finish' || p.key === 'noWinner')?.values.replayUrl;

            if (link?.startsWith('https://')) { dynamic.link = link; }

            return { text: input.parts.map(p => part(config, p, name)).filter(Boolean).join(t('eventSeparator')), buttons: withButtons ? buttons(config, key, dynamic, choices) : [] };
        }

        if (key === 'history') { raw.push('items'); }

        if (key === 'help') {
            values.modes = input.scene === 'c2c' ? '单人' : '单人|双人|多人';
            values.roomCommands = input.scene === 'c2c' ? '退出|确认退出' : '加入|准备|开始|退出|确认退出';
        }

        const content = t(key, values, raw);

        return { text: input.notice ? t(input.notice) + '\n' + content : content, buttons: withButtons ? buttons(config, key, dynamic, choices, labels).map(row => key === 'lobby' && input.scene === 'c2c' ? row.filter(b => b.action !== 'duo' && b.action !== 'multi') : row).filter(row => row.length) : [] };
    }

    return { message, maxBytes };
}

export const replyPresentation = createReplyPresentation(renderTemplate, escapeMarkdown);
