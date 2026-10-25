import type { RoomState } from '../room/model.js';
import type { ReplayAction } from '../replay/format.js';
import { dateParts } from '../replay/format.js';

export const COUNTS = ['games', 'cancelled', 'draws', 'players', 'humanWins', 'shots', 'live', 'blank', 'ejected', 'loads', 'items', 'damage', 'healing', 'timeouts', 'durationMs', 'unconfirmed', 'started', 'unopened', 'timedGames', 'completedDurationMs', 'completedShots', 'completedItems', 'completedTimeouts'] as const;
export const MONEY = ['stake', 'principal', 'transfer', 'refund', 'reward', 'burn'] as const;
export type CountKey = typeof COUNTS[number];
export type MoneyKey = typeof MONEY[number];
export type Counts = Record<CountKey, number>;
export type Money = Record<MoneyKey, number>;
export interface PlayerCounters { shots: number; live: number; blank: number; items: number; damage: number; healing: number; timeouts: number; quit: boolean; hp: number }
export interface MatchCounters {
    version: 1; startedAt?: number; finishedAt?: number; sealedAt?: number; cancelled: boolean;
    shots: number; live: number; blank: number; ejected: number; loads: number; items: number; damage: number; healing: number; timeouts: number;
    players: Record<string, PlayerCounters>;
}
export interface PlayerResult {
    game: string; name: string; ended: number; mode: string; difficulty: number; paid: boolean; outcome: 'win' | 'loss' | 'draw' | 'cancelled';
    shots: number; live: number; blank: number; items: number; damage: number; healing: number; timeouts: number; quit: boolean;
    money: 'free' | 'confirmed' | 'unconfirmed'; stake: number | null; returned: number | null; reward: number | null; net: number | null;
}
export type StatisticsKind = 'unknown' | 'solo' | 'daily' | 'duo' | 'multi' | 'multiAI';
export type Fact = { bot: string; game: string; day: string; mode: string; kind: StatisticsKind; paid: number; difficulty: number } & Counts & Money;

export function freshCounters(): MatchCounters { return { version: 1, cancelled: false, shots: 0, live: 0, blank: 0, ejected: 0, loads: 0, items: 0, damage: 0, healing: 0, timeouts: 0, players: Object.create(null) }; }

export function captureStatistics(s: RoomState, action: ReplayAction, actor: string | undefined, seq: number): void {
    const c = s.statistics;

    if (!c || !s.game) { return; }

    if (c.startedAt === undefined) {
        c.startedAt = Date.now();

        for (const p of s.game.players) { c.players[p.id] = { shots: 0, live: 0, blank: 0, items: 0, damage: 0, healing: 0, timeouts: 0, quit: false, hp: p.life }; }
    }

    const person = actor && Object.hasOwn(c.players, actor) ? c.players[actor] : undefined;
    const parts = s.outbox.filter(t => t.seq > seq).flatMap(t => t.parts ?? []);

    for (const p of parts) {
        if (p.key === 'shot') {
            c.shots++;
            c[p.values.shell === '1' ? 'live' : 'blank']++;

            if (person) {
                person.shots++;
                person[p.values.shell === '1' ? 'live' : 'blank']++;
            }
        } else if (p.key === 'eject') { c.ejected++; } else if (p.key === 'load') { c.loads++; }
    }

    if (action.type === 'item') {
        c.items++;

        if (person) { person.items++; }
    }

    if (action.type === 'timeout') {
        c.timeouts++;

        if (person) { person.timeouts++; }
    }

    if (action.type === 'quit' && person) { person.quit = true; }

    const target = Object.entries(s.replay?.ids ?? {}).find(([, alias]) => alias === action.target)?.[0] ?? action.target;

    if (action.type === 'shoot' && person && target && c.players[target]) {
        const life = s.game.players.find(p => p.id === target)?.life ?? c.players[target].hp;
        const damage = Math.max(0, c.players[target].hp - life);
        c.damage += damage;
        person.damage += damage;
    }

    if (action.type === 'item' && person) {
        const healing = Math.max(0, (s.game.players.find(p => p.id === actor)?.life ?? person.hp) - person.hp);
        c.healing += healing;
        person.healing += healing;
    }

    for (const p of s.game.players) { if (c.players[p.id]) { c.players[p.id].hp = p.life; } }

    if (s.game.finished) { c.finishedAt ??= Date.now(); }

    if (s.status === 'CANCELLED' || ['cancel', 'abort'].includes(action.type)) {
        c.cancelled = true;
        c.finishedAt ??= Date.now();
    }
}

