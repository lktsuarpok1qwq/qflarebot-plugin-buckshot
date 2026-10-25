import type { AIView } from './observation.js';
import type { Action } from './types.js';

export const PERSONALITIES = ['balanced', 'aggressive', 'cautious', 'tricky'] as const;
export type Personality = typeof PERSONALITIES[number];

// 只打破同分动作的平局；不改变评价、候选范围、必胜动作或搜索预算。
export function preference(view: AIView, action: Action, style: Personality): number {
    if (style === 'balanced') { return 0; }

    const self = view.public.players.find(p => p.id === view.public.current)!;

    if (action.type === 'shoot') { return style === 'aggressive' && action.target !== self.id ? 4 : 0; }

    if (action.type !== 'item') { return 0; }

    const stolen = self.inventory[action.slot] === 'adrenaline';
    const item = stolen ? view.public.players.find(p => p.id === action.target)?.inventory[action.stolenSlot!] : self.inventory[action.slot];

    return style === 'cautious' ? (['glass', 'phone', 'cigarette', 'beer'].includes(item!) ? 4 : 1)
        : style === 'tricky' ? (stolen ? 5 : ['cuffs', 'jammer', 'inverter'].includes(item!) ? 4 : 1)
            : item === 'saw' ? 3 : 0;
}
