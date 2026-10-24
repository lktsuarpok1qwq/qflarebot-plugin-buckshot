import { ITEM_NAMES, itemPool, requireRule, secureRandom, shuffle, type Action, type Game, type GameEvent, type Item, type Mode, type Player, type RNG, type Shell } from './types.js';

function player(game: Game, id: string): Player {
    const value = game.players.find(p => p.id === id);
    requireRule(value, '玩家不存在');

    return value;
}

export function arrangements(live: number, blank: number): Shell[][] {
    if (!live) { return [Array(blank).fill(0)]; }

    if (!blank) { return [Array(live).fill(1)]; }

    return [...arrangements(live - 1, blank).map(t => [1, ...t] as Shell[]), ...arrangements(live, blank - 1).map(t => [0, ...t] as Shell[])];
}

function load(game: Game, rng: RNG, events: GameEvent[]): void {
    const count = 2 + rng(7), live = Math.floor(count / 2) + (count % 2 ? rng(2) : 0);
    game.loadId++;
    game.shells = shuffle(Array.from({ length: count }, (_, i) => i < live ? 1 : 0), rng);
    game.cursor = 0;
    game.shot = false;
    game.saw = false;
    const amount = 2 + rng(3), pool = itemPool(game.mode);

    for (const p of game.players) {
        if (game.mode === 'solo') { p.control = 'none'; }

        game.knowledge[p.id] = { loadId: game.loadId, live, blank: count - live, known: {}, possibilities: arrangements(live, count - live) };

        if (p.life > 0) {
            for (let i = 0, slots = Math.min(amount, 8 - p.inventory.length); i < slots; i++) {
                p.inventory.push(pool[rng(pool.length)]);
            }
        }
    }

    events.push({ type: 'load', message: { key: 'load', values: { count: String(count), live: String(live), blank: String(count - live) } }, text: `装填：${count} 发，${live} 实弹、${count - live} 空弹`, loadId: game.loadId, live, blank: count - live });
}

export function createGame(mode: Mode, players: Pick<Player, 'id' | 'name' | 'ai'>[], rng: RNG = secureRandom): { game: Game; events: GameEvent[] } {
    requireRule(new Set(players.map(p => p.id)).size === players.length, '玩家重复');
    requireRule(mode === 'multi' ? players.length >= 3 && players.length <= 4 : players.length === 2, '人数不符合模式');
    requireRule(mode === 'solo' ? players.filter(p => p.ai).length === 1 : players.every(p => !p.ai), 'AI 不符合模式');
    const seats = shuffle(players.map(p => ({ ...p, life: 4, inventory: [], control: 'none', timeouts: 0 } as Player)), rng);
    const game: Game = { mode, players: seats, current: seats[0].id, direction: 1, turn: 1, loadId: 0, shells: [], cursor: 0, saw: false, shot: false, knowledge: {}, finished: false, winner: null };
    const events: GameEvent[] = [];
    load(game, rng, events);

    return { game, events };
}

function finish(game: Game, events: GameEvent[]): boolean {
    const alive = game.players.filter(p => p.life > 0);

    if (alive.length > 1) { return false; }

    game.finished = true;
    game.winner = alive[0]?.id ?? null;

    for (const p of game.players) { p.control = 'none'; }

    events.push({ type: 'finish', message: { key: alive.length ? 'finish' : 'noWinner', values: { name: alive[0]?.name ?? '' } }, text: alive.length ? `胜者：${alive[0].name}` : '本局无胜者' });

    return true;
}

function advance(game: Game, events: GameEvent[]): void {
    let index = game.players.findIndex(p => p.id === game.current);

    // 最多两圈，第一圈消耗全部待跳过状态，第二圈必能选中存活者。
    for (let step = 0; step < game.players.length * 2; step++) {
        index = (index + game.direction + game.players.length) % game.players.length;
        const next = game.players[index];

        if (next.life <= 0) { continue; }

        if (next.control === 'skip') {
            next.control = 'release';
            events.push({ type: 'skip', message: { key: 'skip', values: { name: next.name } }, text: `${next.name} 跳过行动` });
            continue;
        }

        next.control = 'none';
        game.current = next.id;
        game.turn++;

        return;
    }

    throw new Error('行动顺序异常');
}

