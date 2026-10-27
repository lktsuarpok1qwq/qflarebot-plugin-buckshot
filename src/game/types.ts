export type Mode = 'solo' | 'duo' | 'multi';
export type Item = 'glass' | 'beer' | 'cigarette' | 'saw' | 'cuffs' | 'jammer' | 'phone' | 'inverter' | 'medicine' | 'adrenaline' | 'remote';
export type Shell = 0 | 1;
export type Control = 'none' | 'skip' | 'release';
export interface Player {
    id: string; name: string; ai: boolean; life: number; inventory: Item[]; control: Control; timeouts: number;
}
export interface Intel { loadId: number; position: number; shell: Shell }
export interface Knowledge {
    loadId: number; live: number; blank: number; known: Record<number, Shell>; remaining: number; possibilities: number[];
}
export interface Game {
    mode: Mode; players: Player[]; current: string; direction: 1 | -1; turn: number;
    loadId: number; shells: Shell[]; cursor: number; saw: boolean; shot: boolean;
    knowledge: Record<string, Knowledge>; finished: boolean; winner: string | null;
}
export type Action = { type: 'shoot'; target: string } | {
    type: 'item'; slot: number; target?: string; stolenSlot?: number; stolenTarget?: string;
} | { type: 'timeout' } | { type: 'eliminate'; target: string };
export interface GameEvent {
    message?: { key: string; values: Record<string, string>; users?: Record<string, string> };
    type: 'load' | 'shot' | 'eject' | 'item' | 'intel' | 'skip' | 'eliminate' | 'finish';
    text: string; recipient?: string; loadId?: number; live?: number; blank?: number; intel?: Intel;
}
export type RNG = (exclusiveMax: number) => number;
export const ITEM_NAMES: Record<Item, string> = {
    glass: '放大镜', beer: '啤酒', cigarette: '香烟', saw: '手锯', cuffs: '手铐', jammer: '干扰器',
    phone: '电话', inverter: '逆转器', medicine: '过期药品', adrenaline: '肾上腺素', remote: '遥控器'
};

export function requireRule(condition: unknown, message: string): asserts condition {
    if (!condition) { throw new Error(message); }
}

export function secureRandom(max: number): number {
    requireRule(Number.isSafeInteger(max) && max > 0 && max <= 0x100000000, '随机范围无效');
    const limit = Math.floor(0x100000000 / max) * max;
    const bytes = new Uint32Array(1);

    do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);

    return bytes[0] % max;
}

export function shuffle<T>(values: T[], rng: RNG): T[] {
    for (let i = values.length - 1; i > 0; i--) {
        const j = rng(i + 1);
        [values[i], values[j]] = [values[j], values[i]];
    }

    return values;
}

const commonItems: readonly Item[] = ['glass', 'beer', 'cigarette', 'saw', 'phone', 'inverter', 'adrenaline'];
const itemPools: Record<Mode, readonly Item[]> = {
    solo: [...commonItems, 'cuffs', 'medicine'], duo: [...commonItems, 'jammer'], multi: [...commonItems, 'jammer', 'remote']
};

export function itemPool(mode: Mode): readonly Item[] { return itemPools[mode]; }
