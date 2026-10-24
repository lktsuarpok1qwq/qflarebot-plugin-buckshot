import type { AIView } from './ai.js';
import type { Action, Item } from './types.js';

interface Position {
    shells: number[]; remaining: number; hp: number[]; hands: Item[][];
    control: number[]; actor: number; saw: boolean;
}
interface Move { item?: Item; self?: boolean; steal?: boolean }

// 弹药位图来自自身的合法可能排列；对手的私密知识、实际弹仓和 RNG 不进入模型。
export function chooseDemon(view: AIView, budgetMs: number, diagnostics?: { nodes: number; depth: number }): Action {
    const own = view.public.players.find(p => p.id === view.public.current)!;
    const enemy = view.public.players.find(p => p.id !== own.id && p.life > 0)!;
    const initial: Position = {
        shells: view.knowledge.possibilities.map(p => p.reduce<number>((mask, bit, i) => mask | bit << i, 0)),
        remaining: view.knowledge.possibilities[0].length, hp: [own.life, enemy.life],
        hands: [[...own.inventory], [...enemy.inventory]],
        control: [own, enemy].map(p => p.control === 'skip' ? 1 : p.control === 'release' ? 2 : 0),
        actor: 0, saw: view.public.saw
    };
    const probability = (s: Position) => s.shells.reduce((sum, mask) => sum + (mask & 1), 0) / s.shells.length;
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

        const heal = available(s, 'cigarette');

        if (heal && s.hp[a] < 4) { return [heal]; }

        const glass = available(s, 'glass');

        if (glass && p > 0 && p < 1) { return [glass]; }

        const result: Move[] = p === 0 ? [{ self: true }] : p === 1 ? [{ self: false }] : [{ self: false }, { self: true }];

        for (const steal of [true, false]) {
            if (steal && !s.hands[a].includes('adrenaline')) { continue; }

            for (const item of new Set(s.hands[steal ? b : a])) {
                if (item === 'saw' && !s.saw && p > 0
                    || item === 'inverter' && p < 1
                    || item === 'beer' && (p > 0 && p < 1 || p === 0 && s.saw)
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

    if (rootOptions.length === 1) { return translate(rootOptions[0]); }

    if (p === 1 && enemy.life <= (initial.saw ? 2 : 1)) { return translate({ self: false }); }

    if (phone && initial.shells.some(mask => (mask ^ initial.shells[0]) & 126)) { return translate(phone); }

    const values: Partial<Record<Item, number>> = { glass: 2.4, beer: 1.5, cigarette: 3.5, saw: 4, cuffs: 4, jammer: 4, inverter: 3, medicine: 1.2, adrenaline: 5, phone: 1.5 };

    function evaluate(s: Position): number {
        if (s.hp[0] <= 0) { return -100; }

        if (s.hp[1] <= 0) { return 100; }

        const hand = (i: number) => s.hands[i].reduce((sum, item) => sum + (values[item] || 0), 0);

        return (s.hp[0] - s.hp[1]) * 10 + hand(0) - hand(1) + (s.actor === 0 ? 8 : -8)
            + (s.control[1] === 1 ? 5 : 0) - (s.control[0] === 1 ? 5 : 0);
    }

    function copy(s: Position): Position {
        return { ...s, hp: [...s.hp], hands: s.hands.map(h => [...h]), control: [...s.control] };
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
            next.hands[a].splice(next.hands[a].indexOf(move.steal ? 'adrenaline' : move.item), 1);

            if (move.steal) { next.hands[b].splice(next.hands[b].indexOf(move.item), 1); }

            if (move.item === 'medicine') {
                const loss = copy(next);
                loss.hp[a]--;
                next.hp[a] = Math.min(4, next.hp[a] + 2);

                return [[loss, 0.5], [next, 0.5]];
            }

            if (move.item === 'cigarette') { next.hp[a] = Math.min(4, next.hp[a] + 1); }

            if (move.item === 'saw') { next.saw = true; }

            if (move.item === 'cuffs' || move.item === 'jammer') { next.control[b] = 1; }

            if (move.item === 'inverter') { next.shells = next.shells.map(mask => mask ^ 1); }

            if (move.item !== 'beer' && move.item !== 'glass') { return [[next, 1]]; }
        }

        const result: [Position, number][] = [];

        const subsets: number[][] = [[], []];

        for (const mask of s.shells) { subsets[mask & 1].push(mask); }

        for (const shell of [0, 1]) {
            const subset = subsets[shell];

            if (!subset.length) { continue; }

            const branch = copy(next);
            branch.shells = subset;

            if (move.item !== 'glass') {
                branch.shells = subset.map(mask => mask >>> 1);
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

    const started = performance.now(), exhausted = Symbol('budget'), cache = new Map<string, number>();
    let nodes = 0;

    function search(s: Position, depth: number): number {
        if (!depth || !s.remaining || s.hp.some(hp => hp <= 0)) { return evaluate(s); }

        if (nodes >= 2400 || performance.now() - started >= budgetMs) { throw exhausted; }

        const key = `${depth}|${s.remaining}|${s.actor}|${+s.saw}|${s.hp.join(',')}|${s.control.join(',')}|${s.hands[0].join(',')}|${s.hands[1].join(',')}|${s.shells.join(',')}`, previous = cache.get(key);

        if (previous !== undefined) { return previous; }

        nodes++;
        const moves = options(s);
        const forced = moves.length === 1 && moves[0].item !== undefined;
        let result = s.actor === 0 ? -Infinity : Infinity;

        for (const move of moves) {
            const score = value(s, move, depth + (forced ? 1 : 0));
            result = s.actor === 0 ? Math.max(result, score) : Math.min(result, score);
        }

        cache.set(key, result);

        return result;
    }

    function value(s: Position, move: Move, depth: number): number {
        return branches(s, move).reduce((sum, [branch, chance]) => sum + chance * search(branch, depth - 1), 0);
    }

    // 完整比较一轮后才接纳结果；超时保留上一完整轮次，基础射击始终合法。
    let chosen = rootOptions[0];

    for (let depth = 1; depth <= 10; depth++) {
        try {
            let best = -Infinity, candidate = chosen;

            for (const move of rootOptions) {
                const score = value(initial, move, depth);

                if (score > best) {
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