function consumeShell(game: Game): Shell {
    const shell = game.shells[game.cursor++];

    for (const knowledge of Object.values(game.knowledge)) {
        knowledge.possibilities = knowledge.possibilities.filter(p => p[0] === shell).map(p => p.slice(1));

        if (knowledge.live >= 0 && knowledge.blank >= 0) {
            if (shell) { knowledge.live--; } else { knowledge.blank--; }
        }

        delete knowledge.known[game.cursor - 1];
    }

    return shell;
}

function itemAllowed(game: Game, actor: Player, item: Item, target?: string): boolean {
    const other = game.players.find(p => p.id === target);

    if (!itemPool(game.mode).includes(item)) { return false; }

    if (item === 'saw') { return !game.saw; }

    if (item === 'cuffs' || item === 'jammer') { return !!other && other.id !== actor.id && other.life > 0 && other.control === 'none'; }

    return item !== 'adrenaline';
}

export function legalActions(game: Game, actorId = game.current): Extract<Action, { type: 'shoot' | 'item' }>[] {
    if (game.finished || actorId !== game.current) { return []; }

    const actor = player(game, actorId), actions: Extract<Action, { type: 'shoot' | 'item' }>[] = [];

    if (actor.life <= 0) { return []; }

    for (const target of game.players.filter(p => p.life > 0)) { actions.push({ type: 'shoot', target: target.id }); }

    const targets = (item: Item) => item === 'cuffs' || item === 'jammer' ? game.players.map(p => p.id) : [undefined];
    actor.inventory.forEach((item, slot) => {
        if (item !== 'adrenaline') {
            for (const target of targets(item)) {
                if (itemAllowed(game, actor, item, target)) { actions.push({ type: 'item', slot, ...(target ? { target } : {}) }); }
            }
        } else {
            for (const donor of game.players.filter(p => p.id !== actorId)) {
                donor.inventory.forEach((stolen, stolenSlot) => {
                    for (const stolenTarget of targets(stolen)) {
                        if (itemAllowed(game, actor, stolen, stolenTarget)) {
                            actions.push({ type: 'item', slot, target: donor.id, stolenSlot, ...(stolenTarget ? { stolenTarget } : {}) });
                        }
                    }
                });
            }
        }
    });

    return actions;
}

function useItem(game: Game, actor: Player, item: Item, target: string | undefined, rng: RNG, events: GameEvent[]): void {
    events.push({ type: 'item', message: { key: 'item', values: { actor: actor.name, item, target: target ? player(game, target).name : '' } }, text: `${actor.name} 使用${ITEM_NAMES[item]}${target ? ` → ${player(game, target).name}` : ''}` });

    if (item === 'glass' || item === 'phone') {
        const n = game.shells.length - game.cursor, first = game.mode === 'solo' ? 2 : 3;
        const relative = item === 'glass' ? 1 : n >= first ? Math.min(7, first + rng(n - first + 1)) : 0;

        if (relative) {
            const position = game.cursor + relative - 1, shell = game.shells[position];
            game.knowledge[actor.id].known[position] = shell;
            game.knowledge[actor.id].possibilities = game.knowledge[actor.id].possibilities.filter(p => p[relative - 1] === shell);
            events.push({ type: 'intel', recipient: actor.id, loadId: game.loadId, intel: { loadId: game.loadId, position, shell }, message: { key: 'intel', values: { loadId: String(game.loadId), position: String(relative), shell: String(shell) } }, text: `装填 ${game.loadId}：使用时第 ${relative} 发是${shell ? '实弹' : '空弹'}` });
        } else {
            events.push({ type: 'intel', recipient: actor.id, loadId: game.loadId, message: { key: 'noIntel', values: {} }, text: '电话没有提供弹药情报' });
        }
    } else if (item === 'beer') {
        const shell = consumeShell(game);
        events.push({ type: 'eject', message: { key: 'eject', values: { shell: String(shell) } }, text: `退掉${shell ? '实弹' : '空弹'}` });
    } else if (item === 'cigarette') {
        actor.life = Math.min(4, actor.life + 1);
    } else if (item === 'medicine') {
        actor.life = Math.min(4, actor.life + (rng(2) ? 2 : -1));
    } else if (item === 'saw') {
        game.saw = true;
    } else if (item === 'remote') {
        game.direction = game.direction === 1 ? -1 : 1;
    } else if (item === 'cuffs' || item === 'jammer') {
        player(game, target!).control = 'skip';
    } else if (item === 'inverter') {
        const old = game.shells[game.cursor];
        game.shells[game.cursor] = old ? 0 : 1;

        // 只有已知当前弹的观察者能确定新比例；不读取他人的私密信息。
        for (const knowledge of Object.values(game.knowledge)) {
            knowledge.possibilities = knowledge.possibilities.map(p => [p[0] ? 0 : 1, ...p.slice(1)]);

            if (knowledge.known[game.cursor] !== undefined) {
                const known = knowledge.known[game.cursor];
                knowledge.known[game.cursor] = known ? 0 : 1;
                knowledge.live += known ? -1 : 1;
                knowledge.blank += known ? 1 : -1;
            } else {
                // 未知反转后的计数由 AI 的公开观测分布计算，不把真实类型写入知识。
                knowledge.live = -1;
                knowledge.blank = -1;
            }
        }
    }
}