// 仅复用已经由 Points 回执或预留查询确认的任务结果，不查询余额、不根据胜者推算到账。
export function confirmedMoney(s: RoomState) {
    const totals = Object.fromEntries(MONEY.map(k => [k, 0])) as Money;
    const people = Object.fromEntries(s.members.map(m => [m.id, { stake: 0, returned: 0, reward: 0, net: 0 }]));
    const result = (status: 'free' | 'confirmed' | 'unconfirmed') => ({ status, totals, people });

    const credit = s.money.find(t => t.kind === 'credit');

    if (credit) {
        const input = credit.input as Parameters<import('qflarebot-plugin-points').PointsService['credit']>[0];

        if (credit.state !== 'DONE' || credit.resolution !== 'committed' || !people[input.userId]) { return result('unconfirmed'); }

        people[input.userId].reward = input.amountMinor;
        people[input.userId].net = input.amountMinor;
        totals.reward = input.amountMinor;

        return result('confirmed');
    }

    if (!s.stake) { return result('free'); }

    if (s.money.some(t => !(t.state === 'DONE' && t.resolution || t.kind === 'reserve' && t.state === 'FAILED'))) { return result('unconfirmed'); }

    if (!s.reserved) { return result(s.game ? 'unconfirmed' : 'confirmed'); }

    const reserve = s.money.find(t => t.kind === 'reserve');

    if (!reserve || reserve.state !== 'DONE' || reserve.resolution !== 'committed') { return result('unconfirmed'); }

    for (const m of s.members) {
        people[m.id].stake = s.stake;
        totals.stake += s.stake;
    }

    let settled = false;

    for (const task of s.money) {
        if (task.kind === 'settle' && task.state === 'DONE' && task.resolution === 'committed') {
            const input = task.input as Parameters<import('qflarebot-plugin-points').PointsService['settle']>[0];
            settled = true;

            for (const fund of input.funds) {
                const owner = s.members.find((_, i) => fund.reservationId === `${s.gameId}:r:${i}`)?.id;

                if (!owner) { return result('unconfirmed'); }

                totals.burn += fund.burnMinor;

                for (const p of fund.payouts) {
                    if (!Object.hasOwn(people, p.userId)) { return result('unconfirmed'); }

                    people[p.userId].returned += p.amountMinor;
                    totals[p.userId === owner ? 'principal' : 'transfer'] += p.amountMinor;
                }
            }

            for (const reward of input.rewards) {
                if (!Object.hasOwn(people, reward.userId)) { return result('unconfirmed'); }

                people[reward.userId].reward += reward.amountMinor;
                totals.reward += reward.amountMinor;
            }
        } else if (task.kind === 'release' && task.state === 'DONE' && ['committed', 'inactive'].includes(task.resolution ?? '')) {
            const input = task.input as { reservationId: string };
            const owner = s.members.find((_, i) => input.reservationId === `${s.gameId}:r:${i}`)?.id;

            if (!owner) { return result('unconfirmed'); }

            settled = true;
            people[owner].returned += s.stake;
            totals.refund += s.stake;
        }
    }

    if (!settled) { return result('unconfirmed'); }

    for (const p of Object.values(people)) { p.net = p.returned + p.reward - p.stake; }

    if (Object.values(totals).some(n => !Number.isSafeInteger(n) || n < 0) || Object.values(people).some(p => Object.values(p).some(n => !Number.isSafeInteger(n))) || Object.values(people).reduce((n, p) => n + p.net, 0) !== totals.reward - totals.burn || totals.stake !== totals.principal + totals.transfer + totals.refund + totals.burn) { return result('unconfirmed'); }

    return result('confirmed');
}

export function playerResult(s: RoomState, user: string): PlayerResult | undefined {
    const c = s.statistics, p = c?.players[user], member = s.members.find(m => m.id === user);

    if (c?.startedAt === undefined || c.sealedAt === undefined || !p || !member) { return; }

    const money = confirmedMoney(s), amount = money.people[user];

    return {
        game: s.gameId, name: member.name, ended: c.sealedAt, mode: s.mode, difficulty: s.mode === 'solo' ? s.difficulty : -1, paid: !!s.stake,
        outcome: c.cancelled ? 'cancelled' : !s.game?.winner ? 'draw' : s.game.winner === user ? 'win' : 'loss',
        shots: p.shots, live: p.live, blank: p.blank, items: p.items, damage: p.damage, healing: p.healing, timeouts: p.timeouts, quit: p.quit,
        money: money.status, stake: money.status === 'unconfirmed' ? null : amount.stake, returned: money.status === 'unconfirmed' ? null : amount.returned, reward: money.status === 'unconfirmed' ? null : amount.reward, net: money.status === 'unconfirmed' ? null : amount.net
    };
}

export function statisticsFact(s: RoomState): Fact | undefined {
    const c = s.statistics;

    if (c?.sealedAt === undefined) { return; }

    const money = confirmedMoney(s), started = c.startedAt !== undefined, completed = started && !c.cancelled;
    const timed = completed && c.finishedAt !== undefined;
    const kind: StatisticsKind = s.challenge ? 'daily' : s.mode === 'multi' && (s.opponents?.length ?? 0) > 0 ? 'multiAI' : s.mode;

    return {
        bot: s.botId, game: s.gameId, day: dateParts(c.sealedAt).date, mode: s.mode, kind, paid: s.stake ? 1 : 0, difficulty: s.mode === 'solo' ? s.difficulty : -1,
        started: started ? 1 : 0, unopened: started ? 0 : 1, timedGames: timed ? 1 : 0,
        completedDurationMs: timed ? Math.max(0, c.finishedAt! - c.startedAt!) : 0,
        completedShots: completed ? c.shots : 0, completedItems: completed ? c.items : 0, completedTimeouts: completed ? c.timeouts : 0,
        games: started && !c.cancelled ? 1 : 0, cancelled: !started || c.cancelled ? 1 : 0, draws: started && !c.cancelled && !s.game?.winner ? 1 : 0,
        players: started ? s.members.length : 0, humanWins: started && !c.cancelled && s.game?.winner && s.members.some(m => m.id === s.game!.winner) ? 1 : 0,
        shots: c.shots, live: c.live, blank: c.blank, ejected: c.ejected, loads: c.loads, items: c.items, damage: c.damage, healing: c.healing, timeouts: c.timeouts,
        durationMs: c.startedAt !== undefined && c.finishedAt !== undefined ? Math.max(0, c.finishedAt - c.startedAt) : 0, unconfirmed: money.status === 'unconfirmed' ? 1 : 0,
        ...Object.fromEntries(MONEY.map(k => [k, money.status === 'unconfirmed' ? 0 : money.totals[k]])) as Money
    };
}

export function signedPoints(minor: number | string): string {
    const n = BigInt(minor), absolute = n < 0n ? -n : n;

    return (n > 0n ? '+' : n < 0n ? '-' : '') + absolute / 100n + '.' + String(absolute % 100n).padStart(2, '0');
}
