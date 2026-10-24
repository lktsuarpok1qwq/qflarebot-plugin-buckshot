import { qqAt } from '@qqbot/sdk';
import { renderTemplate, escapeMarkdown } from './replies.js';
import type { ReplyConfiguration, ReplyButton } from './reply-config.js';
import type { view } from '../room/state.js';
import type { Action } from '../game/types.js';

export interface Part { key: string; values: Record<string, string> }
export interface MessageInput { mentionCurrent?: boolean; now?: number; values?: Record<string, string>; room?: ReturnType<typeof view>; parts?: Part[]; moves?: Action[]; offset?: number; actor?: string; dynamic?: Record<string, string>; choices?: string[]; reason?: string; name?: string; notice?: string }

const variables = new WeakMap<ReplyConfiguration['replies'], Map<string, { source: string; names: string[] }>>();

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

        if (used.some(k => !Object.hasOwn(values, k))) { throw Error('缺少模板数据：' + key); }

        const output = render(source, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, raw.includes(k) ? v : escape(String(v))])));

        return output;
    }

    function part(config: ReplyConfiguration, p: Part) {
        const v = { ...p.values }, raw: string[] = [];

        if (v.shell !== undefined) {
            v.shell = text(config, v.shell === '1' ? 'live' : 'blank', {}, []);
            raw.push('shell');
        }

        if (v.item !== undefined) {
            v.item = text(config, 'item' + v.item, {}, []);
            raw.push('item');
        }

        if (p.key === 'item') {
            v.target = v.target ? text(config, 'target', { name: v.target }, []) : '';
            raw.push('target');
        }

        return text(config, p.key, v, raw);
    }

    function buttons(config: ReplyConfiguration, key: string, dynamic: Record<string, string> = {}, choices: string[] = []) {
        const rows: ReplyButton[][] = [];
        const flat: ReplyButton[] = [];

        for (const row of config.buttons[key as keyof typeof config.buttons] ?? []) {
            const result: ReplyButton[] = [];

            for (const item of row) {
                if (item.action === 'choice') {
                    result.push(...choices.map((data, i) => ({ ...item, label: item.label.replaceAll('{{number}}', String(i + 1)), data })));
                } else if (item.action.startsWith('draft') || ['join', 'ready', 'start', 'choose', 'quit', 'confirmCreate', 'confirmQuit', 'next', 'previous'].includes(item.action)) {
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

    function message(config: ReplyConfiguration, key: string, input: MessageInput = {}, withButtons = true) {
        const values = { ...input.values }, raw: string[] = [], dynamic = { ...input.dynamic };
        let choices = input.choices ?? [];
        const t = (k: string, v: Record<string, string> = {}, r: string[] = []) => text(config, k, v, r);

        const displayName = (p: { name: string; ai?: boolean }) => t(p.ai ? 'dealerName' : 'humanName', { name: p.name });

        if (key === 'panel') {
            const s = input.room!;
            const rows = s.game ? s.game.players.map((p, i) => t('player', { number: String(i + 1), name: displayName(p), life: String(p.life), control: p.control === 'none' ? '' : t('controlled'), inventory: p.inventory.length ? p.inventory.map((item, n) => t('inventoryItem', { number: String(n + 1), item: t('item' + item) }, ['item'])).join(t('inventorySeparator')) : t('inventoryEmpty') }, ['name', 'inventory', 'control'])) : s.members.map(p => t('member', { name: displayName(p), ready: t(p.ready ? 'ready' : 'notReady') }, ['name', 'ready']));
            const seconds = String(Math.ceil(Math.max(0, s.deadline === undefined ? s.remainingMs : s.deadline - (input.now ?? Date.now())) / 1000));
            const reading = Math.max(0, (s.aiReadUntil ?? 0) - (input.now ?? Date.now()));
            const timer = reading && s.status === 'PLAYING' && !s.paused && !s.recovery ? t('timerReading', { seconds: String(Math.ceil(reading / 1000)) }) : s.status !== 'PLAYING' ? t(s.game ? 'timerEnded' : 'timerWaiting') : t(s.paused || s.recovery ? 'timerPaused' : 'timer', { seconds });
            const current = s.game?.players.find(p => p.id === s.game!.current);
            const currentName = current ? input.mentionCurrent && !current.ai && s.status === 'PLAYING' && !s.paused && !s.recovery ? qqAt(current.id) : escape(current.name) : '';
            Object.assign(values, { gameId: s.gameId, version: String(s.version), status: t('status' + s.status), paused: s.paused ? t('paused') : '', recovery: s.recovery ? t('recovery') : '', stake: s.stake ? t('stake', { amount: String(s.stake) }) : t('free'), items: rows.filter(Boolean).join(config.historySeparator ?? t('playerSeparator')), timer, turn: s.game ? t('turn', { name: currentName, direction: t(s.game.direction === 1 ? 'forward' : 'reverse') }, ['name', 'direction']) : t('waiting') });
            raw.push('timer', 'status', 'paused', 'recovery', 'stake', 'items', 'turn');

            if (withButtons) { for (const action of s.status === 'WAITING' ? ['join', 'ready', 'start'] : s.status === 'PLAYING' ? ['choose', 'quit'] : []) { dynamic[action] = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, ...(action === 'choose' ? { menu: 0 } : { action: { type: action === 'quit' ? 'confirmQuit' : action } }) }); } }
        } else if (key === 'menu') {
            if (input.reason === 'menuSpectator') { return { text: t('menuSpectator'), buttons: [] }; }

            const s = input.room!, moves = input.moves ?? [], requested = input.offset ?? 0;
            const offset = requested < moves.length ? requested : 0;
            const count = moves.length <= 25 ? 25 : 23;
            const selected = moves.slice(offset, offset + count), players = s.game?.players ?? [];
            const player = (id: string) => players.find(p => p.id === id)!;
            values.items = selected.map((move, i) => move.type === 'shoot' ? t('menuShot', { number: String(i + 1), target: displayName(player(move.target)) }, ['target']) : move.type === 'item' ? t('menuItem', { number: String(i + 1), slot: String(move.slot + 1), item: t('item' + player(input.actor!).inventory[move.slot]), target: move.target ? t('target', { name: displayName(player(move.target)) }, ['name']) : '', stolen: move.stolenSlot !== undefined ? t('stolen', { slot: String(move.stolenSlot + 1), item: t('item' + player(move.target!).inventory[move.stolenSlot]) }, ['item']) : '', stolenTarget: move.stolenTarget ? t('stolenTarget', { name: displayName(player(move.stolenTarget)) }, ['name']) : '' }, ['item', 'target', 'stolen', 'stolenTarget']) : '').filter(Boolean).reduce((body, line, i) => body + (i ? t(selected[i].type !== selected[i - 1].type ? 'menuGroupSeparator' : 'menuSeparator') : '') + line, '');
            values.panel = message(config, 'panel', { ...input, notice: undefined, mentionCurrent: input.mentionCurrent ?? false }, false).text;
            raw.push('panel', 'items');

            if (withButtons) {
                choices = selected.map(move => JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, action: { type: 'play', move } }));

                if (offset > 0) { dynamic.previous = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, menu: Math.max(0, offset - count) }); }

                if (offset + count < moves.length) { dynamic.next = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, menu: offset + count }); }
            }

            if (!selected.length) { values.items = t(input.reason ?? 'menuEmpty', { name: input.name ?? '' }); }
        } else if (key.startsWith('setup')) {
            values.mode = t('mode' + values.mode);
            raw.push('mode');

            if (key === 'setupDifficulty') {
                values.stake = Number(values.stake) ? t('stake', { amount: values.stake }) : t('free');
                raw.push('stake');
            }

            if (key === 'setupBlocked') {
                values.reason = t(input.reason!);
                raw.push('reason');
            }
        } else if (key === 'create') {
            const mode = values.mode;
            values.mode = t('mode' + mode);
            values.difficulty = mode === 'Solo' ? t('level' + values.difficulty) : t('humanMatch');
            values.stake = Number(values.stake) ? t('stake', { amount: values.stake }) : t('free');
            values.reward = values.reward ? (mode === 'Solo' ? t('soloReward', { amount: values.reward }) : t('multiReward')) : '';
            raw.push('mode', 'difficulty', 'stake', 'reward');
        } else if (key === 'error') {
            values.message = t(values.message || 'unknownError');
            raw.push('message');
        } else if (input.parts?.length) {
            return { text: input.parts.map(p => part(config, p)).filter(Boolean).join(t('eventSeparator')), buttons: withButtons ? buttons(config, key, dynamic, choices) : [] };
        }

        const content = t(key, values, raw);

        return { text: input.notice ? t(input.notice) + '\n' + content : content, buttons: withButtons ? buttons(config, key, dynamic, choices) : [] };
    }

    return { message, maxBytes };
}

export const replyPresentation = createReplyPresentation(renderTemplate, escapeMarkdown);
