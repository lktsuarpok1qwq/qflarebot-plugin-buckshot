import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import { renderTemplate } from '../templates/replies.js';
import { dateParts } from '../replay/format.js';
import type { RoomState } from '../room/model.js';
import type { Part } from '../templates/presentation.js';
import { confirmedMoney, signedPoints } from './model.js';
import type { PersonalTotals } from './personal.js';
import type { PlayerResult } from './model.js';

export function endStatistics(s: RoomState): Part[] {
    const c = s.statistics;

    if (c?.startedAt === undefined || c.finishedAt === undefined) { return []; }

    const result: Part[] = [{ key: 'matchStatistics', values: { shots: String(c.shots), live: String(c.live), blank: String(c.blank), ejected: String(c.ejected), loads: String(c.loads), items: String(c.items), seconds: String(Math.ceil(Math.max(0, c.finishedAt - c.startedAt) / 1000)) } }];
    const money = confirmedMoney(s);

    if (money.status === 'free') { result.push({ key: 'matchFree', values: {} }); } else if (money.status === 'unconfirmed') { result.push({ key: 'matchPending', values: {} }); } else {
        result.push({ key: 'matchConfirmed', values: {} });

        for (const m of s.members) { result.push({ key: 'matchNet', values: { name: m.name, amount: signedPoints(money.people[m.id].net) } }); }
    }

    return result;
}

export function personalText(data: { totals: PersonalTotals; recent: { result: PlayerResult; game: string }[] }): string {
    const t = (key: string, values: Record<string, string | number> = {}) => renderTemplate(DEFAULT_CONFIGURATION.replies[key], Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])));
    const a = data.totals.all;

    if (!data.recent.length) { return t('statisticsEmpty'); }

    const rate = (wins: number, losses: number) => wins + losses ? (wins * 100 / (wins + losses)).toFixed(1) + '%' : '—';
    const modes: Record<string, string> = { solo: 'modeSolo', duo: 'modeDuo', multi: 'modeMulti' };
    const modeRows = Object.entries(data.totals.modes).map(([mode, row]) => t('statisticsMode', { mode: t(modes[mode]), games: row.games, wins: row.wins, losses: row.losses, rate: rate(row.wins, row.losses) })).join('\n');
    const levelRows = Object.entries(data.totals.levels).map(([level, row]) => t('statisticsMode', { mode: t('level' + level), games: row.games, wins: row.wins, losses: row.losses, rate: rate(row.wins, row.losses) })).join('\n');
    const outcome: Record<string, string> = { win: 'statisticsWin', loss: 'statisticsLoss', draw: 'statisticsDraw', cancelled: 'statisticsCancelled' };
    const recent = data.recent.map(({ game, result: r }) => {
        const time = dateParts(r.ended);

        return t('statisticsRecent', { time: time.date + ' ' + time.time, mode: t(modes[r.mode]), result: t(outcome[r.outcome]), net: r.net === null ? t('statisticsUnconfirmed') : signedPoints(r.net), gameId: game });
    }).join('\n');

    return t('statistics', { name: data.recent[0].result.name, games: a.games, wins: a.wins, losses: a.losses, draws: a.draws, cancelled: a.cancelled, rate: rate(a.wins, a.losses), streak: a.streak, best: a.best, shots: a.shots, live: a.live, blank: a.blank, items: a.items, damage: a.damage, healing: a.healing, timeouts: a.timeouts, net: signedPoints(a.net), stake: signedPoints(a.stake).replace(/^\+/, ''), returned: signedPoints(a.returned).replace(/^\+/, ''), reward: signedPoints(a.reward).replace(/^\+/, ''), unconfirmed: a.unconfirmed, freeGames: data.totals.free.games, paidGames: data.totals.points.games, modes: modeRows, levels: levelRows, recent });
}
