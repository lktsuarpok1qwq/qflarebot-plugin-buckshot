import { chooseDemon } from './demon.js';
import { applyAction, legalActions, publicGame } from './engine.js';
import { secureRandom, type Action, type Game, type Knowledge, type RNG } from './types.js';

export interface AIView { public: ReturnType<typeof publicGame>; knowledge: Knowledge; cursor: number }

export function observe(game: Game): AIView {
    return { public: publicGame(game), knowledge: structuredClone(game.knowledge[game.current]), cursor: game.cursor };
}

function score(game: Game, id: string): number {
    if (game.finished) { return game.winner === id ? 100 : -100; }

    const self = game.players.find(p => p.id === id)!;
    const foes = game.players.filter(p => p.id !== id && p.life > 0);

    return self.life * 7 - foes.reduce((n, p) => n + p.life * 6, 0) + (game.current === id ? 2 : -2)
        + self.inventory.length * 0.3 + (game.saw ? (game.current === id ? 3 : -3) : 0)
        + foes.filter(p => p.control === 'skip').length * 6 - (self.control === 'skip' ? 6 : 0);
}

function world(view: AIView, possibility: number): Game {
    const shells = view.knowledge.possibilities[possibility];

    return {
        ...structuredClone(view.public), cursor: view.cursor, shells: [...Array(view.cursor).fill(0), ...shells], shot: false,
        knowledge: Object.fromEntries(view.public.players.map(p => [p.id, structuredClone(view.knowledge)]))
    };
}

export function chooseAction(view: AIView, level: number, rng: RNG = secureRandom, budgetMs = 4): Action {
    if (level === 4) { return chooseDemon(view, budgetMs); }

    const initial = world(view, 0), actor = initial.current, actions = legalActions(initial);
    const self = initial.players.find(p => p.id === actor)!;
    const probability = view.knowledge.possibilities.reduce((n, s) => n + s[0], 0) / view.knowledge.possibilities.length;
    // 基础评分覆盖所有动作；即使搜索预算耗尽，也不会因列表顺序永远忽略道具。
    const ranked = actions.map(action => {
        if (action.type === 'shoot') {
            const target = initial.players.find(p => p.id === action.target)!;
            const damage = initial.saw ? 2 : 1;

            return { action, value: target.id === actor ? (1 - probability) * 3 - probability * damage * 9 : probability * damage * 7 + (probability && target.life <= damage ? probability * 20 : 0) - 2 };
        }

        let item = self.inventory[action.slot];

        if (item === 'adrenaline') { item = initial.players.find(p => p.id === action.target)!.inventory[action.stolenSlot!]; }

        const value = item === 'cigarette' ? (self.life < 4 ? 7 : -4)
            : item === 'medicine' ? (self.life <= 2 ? 3 : -3)
                : item === 'glass' ? (probability > 0 && probability < 1 ? 5 : -4)
                    : item === 'phone' ? (view.knowledge.possibilities.length > 1 && view.knowledge.possibilities[0].length >= (initial.mode === 'solo' ? 2 : 3) ? 1 : -4)
                        : item === 'saw' ? probability * 7 - 0.5
                            : item === 'inverter' ? (0.5 - probability) * 8
                                : item === 'beer' ? (probability > 0.35 && probability < 0.7 ? 0.5 : -3)
                                    : item === 'cuffs' || item === 'jammer' ? 4 : -4;

        return { action, value: value - (self.inventory[action.slot] === 'adrenaline' ? 0.2 : 0) };
    }).sort((a, b) => b.value - a.value);

    if (!ranked.length) { throw new Error('AI 无合法动作'); }

    if (level === 0) { return ranked[rng(Math.min(3, ranked.length))].action; }

    if (level === 1) { return ranked[0].action; }

    const opponent = initial.players.find(p => p.id !== actor && p.life > 0)!;

    if (level === 3) {
        const use = (item: string) => ranked.find(({ action }) => action.type === 'item' && (self.inventory[action.slot] === 'adrenaline'
            ? initial.players.find(p => p.id === action.target)!.inventory[action.stolenSlot!] : self.inventory[action.slot]) === item)?.action;
        const damage = initial.saw ? 2 : 1;

        if (probability === 1 && opponent.life <= damage) { return { type: 'shoot', target: opponent.id }; }

        const heal = use('cigarette');

        if (heal && self.life < 4) { return heal; }

        const glass = use('glass');

        if (glass && probability > 0 && probability < 1) { return glass; }

        const saw = use('saw');

        if (saw && probability === 1 && opponent.life > 1) { return saw; }
    }

    // 无需让出行动权的确定收益先执行，避免浅层评价忽略情报与治疗价值。
    const forced = ranked.find(({ action }) => action.type === 'shoot' && action.target !== actor && probability === 1 && opponent.life <= (initial.saw ? 2 : 1))
        ?? ranked.find(({ action }) => {
            if (action.type !== 'item') { return false; }

            const item = self.inventory[action.slot] === 'adrenaline'
                ? initial.players.find(p => p.id === action.target)!.inventory[action.stolenSlot!] : self.inventory[action.slot];

            return item === 'cigarette' && self.life < 4 || item === 'glass' && probability > 0 && probability < 1
                || (item === 'cuffs' || item === 'jammer');
        });

    if (forced) { return forced.action; }

    const start = performance.now(), cap = [0, 0, 40, 100][level] ?? 40;
    let nodes = 0;
    const seen = new Set<string>();

    function search(state: Game, depth: number): number {
        const base = score(state, actor);

        if (!depth || state.finished || nodes >= cap || performance.now() - start >= budgetMs) { return base; }

        const key = JSON.stringify([state.players, state.current, state.direction, state.shells.slice(state.cursor), state.saw, depth]);

        if (seen.has(key)) { return base; }

        seen.add(key);
        const maximizing = state.current === actor;
        let best = maximizing ? -Infinity : Infinity;
        const candidates = legalActions(state).slice(0, 8);

        for (const action of candidates) {
            if (nodes++ >= cap || performance.now() - start >= budgetMs) { break; }

            const next = applyAction(state, state.current, action, rng).game;
            const value = search(next, depth - 1);
            best = maximizing ? Math.max(best, value) : Math.min(best, value);
        }

        return Number.isFinite(best) ? best : base;
    }

    let bestAction: Action = ranked[0].action;
    const samples = Array.from({ length: Math.min(4, view.knowledge.possibilities.length) }, (_, i) =>
        view.knowledge.possibilities.length <= 4 ? i : rng(view.knowledge.possibilities.length));
    const candidates = ranked.slice(0, 5);

    // 按完整轮次比较所有候选；不让排在前面的动作耗尽预算后垄断结果。
    for (let depth = 0; depth < level; depth++) {
        let best = -Infinity, complete = true;
        let chosen: Action = bestAction;

        for (const { action, value: heuristic } of candidates) {
            let sum = 0;
            seen.clear();

            for (const sample of samples) {
                if (nodes >= cap || performance.now() - start >= budgetMs) {
                    complete = false;
                    break;
                }

                const sampled = world(view, sample), next = applyAction(sampled, actor, action, rng).game;
                nodes++;
                sum += search(next, depth);
            }

            if (!complete) { break; }

            const value = sum / samples.length + heuristic * 3;

            if (value > best) {
                best = value;
                chosen = action;
            }
        }

        if (!complete) { break; }

        bestAction = chosen;
    }

    return bestAction;
}
