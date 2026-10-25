import type { Action, Item } from '../game/types.js';

export interface MenuEntry { display: Action; move?: Action; path?: number[]; item?: Item; player?: string }
interface MenuPlayer { id: string; inventory: Item[] }

// 菜单路径只描述浏览层级；最终动作始终取自本次最新合法动作集。
export function menuEntries(moves: Action[], players: MenuPlayer[], actor: string, requested: number[] = []): { entries: MenuEntry[]; path: number[]; back: number[]; stage: string; item: Item | undefined } {
    const self = players.find(p => p.id === actor), slot = requested[0], donor = players[requested[1]];
    const root = (): MenuEntry[] => {
        const seen = new Set<number>();

        return moves.flatMap<MenuEntry>(move => {
            if (move.type !== 'item') { return [{ display: move, move }]; }

            if (seen.has(move.slot)) { return []; }

            seen.add(move.slot);
            const targets = new Set(moves.filter(m => m.type === 'item' && m.slot === move.slot).map(m => m.type === 'item' ? m.target : undefined));
            const steal = self?.inventory[move.slot] === 'adrenaline';
            const choice = steal ? { path: targets.size === 1 ? [move.slot, players.findIndex(p => p.id === move.target)] : [move.slot] }
                : targets.size > 1 ? { path: [move.slot] } : { move };

            return [{ display: { type: 'item' as const, slot: move.slot }, ...choice }];
        });
    };
    const items = moves.filter((m): m is Extract<Action, { type: 'item' }> => m.type === 'item' && m.slot === slot && m.target !== undefined);
    const stolen = self?.inventory[slot] === 'adrenaline';
    const targets = new Set(items.map(m => m.target));

    // 跳过唯一对象，但偷取的道具仍由玩家选择；浏览请求不能隐式执行动作。
    if (requested.length === 1 && stolen && targets.size === 1) { return menuEntries(moves, players, actor, [slot, players.findIndex(p => p.id === items[0].target)]); }

    const selected = requested.length === 1 ? items : items.filter(m => m.target === donor?.id && (requested.length === 2 || m.stolenSlot === requested[2]));

    if (!requested.length || requested.length === 1 && targets.size < 2 || !selected.length || requested.length > 1 && !stolen || requested.length === 3 && selected[0]?.stolenTarget === undefined) { return { entries: root(), path: [] as number[], back: [] as number[], stage: '', item: undefined }; }

    if (requested.length === 3 && new Set(selected.map(m => m.stolenTarget)).size === 1) { return menuEntries(moves, players, actor, requested.slice(0, 2)); }

    const seen = new Set<string | number>(), entries: MenuEntry[] = [];

    for (const move of selected) {
        const key = requested.length === 1 ? move.target! : requested.length === 2 ? move.stolenSlot! : move.stolenTarget!;

        if (seen.has(key)) { continue; }

        seen.add(key);

        if (requested.length === 1) {
            entries.push({ display: move, player: move.target, ...(stolen ? { path: [slot, players.findIndex(p => p.id === move.target)] } : { move }) });
        } else if (requested.length === 2) {
            const recipients = new Set(selected.filter(m => m.stolenSlot === move.stolenSlot).map(m => m.stolenTarget));
            entries.push({ display: move, item: donor.inventory[move.stolenSlot!], ...(recipients.size > 1 ? { path: [...requested, move.stolenSlot!] } : { move }) });
        } else { entries.push({ display: move, player: move.stolenTarget, move }); }
    }

    return { entries, path: requested, back: requested.length === 2 && targets.size === 1 ? [] : requested.slice(0, -1), stage: requested.length === 2 ? 'menuStealStage' : 'menuTargetStage', item: requested.length === 3 ? donor.inventory[requested[2]] : self?.inventory[slot] };
}
