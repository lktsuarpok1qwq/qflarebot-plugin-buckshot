import type { PlayerResult } from './model.js';

export interface Totals {
    games: number; wins: number; losses: number; draws: number; cancelled: number; shots: number; live: number; blank: number; items: number; damage: number; healing: number; timeouts: number; quits: number; streak: number; best: number; unconfirmed: number;
    stake: string; returned: string; reward: string; net: string;
}
export interface PersonalTotals { version: 1; all: Totals; free: Totals; points: Totals; modes: Record<string, Totals>; levels: Record<string, Totals> }

function fresh(): Totals { return { games: 0, wins: 0, losses: 0, draws: 0, cancelled: 0, shots: 0, live: 0, blank: 0, items: 0, damage: 0, healing: 0, timeouts: 0, quits: 0, streak: 0, best: 0, unconfirmed: 0, stake: '0', returned: '0', reward: '0', net: '0' }; }

export function emptyPersonal(): PersonalTotals { return { version: 1, all: fresh(), free: fresh(), points: fresh(), modes: {}, levels: {} }; }

function update(t: Totals, result: PlayerResult): void {
    if (result.outcome === 'cancelled') { t.cancelled++; } else {
        t.games++;
        t[result.outcome === 'win' ? 'wins' : result.outcome === 'loss' ? 'losses' : 'draws']++;
        t.streak = result.outcome === 'win' ? t.streak + 1 : 0;
        t.best = Math.max(t.best, t.streak);
    }

    for (const k of ['shots', 'live', 'blank', 'items', 'damage', 'healing', 'timeouts'] as const) { t[k] += result[k]; }

    if (result.quit) { t.quits++; }

    if (result.money === 'unconfirmed') { t.unconfirmed++; } else {
        for (const k of ['stake', 'returned', 'reward', 'net'] as const) { t[k] = String(BigInt(t[k]) + BigInt(result[k]!)); }
    }
}

export function appendPersonal(value: PersonalTotals, result: PlayerResult): void {
    update(value.all, result);
    update(result.paid ? value.points : value.free, result);
    update(value.modes[result.mode] ??= fresh(), result);

    if (result.mode === 'solo') { update(value.levels[String(result.difficulty)] ??= fresh(), result); }
}
