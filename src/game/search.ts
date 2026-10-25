import { SEARCH_POLICIES } from './search-policy.js';
import { preference, type Personality } from './personality.js';
import type { AIView } from './observation.js';
import type { Action, Item } from './types.js';

interface Position {
    shells: number[]; remaining: number; hp: number[]; hands: Item[][];
    control: number[]; actor: number; saw: boolean;
}
interface Move { item?: Item; self?: boolean; steal?: boolean }

// 弹药位图来自自身的合法可能排列；对手的私密知识、实际弹仓和 RNG 不进入模型。
export function chooseSearch(view: AIView, budgetMs: number, diagnostics?: { nodes: number; depth: number }, personality: Personality = 'balanced', level: 3 | 4 = 4): Action {
    const started = performance.now();
    const policy = SEARCH_POLICIES[level];

    if (diagnostics) {
        diagnostics.nodes = 0;
        diagnostics.depth = 0;
    }

    const own = view.public.players.find(p => p.id === view.public.current)!;
    const enemy = view.public.players.find(p => p.id !== own.id && p.life > 0)!;
    const initial: Position = {
        shells: view.knowledge.possibilities.map(p => p.reduce<number>((mask, bit, i) => mask | bit << i, 0)),
        remaining: view.knowledge.possibilities[0].length, hp: [own.life, enemy.life],
        hands: [[...own.inventory], [...enemy.inventory]],
        control: [own, enemy].map(p => p.control === 'skip' ? 1 : p.control === 'release' ? 2 : 0),
        actor: 0, saw: view.public.saw
    };
    // 同一合法弹序集合的概率、分组和移位只算一次，物品消耗复用只读库存。
    const distributionKeys = new Map<string, number[]>();
    const distributions = new WeakMap<number[], { key: string; p: number; subsets: number[][]; shifted: number[][]; inverted?: number[] }>();
    const intern = (values: number[]) => {
        const key = values.join(',');
        const previous = distributionKeys.get(key);

        if (previous) { return previous; }

        distributionKeys.set(key, values);

        return values;
    };
    const distribution = (shells: number[]) => {
        let result = distributions.get(shells);

        if (!result) {
            const subsets: number[][] = [[], []];

            for (const mask of shells) { subsets[mask & 1].push(mask); }

            result = {
                key: shells.join(','), p: subsets[1].length / shells.length,
                subsets: subsets.map(intern), shifted: subsets.map(values => intern(values.map(mask => mask >>> 1)))
            };
            distributions.set(shells, result);
        }

        return result;
    };
    const probability = (s: Position) => distribution(s.shells).p;
    const values: Partial<Record<Item, number>> = { glass: 2.4, beer: 1.5, cigarette: 3.5, saw: 4, cuffs: 4, jammer: 4, inverter: 3, medicine: 1.2, adrenaline: 5, phone: 1.5 };
    const hands = new WeakMap<Item[], { key?: string; used?: Map<Item, Item[]>; items?: Set<Item>; score?: number }>();
    const hand = (values: Item[]) => {
        let result = hands.get(values);

        if (!result) {
            result = {};
            hands.set(values, result);
        }

        return result;
    };
    const inventoryScore = (items: Item[]) => hand(items).score ??= items.reduce((sum, item) => sum + (values[item] || 0), 0);
    const inventoryKey = (items: Item[]) => hand(items).key ??= [...items].sort().join(',');
    const inventoryItems = (items: Item[]) => hand(items).items ??= new Set(items);
    const consume = (values: Item[], item: Item) => {
        const entry = hand(values);
        entry.used ??= new Map();
        let result = entry.used.get(item);

        if (!result) {
            result = values.slice();
            result.splice(result.indexOf(item), 1);
            entry.used.set(item, result);
        }

        return result;
    };
    const available = (s: Position, item: Item): Move | undefined => s.hands[s.actor].includes('adrenaline') && s.hands[1 - s.actor].includes(item)
        ? { item, steal: true } : s.hands[s.actor].includes(item) ? { item } : undefined;

    function translate(move: Move): Action {
        if (!move.item) { return { type: 'shoot', target: move.self ? own.id : enemy.id }; }

        const target = move.item === 'cuffs' || move.item === 'jammer';

        return move.steal ? {
            type: 'item', slot: own.inventory.indexOf('adrenaline'), target: enemy.id,
            stolenSlot: enemy.inventory.indexOf(move.item), ...(target ? { stolenTarget: enemy.id } : {})
        } : { type: 'item', slot: own.inventory.indexOf(move.item), ...(target ? { target: enemy.id } : {}) };
    }

    function options(s: Position): Move[] {
        const p = probability(s), a = s.actor, b = 1 - a;

        if (p === 1 && s.hp[b] <= (s.saw ? 2 : 1)) { return [{ self: false }]; }

        if (level === 4) {
            const saw = available(s, 'saw');

            if (saw && !s.saw && p === 1 && s.hp[b] > 1) { return [saw]; }

            const cuffs = available(s, 'cuffs');

            if (cuffs && s.control[b] === 0 && s.remaining > 1 && p === 1) { return [cuffs]; }
        }

        const heal = available(s, 'cigarette');

        if (heal && s.hp[a] < 4) { return [heal]; }

        const glass = available(s, 'glass');

        if (glass && p > 0 && p < 1) { return [glass]; }

        const result: Move[] = p === 0 ? [{ self: true }] : p === 1 ? [{ self: false }] : [{ self: false }, { self: true }];

        for (const steal of [true, false]) {
            if (steal && !s.hands[a].includes('adrenaline')) { continue; }

            for (const item of inventoryItems(s.hands[steal ? b : a])) {
                if (item === 'saw' && !s.saw && p > 0
                    || item === 'inverter' && p < 1
                    || item === 'beer' && (p > 0 && (p < 1 || level === 4) || p === 0 && s.saw)
                    || (item === 'cuffs' || item === 'jammer') && s.control[b] === 0 && s.remaining > 1 && p > 0
                    || item === 'medicine' && s.hp[a] < 3) { result.push({ item, steal }); }
            }
        }

        return result;
    }

    const p = probability(initial);
    // 情报道具不交出行动权；电话只在可抽到的位置仍有未知时使用。
    const phone: Move | undefined = own.inventory.includes('phone') ? { item: 'phone' } : undefined;
    const rootOptions = options(initial);

    // 两发弹时电话与放大镜同样能确定当前弹，优先保留放大镜。
    if (level === 4 && phone && initial.remaining === 2 && p > 0 && p < 1) { return translate(phone); }

    if (rootOptions.length === 1) { return translate(rootOptions[0]); }

    if (p === 1 && enemy.life <= (initial.saw ? 2 : 1)) { return translate({ self: false }); }

    if (phone && initial.shells.some(mask => (mask ^ initial.shells[0]) & 126)) { return translate(phone); }

    function evaluate(s: Position): number {
        if (s.hp[0] <= 0) { return -100; }

        if (s.hp[1] <= 0) { return 100; }

        return Math.max(-99, Math.min(99, (s.hp[0] - s.hp[1]) * 10 + inventoryScore(s.hands[0]) - inventoryScore(s.hands[1]) + (s.actor === 0 ? 1 : -1) * policy.tempo
            + (s.control[1] === 1 ? 5 : 0) - (s.control[0] === 1 ? 5 : 0)));
    }

    function copy(s: Position): Position {
        return { ...s, hp: [...s.hp], hands: s.hands.slice(), control: [...s.control] };
    }

    function advance(s: Position): void {
        const b = 1 - s.actor;

        if (s.control[b] === 1) {
            s.control[b] = 2;
            s.control[s.actor] = 0;
        } else {
            s.actor = b;
            s.control[b] = 0;
        }
    }

    function branches(s: Position, move: Move): [Position, number][] {
        const next = copy(s), a = s.actor, b = 1 - a;

        if (move.item) {
            next.hands[a] = consume(next.hands[a], move.steal ? 'adrenaline' : move.item);

            if (move.steal) {
                next.hands[b] = consume(next.hands[b], move.item);
            }

            if (move.item === 'medicine') {
                const loss = copy(next);
                loss.hp[a]--;
                next.hp[a] = Math.min(4, next.hp[a] + 2);

                return [[loss, 0.5], [next, 0.5]];
            }

            if (move.item === 'cigarette') { next.hp[a] = Math.min(4, next.hp[a] + 1); }

            if (move.item === 'saw') { next.saw = true; }

            if (move.item === 'cuffs' || move.item === 'jammer') { next.control[b] = 1; }

            if (move.item === 'inverter') {
                const entry = distribution(next.shells);
                next.shells = entry.inverted ??= intern(next.shells.map(mask => mask ^ 1));
            }

            if (move.item !== 'beer' && move.item !== 'glass') { return [[next, 1]]; }
        }

        const result: [Position, number][] = [];

        const { subsets, shifted } = distribution(s.shells);

        for (const shell of [0, 1]) {
            const subset = subsets[shell];

            if (!subset.length) { continue; }

            const branch = copy(next);
            branch.shells = subset;

            if (move.item !== 'glass') {
                branch.shells = shifted[shell];
                branch.remaining--;

                if (!move.item) {
                    branch.hp[move.self ? a : b] -= shell * (s.saw ? 2 : 1);
                    branch.saw = false;
                }

                // 换弹先于行动权转移，单人手铐在换弹时清除。
                if (!branch.remaining) {
                    branch.control = [0, 0];
                    branch.saw = false;
                }

                if (!move.item && (!move.self || shell)) { advance(branch); }
            }

            result.push([branch, subset.length / s.shells.length]);
        }

        return result;
    }

    const exhausted = Symbol('budget'), cache = new Map<string, number>();
    let nodes = 0;

    function search(s: Position, depth: number, alpha = -100, beta = 100): number {
        if (!depth || !s.remaining || s.hp.some(hp => hp <= 0)) { return evaluate(s); }

        if (nodes >= policy.nodes || performance.now() - started >= budgetMs) { throw exhausted; }

        const key = `${depth}|${s.remaining}|${s.actor}|${+s.saw}|${s.hp.join(',')}|${s.control.join(',')}|${inventoryKey(s.hands[0])}|${inventoryKey(s.hands[1])}|${distribution(s.shells).key}`, previous = cache.get(key);

        if (previous !== undefined) { return previous; }

        nodes++;
        const moves = options(s), originalAlpha = alpha, originalBeta = beta;
        const forced = moves.length === 1 && moves[0].item !== undefined;
        let result = s.actor === 0 ? -100 : 100;

        for (const move of moves) {
            const score = value(s, move, depth + (forced ? 1 : 0), alpha, beta);
            result = s.actor === 0 ? Math.max(result, score) : Math.min(result, score);

            if (level === 4) {
                if (s.actor === 0) { alpha = Math.max(alpha, result); } else { beta = Math.min(beta, result); }

                if (alpha >= beta) { break; }
            }
        }

        // 仅缓存精确值；剪枝边界不能作为下一深度或另一个窗口的结果。
        if (level === 3 || result > originalAlpha && result < originalBeta) { cache.set(key, result); }

        return result;
    }

    function value(s: Position, move: Move, depth: number, alpha = -100, beta = 100): number {
        const outcomes = branches(s, move);
        let sum = 0, remaining = 1;

        for (const [branch, chance] of outcomes) {
            remaining = Math.max(0, remaining - chance);
            // 未探索概率分支的上下界均来自合法评分范围，不预知真实弹种。
            const lower = level === 4 ? Math.max(-100, (alpha - sum - remaining * 100) / chance) : -100;
            const upper = level === 4 ? Math.min(100, (beta - sum + remaining * 100) / chance) : 100;
            sum += chance * search(branch, depth - 1, lower, upper);

            if (level === 4 && sum + remaining * 100 < alpha) { return sum + remaining * 100; }

            if (level === 4 && sum - remaining * 100 > beta) { return sum - remaining * 100; }
        }

        return sum;
    }

    // 完整比较一轮后才接纳结果；超时保留上一完整轮次，基础射击始终合法。
    let chosen = rootOptions[0];

    for (let depth = 1; depth <= policy.depth; depth++) {
        try {
            let best = -Infinity, candidate = chosen;

            for (const move of rootOptions) {
                const score = value(initial, move, depth, level === 4 ? best - 1e-9 : -100, 100);

                if (score > best || personality !== 'balanced' && score === best && preference(view, translate(move), personality) > preference(view, translate(candidate), personality)) {
                    best = score;
                    candidate = move;
                }
            }

            chosen = candidate;

            if (diagnostics) { diagnostics.depth = depth; }
        } catch (error) {
            if (error !== exhausted) { throw error; }

            break;
        }
    }

    if (diagnostics) { diagnostics.nodes = nodes; }

    return translate(chosen);
}
