import { renderTemplate, escapeMarkdown, REPLY_FIELDS } from './replies.js';
import type { ReplyConfiguration, ReplyButton } from './reply-config.js';
import type { view } from '../room/state.js';
import type { Action } from '../game/types.js';

export interface Part { key: string; values: Record<string, string> }
export interface MessageInput { values?: Record<string, string>; room?: ReturnType<typeof view>; parts?: Part[]; moves?: Action[]; offset?: number; actor?: string; dynamic?: Record<string, string>; choices?: string[] }

// 发送、服务端预算与浏览器预览共用；工厂自包含以便嵌入静态管理页面。
export function createReplyPresentation(render: typeof renderTemplate, escape: typeof escapeMarkdown, fields: typeof REPLY_FIELDS) {
    const maxBytes = 16000, defaultSeparator = '\n';
    type Marks = { key: string; start: string; end: string };

    function text(config: ReplyConfiguration, key: string, values: Record<string, string> = {}, raw: string[] = [], marks?: Marks): string {
        const source = config.replies[key];

        if (typeof source !== 'string') { throw Error('模板字段不存在：' + key); }

        const used = [...source.matchAll(/\{\{([^{}]*)\}\}/g)].map(m => m[1]);

        if (used.some(k => !Object.hasOwn(values, k))) { throw Error('缺少模板数据：' + key); }

        const output = render(source, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, raw.includes(k) ? v : escape(String(v))])));

        return marks?.key === key ? marks.start + output + marks.end : output;
    }

    function part(config: ReplyConfiguration, p: Part, marks?: Marks) {
        const v = { ...p.values }, raw: string[] = [];

        if (v.shell !== undefined) {
            v.shell = text(config, v.shell === '1' ? 'live' : 'blank', {}, [], marks);
            raw.push('shell');
        }

        if (v.item !== undefined) {
            v.item = text(config, 'item' + v.item, {}, [], marks);
            raw.push('item');
        }

        if (p.key === 'item') {
            v.target = v.target ? text(config, 'target', { name: v.target }, [], marks) : '';
            raw.push('target');
        }

        return text(config, p.key, v, raw, marks);
    }

    function buttons(config: ReplyConfiguration, key: string, dynamic: Record<string, string> = {}, choices: string[] = []) {
        const rows: ReplyButton[][] = [];

        for (const row of config.buttons[key as keyof typeof config.buttons] ?? []) {
            const result: ReplyButton[] = [];

            for (const item of row) {
                if (item.action === 'choice') {
                    for (let i = 0; i < choices.length; i += 2) { rows.push(choices.slice(i, i + 2).map((data, n) => ({ ...item, label: item.label.replaceAll('{{number}}', String(i + n + 1)), data }))); }
                } else if (['join', 'ready', 'start', 'choose', 'quit', 'confirmCreate', 'confirmQuit', 'next'].includes(item.action)) {
                    if (dynamic[item.action]) { result.push({ ...item, data: dynamic[item.action] }); }
                } else { result.push({ ...item }); }
            }

            if (result.length) { rows.push(result); }
        }

        return rows;
    }

    function message(config: ReplyConfiguration, key: string, input: MessageInput = {}, marks?: Marks) {
        const values = { ...input.values }, raw: string[] = [], dynamic = { ...input.dynamic };
        let choices = input.choices ?? [];
        const t = (k: string, v: Record<string, string> = {}, r: string[] = []) => text(config, k, v, r, marks);

        if (key === 'panel') {
            const s = input.room!;
            const rows = s.game ? s.game.players.map((p, i) => t('player', { number: String(i + 1), name: p.name, life: String(p.life), control: p.control === 'none' ? '' : t('controlled'), inventory: p.inventory.length ? p.inventory.map((item, n) => t('inventoryItem', { number: String(n + 1), item: t('item' + item) }, ['item'])).join(t('inventorySeparator')) : t('inventoryEmpty') }, ['inventory', 'control'])) : s.members.map(p => t('member', { name: p.name, ready: t(p.ready ? 'ready' : 'notReady') }, ['ready']));
            Object.assign(values, { gameId: s.gameId, version: String(s.version), status: t('status' + s.status), paused: s.paused ? t('paused') : '', recovery: s.recovery ? t('recovery') : '', stake: s.stake ? t('stake', { amount: String(s.stake) }) : t('free'), items: rows.filter(Boolean).join(config.historySeparator ?? defaultSeparator), summary: (input.parts ?? []).map(p => part(config, p, marks)).filter(Boolean).join(t('eventSeparator')), turn: s.game ? t('turn', { name: s.game.players.find(p => p.id === s.game!.current)?.name ?? '', direction: t(s.game.direction === 1 ? 'forward' : 'reverse') }, ['direction']) : t('waiting') });
            raw.push('status', 'paused', 'recovery', 'stake', 'items', 'summary', 'turn');

            for (const action of s.status === 'WAITING' ? ['join', 'ready', 'start'] : s.status === 'PLAYING' ? ['choose', 'quit'] : []) { dynamic[action] = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, ...(action === 'choose' ? { menu: 0 } : { action: { type: action === 'quit' ? 'confirmQuit' : action } }) }); }
        } else if (key === 'menu') {
            const s = input.room!, offset = input.offset ?? 0, selected = input.moves!.slice(offset, offset + 8), players = s.game!.players;
            const player = (id: string) => players.find(p => p.id === id)!;
            values.items = selected.map((move, i) => move.type === 'shoot' ? t('menuShot', { number: String(i + 1), target: player(move.target).name }) : move.type === 'item' ? t('menuItem', { number: String(i + 1), slot: String(move.slot + 1), item: t('item' + player(input.actor!).inventory[move.slot]), target: move.target ? t('target', { name: player(move.target).name }) : '', stolen: move.stolenSlot !== undefined ? t('stolen', { slot: String(move.stolenSlot + 1), item: t('item' + player(move.target!).inventory[move.stolenSlot]) }, ['item']) : '', stolenTarget: move.stolenTarget ? t('stolenTarget', { name: player(move.stolenTarget).name }) : '' }, ['item', 'target', 'stolen', 'stolenTarget']) : '').filter(Boolean).join(t('menuSeparator'));
            raw.push('items');
            choices = selected.map(move => JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, action: { type: 'play', move } }));

            if (offset + 8 < input.moves!.length) { dynamic.next = JSON.stringify({ gameId: s.gameId, expectedVersion: s.version, menu: offset + 8 }); }
        } else if (key === 'create') {
            const mode = values.mode;
            values.mode = t('mode' + mode);
            values.difficulty = t('level' + values.difficulty);
            values.stake = Number(values.stake) ? t('stake', { amount: values.stake }) : t('free');
            values.reward = values.reward ? (mode === 'Solo' ? t('soloReward', { amount: values.reward }) : t('multiReward')) : '';
            raw.push('mode', 'difficulty', 'stake', 'reward');
        } else if (key === 'error') {
            values.message = t(values.message || 'unknownError');
            raw.push('message');
        } else if (input.parts?.length) {
            return { text: input.parts.map(p => part(config, p, marks)).filter(Boolean).join(t('eventSeparator')), buttons: buttons(config, key, dynamic, choices) };
        }

        return { text: t(key, values, raw), buttons: buttons(config, key, dynamic, choices) };
    }

    function sampleInput(scenario = 'normal'): MessageInput {
        const players = [{ id: 'a', name: '小明', life: 4, inventory: ['saw', 'beer'], control: 'none', ai: false }, { id: 'b', name: '小雨', life: 3, inventory: [], control: 'none', ai: false }];
        const room = { gameId: 'demo-room', groupId: 'demo-group', version: 7, status: 'PLAYING', mode: 'duo', stake: 0, difficulty: 1, host: 'a', members: players.map(p => ({ id: p.id, name: p.name, ready: true })), paused: scenario === 'paused', recovery: false, tasks: [], funds: [], game: { players, current: 'a', direction: 1 } } as unknown as ReturnType<typeof view>;

        if (scenario === 'waiting') {
            room.status = 'WAITING';
            room.game = undefined;
        }

        if (scenario === 'empty') {
            room.members = [];
            room.game = undefined;
        }

        if (scenario === 'single') { room.game!.players = room.game!.players.slice(0, 1); }

        return { room, actor: 'a', moves: [{ type: 'shoot', target: 'a' }, { type: 'shoot', target: 'b' }], parts: [], values: { gameId: 'demo-room', version: '7', mode: 'Solo', difficulty: '4', stake: '10', reward: '30', message: 'unknownError', name: '小明', actor: '小明', target: '小雨', item: 'saw', shell: '1', count: '6', live: '3', blank: '3', loadId: '2', position: '3', number: '1', slot: '1', stolen: '', stolenTarget: '', life: '4', control: '', inventory: '手锯', ready: '已准备', direction: '正向', amount: '30' }, dynamic: { confirmCreate: '{"gameId":"demo-room"}', confirmQuit: '{"gameId":"demo-room"}' } };
    }

    const eventKeys = ['shot', 'item', 'steal', 'skip', 'eject', 'eliminate', 'timeout', 'timeoutEliminate'];
    const itemKeys = Object.keys(fields).filter(k => k.startsWith('item') && k !== 'item' && !fields[k].variables.length);
    const reasonKeys = Object.keys(fields).filter(k => fields[k].parent === 'error');
    const statuses = Object.keys(fields).filter(k => k.startsWith('status')).map(k => k.slice(6));

    function sampleCase(key: string, scenario = 'normal', context?: string): { parent: string; input: MessageInput } {
        const parent = context ?? fields[key].parent ?? key, input = sampleInput(parent === 'panel' ? scenario : 'normal'), v = input.values!, room = input.room!;
        const game = room.game;
        const selectedItem = itemKeys.includes(key) ? key.slice(4) : 'saw';

        if (parent === 'create') {
            v.mode = scenario.startsWith('multi') ? 'Multi' : scenario.startsWith('duo') ? 'Duo' : 'Solo';

            if (key.startsWith('mode')) { v.mode = key.slice(4); }

            if (key.startsWith('level')) { v.difficulty = key.slice(5); }

            if (key === 'multiReward') { v.mode = 'Duo'; }

            if (scenario === 'free' || key === 'free') {
                v.stake = '0';
                v.reward = '';
            }
        }

        if (parent === 'panel') {
            if (key.startsWith('status')) { room.status = key.slice(6) as typeof room.status; }

            if (scenario.startsWith('status:')) { room.status = scenario.slice(7) as typeof room.status; }

            if (['member', 'ready', 'notReady', 'waiting'].includes(key)) { room.status = 'WAITING'; }

            if (room.status === 'WAITING') { room.game = undefined; }

            room.paused = scenario === 'paused' || key === 'paused';
            room.recovery = scenario === 'recovery' || key === 'recovery';

            if (scenario === 'stake' || key === 'stake') { room.stake = 10; }

            if (key === 'notReady') { room.members[0].ready = false; }

            if (room.game) {
                if (key === 'controlled') { room.game.players[0].control = 'skip'; }

                if (key === 'reverse') { room.game.direction = -1; }

                if (itemKeys.includes(key)) { room.game.players[0].inventory = [selectedItem as never]; }

                if (scenario === 'inventoryEmpty' || key === 'inventoryEmpty') { room.game.players.forEach(p => p.inventory = []); }
            }
        }

        if (parent === 'menu') {
            if (scenario === 'empty') { input.moves = []; } else if (scenario === 'item' || scenario === 'steal' || key !== 'menu' && key !== 'menuShot' && key !== 'menuSeparator') {
                room.game!.players[0].inventory = ['adrenaline', selectedItem as never];
                room.game!.players[1].inventory = [selectedItem as never];
                input.moves = scenario === 'item' ? [{ type: 'item', slot: 1, target: 'b' }] : [{ type: 'item', slot: 0, target: 'b', stolenSlot: 0, stolenTarget: 'b' }];
            } else if (scenario === 'paged') { input.moves = Array.from({ length: 9 }, () => ({ type: 'shoot', target: 'a' })); }
        }

        if (parent === 'error') { v.message = key === 'error' ? (scenario.startsWith('reason:') ? scenario.slice(7) : 'unknownError') : key; }

        if (key === 'blank') { v.shell = '0'; }

        v.item = selectedItem;
        const event = eventKeys.includes(key) ? key : key === 'target' ? 'item' : ['live', 'blank'].includes(key) ? 'shot' : undefined;

        if (parent === 'panel' && event) { input.parts = [{ key: event, values: v }]; }

        if (parent === 'panel' && scenario.startsWith('event:')) { input.parts = [{ key: scenario.slice(6), values: v }]; }

        if (parent === 'panel' && key === 'eventSeparator') { input.parts = [{ key: 'shot', values: v }, { key: 'skip', values: v }]; }

        if (parent === 'panel' && key === 'target') { input.parts = [{ key: 'item', values: v }]; }

        if (parent === 'intel' || parent === 'shot' || parent === 'eject') { v.shell = key === 'blank' || scenario === 'blank' ? '0' : '1'; }

        if (['load', ...eventKeys, 'finish', 'noWinner', 'intel', 'noIntel', 'reminder'].includes(parent)) { input.parts = [{ key: parent, values: v }]; }

        // 终态仍可展示最终玩家；等待态没有游戏对象。
        if (!room.game && room.status !== 'WAITING' && game && scenario !== 'empty') { room.game = game; }

        return { parent, input };
    }

    function sample(config: ReplyConfiguration, key: string, scenario: string, marks?: Marks, context?: string) {
        const { parent, input } = sampleCase(key, scenario, context);

        return { ...message(config, parent, input, marks), parent };
    }

    function candidates(parent: string): string[][] {
        if (parent === 'panel') { return [['normal', '对局中'], ['waiting', '等待加入'], ['paused', '暂停'], ['recovery', '等待恢复'], ['stake', '下注对局'], ['inventoryEmpty', '道具用完'], ...statuses.filter(s => s !== 'PLAYING' && s !== 'WAITING').map(s => ['status:' + s, fields['status' + s].title]), ...eventKeys.map(k => ['event:' + k, fields[k].title])]; }

        if (parent === 'create') { return [['normal', '单人下注'], ['free', '免费'], ['duo', '双人下注'], ['multi', '多人下注']]; }

        if (parent === 'menu') { return [['normal', '射击选择'], ['item', '道具选择'], ['steal', '偷取道具'], ['paged', '还有下一页'], ['empty', '没有合法操作']]; }

        if (['intel', 'shot', 'eject'].includes(parent)) { return [['normal', '实弹'], ['blank', '空弹']]; }

        return [['normal', '示例']];
    }

    function scenarios(config: ReplyConfiguration, key: string, context?: string) {
        const parent = context ?? fields[key].parent ?? key, seen = new Set<string>();

        return candidates(parent).filter(([id]) => {
            const signature = JSON.stringify(sample(config, key, id, undefined, context));

            if (seen.has(signature)) { return false; }

            seen.add(signature);

            return true;
        });
    }

    function budget(config: ReplyConfiguration, selected?: string): { field: string; message: string; target?: 'buttons' } | null {
        const parents = selected ? (fields[selected].parents ?? [fields[selected].parent ?? selected]) : [...new Set([...Object.keys(config.buttons), ...eventKeys])];
        const bytes = (value: string) => new TextEncoder().encode(value).length;
        const largest = itemKeys.reduce((a, b) => bytes(config.replies[a]) > bytes(config.replies[b]) ? a : b).slice(4);
        const check = (key: string, input: MessageInput) => {
            const output = message(config, key, input);

            if (!output.text.trim()) { return { field: key, message: '完整消息展开后不能为空，请保留在所有适用情景都有输出的正文' }; }

            if (bytes(output.text) > maxBytes) { return { field: key, message: '完整消息展开超过 ' + maxBytes + ' UTF-8 字节（含列表、转义及事件）' }; }

            if (output.buttons.length > 5 || output.buttons.some(row => row.length > 5 || row.some(b => [...b.label].length > 10))) { return { field: key, target: 'buttons' as const, message: '展开后的消息按钮超过平台行列或文字上限' }; }

            return null;
        };

        for (const parent of parents) {
            const cases = candidates(parent).map(([id]) => sampleCase(parent, id, parent).input);

            if (parent === 'error') { cases.push(...reasonKeys.map(key => sampleCase(key, 'normal', parent).input)); }

            for (const input of cases) {
                const error = check(parent, input);

                if (error) { return error; }
            }

            // 最大业务列表与实际数据边界单独检查，不复用展示情景去重。
            const maximum = sampleCase(parent, 'normal', parent).input;
            const data = maximum.values!;

            for (const name of ['name', 'actor', 'target']) { data[name] = '界'.repeat(24); }

            data.gameId = 'f'.repeat(36);
            data.version = '9'.repeat(16);
            data.amount = data.reward = data.stake = '9'.repeat(13);
            data.loadId = '9'.repeat(16);
            data.position = '8';
            data.item = largest;
            data.shell = bytes(config.replies.blank) > bytes(config.replies.live) ? '0' : '1';

            if (maximum.room?.game) {
                const room = maximum.room, p = room.game!.players[0];
                room.game!.players = Array.from({ length: 4 }, (_, i) => ({ ...p, id: i ? 'p' + i : 'a', name: '界'.repeat(24), control: 'skip', inventory: Array(8).fill(largest) }));
                room.members = room.game!.players.map(p => ({ id: p.id, name: p.name, ready: true }));
                room.gameId = data.gameId;
                room.version = Number.MAX_SAFE_INTEGER;
                room.stake = 1e12;
                room.game!.direction = bytes(config.replies.reverse) > bytes(config.replies.forward) ? -1 : 1;
                room.paused = room.recovery = true;

                if (bytes(text(config, 'free')) > bytes(text(config, 'stake', { amount: String(room.stake) }))) { room.stake = 0; }
            }

            if (parent === 'panel') {
                maximum.room!.status = statuses.filter(s => !['WAITING', 'PREPARING'].includes(s)).reduce((a, b) => bytes(config.replies['status' + a]) > bytes(config.replies['status' + b]) ? a : b) as ReturnType<typeof view>['status'];

                for (const event of eventKeys) {
                    maximum.parts = Array.from({ length: 12 }, () => ({ key: event, values: data }));
                    const error = check(parent, maximum);

                    if (error) { return error; }
                }

                const waiting = structuredClone(maximum);
                waiting.room!.game = undefined;
                waiting.room!.status = bytes(config.replies.statusWAITING) > bytes(config.replies.statusPREPARING) ? 'WAITING' : 'PREPARING';
                waiting.parts = [];
                waiting.room!.members.forEach(p => p.ready = bytes(config.replies.ready) >= bytes(config.replies.notReady));
                const error = check(parent, waiting);

                if (error) { return error; }
            } else if (parent === 'create') {
                for (const mode of ['Solo', 'Duo', 'Multi']) {
                    for (const stake of ['0', '1000000000000']) {
                        maximum.values!.mode = mode;
                        maximum.values!.stake = stake;
                        maximum.values!.reward = stake === '0' ? '' : '1000000000000';
                        maximum.values!.difficulty = ['0', '1', '2', '3', '4'].reduce((a, b) => bytes(config.replies['level' + a]) > bytes(config.replies['level' + b]) ? a : b);
                        const error = check(parent, maximum);

                        if (error) { return error; }
                    }
                }
            } else if (parent === 'menu') {
                for (const move of [{ type: 'shoot' as const, target: 'a' }, { type: 'item' as const, slot: 0, target: 'a', stolenSlot: 0, stolenTarget: 'a' }]) {
                    maximum.moves = Array(9).fill(move);
                    const error = check(parent, maximum);

                    if (error) { return error; }
                }
            } else if (maximum.parts) { maximum.parts.forEach(p => p.values = data); }

            const error = check(parent, maximum);

            if (error) { return error; }
        }

        return null;
    }

    return { text, part, message, buttons, scenarios, sample, budget, sampleInput, sampleCase, maxBytes, defaultSeparator };
}

export const replyPresentation = createReplyPresentation(renderTemplate, escapeMarkdown, REPLY_FIELDS);