export function applyAction(input: Game, actorId: string, action: Action, rng: RNG = secureRandom): { game: Game; events: GameEvent[] } {
    const game = structuredClone(input), events: GameEvent[] = [];
    requireRule(!game.finished, '对局已结束');
    const actor = player(game, actorId);
    let pass = false;

    if (action.type === 'eliminate') {
        const target = player(game, action.target);
        requireRule(target.life > 0, '玩家已淘汰');
        target.life = 0;
        pass = target.id === game.current;
        events.push({ type: 'eliminate', message: { key: 'eliminate', values: { name: target.name } }, text: `${target.name} 淘汰` });
    } else {
        requireRule(actorId === game.current && actor.life > 0, '未轮到你行动');

        if (action.type === 'timeout') {
            actor.timeouts++;
            pass = true;

            if (actor.timeouts >= 3) { actor.life = 0; }

            events.push({ type: 'eliminate', message: { key: actor.life ? 'timeout' : 'timeoutEliminate', values: { name: actor.name } }, text: `${actor.name} 操作超时${actor.life ? '' : '，已淘汰'}` });
        } else {
            requireRule(legalActions(game).some(a => a.type === action.type && (a.type === 'shoot' && action.type === 'shoot' ? a.target === action.target : a.type === 'item' && action.type === 'item' && a.slot === action.slot && a.target === action.target && a.stolenSlot === action.stolenSlot && a.stolenTarget === action.stolenTarget)), '操作或道具目标无效');

            if (action.type === 'shoot') {
                const target = player(game, action.target), shell = consumeShell(game);
                target.life = Math.max(0, target.life - shell * (game.saw ? 2 : 1));
                game.saw = false;
                game.shot = true;
                actor.timeouts = 0;
                pass = target.id !== actorId || !!shell;

                if (!pass) { game.turn++; }

                events.push({ type: 'shot', loadId: game.loadId, message: { key: 'shot', values: { actor: actor.name, target: target.name, shell: String(shell) } }, text: `${actor.name} → ${target.name}：${shell ? '实弹' : '空弹'}` });
            } else {
                let item = actor.inventory[action.slot], target = action.target;
                actor.inventory.splice(action.slot, 1);

                if (item === 'adrenaline') {
                    const donor = player(game, target!);
                    item = donor.inventory.splice(action.stolenSlot!, 1)[0];
                    target = action.stolenTarget;
                    events.push({ type: 'item', message: { key: 'steal', values: { actor: actor.name, target: donor.name, item } }, text: `${actor.name} 使用肾上腺素，从 ${donor.name} 偷取${ITEM_NAMES[item]}` });
                }

                useItem(game, actor, item, target, rng, events);
                pass = actor.life <= 0;
            }
        }
    }

    if (!finish(game, events)) {
        if (game.cursor === game.shells.length) { load(game, rng, events); }

        if (pass) { advance(game, events); }
    }

    return { game, events };
}

export function publicGame(game: Game) {
    const { players, mode, current, direction, turn, loadId, saw, finished, winner } = game;

    return { players: structuredClone(players), mode, current, direction, turn, loadId, saw, finished, winner };
}
