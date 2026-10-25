import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import { renderTemplate, formatRoomId } from '../templates/replies.js';
import { dateParts } from '../replay/format.js';
import type { RoomState } from '../room/model.js';
import type { Part } from '../templates/presentation.js';
import { confirmedMoney, signedPoints } from './model.js';
import type { PersonalTotals } from './personal.js';
import type { PlayerResult } from './model.js';

export function endStatistics(s: RoomState): Part[] {
    const c = s.statistics;

    if (c?.startedAt === undefined || c.finishedAt === undefined) { return []; }

    const result: Part[] = [], money = confirmedMoney(s), amount = (n: number) => signedPoints(n).replace(/^\+/, '');
    const level = DEFAULT_CONFIGURATION.replies['level' + s.difficulty];

    if (s.challenge) {
        if (c.cancelled) { result.push({ key: 'dailyNoLoss', values: {} }); } else { result.push({ key: s.game?.winner === s.host ? 'matchDailyWin' : 'matchDailyLoss', values: { level, amount: amount(s.config.values.dailyReward) } }); }

        if (money.status === 'unconfirmed') { result.push({ key: 'matchPending', values: {} }); }
    } else {
        result.push({ key: 'matchMode', values: { mode: DEFAULT_CONFIGURATION.replies[{ solo: 'modeSolo', duo: 'modeDuo', multi: 'modeMulti' }[s.mode]], kind: s.stake ? '积分对局' : '免费对局', level: s.mode === 'solo' ? ' · ' + level : '' } });

        if (money.status === 'unconfirmed') { result.push({ key: 'matchPending', values: {} }); } else if (money.status === 'confirmed') {
            if (!s.game?.winner || c.cancelled) { result.push({ key: 'matchRefund', values: {} }); } else if (s.mode === 'solo') {
                const m = s.members[0], p = money.people[m.id];
                result.push(s.game.winner === m.id ? { key: 'matchSoloWin', values: { stake: amount(p.stake), returned: amount(p.returned + p.reward), net: amount(p.net) } } : { key: 'matchSoloLoss', values: { name: m.name, amount: amount(-p.net) }, users: { name: m.id } });
            } else {
                result.push({ key: 'matchPool', values: { amount: amount(money.totals.stake) } });

                for (const m of s.members) { result.push({ key: 'matchNet', values: { name: m.name, amount: signedPoints(money.people[m.id].net) }, users: { name: m.id } }); }
            }
        }
    }

    const seconds = Math.ceil(Math.max(0, c.finishedAt - c.startedAt) / 1000);
    result.push({ key: 'matchStatistics', values: { shots: String(c.shots), live: String(c.live), blank: String(c.blank), ejected: String(c.ejected), loads: String(c.loads), items: String(c.items), duration: seconds >= 60 ? Math.floor(seconds / 60) + '分' + seconds % 60 + '秒' : seconds + '秒' } });

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

        return t('statisticsRecent', { time: time.date + ' ' + time.time, mode: t(modes[r.mode]), result: t(outcome[r.outcome]), net: r.net === null ? t('statisticsUnconfirmed') : signedPoints(r.net), gameId: formatRoomId(game) });
    }).join('\n');

    return t('statistics', { name: data.recent[0].result.name, games: a.games, wins: a.wins, losses: a.losses, draws: a.draws, cancelled: a.cancelled, rate: rate(a.wins, a.losses), streak: a.streak, best: a.best, shots: a.shots, live: a.live, blank: a.blank, items: a.items, damage: a.damage, healing: a.healing, timeouts: a.timeouts, net: signedPoints(a.net), stake: signedPoints(a.stake).replace(/^\+/, ''), returned: signedPoints(a.returned).replace(/^\+/, ''), reward: signedPoints(a.reward).replace(/^\+/, ''), unconfirmed: a.unconfirmed, freeGames: data.totals.free.games, paidGames: data.totals.points.games, modes: modeRows, levels: levelRows, recent });
}
