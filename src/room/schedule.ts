import type { RoomState } from './model.js';

export function canClose(s: RoomState): boolean {
    return ['FINISHED', 'SETTLED', 'CANCELLED'].includes(s.status) && !(s.web && s.outbox.some(t => ['PENDING', 'SENDING'].includes(t.state))) && !s.outbox.some(t => t.critical && t.state !== 'SENT')
        && (s.money.every(t => t.state === 'DONE' || t.kind === 'reserve' && t.state === 'FAILED'));
}

export function localWake(s: RoomState): number | null {
    const times = [...Object.values(s.web?.access ?? {}).flatMap(a => [...(a.ticket ? [a.ticket.expires] : []), ...(a.session ? [Math.min(a.session.expires, s.web?.endedAt ? s.web.endedAt + 900000 : Infinity)] : [])]), s.status === 'WEB_JOINING' ? s.web?.joiningUntil : undefined, s.status === 'WAITING' ? s.createdAt + s.config.values.waitingMinutes * 60000 : undefined, s.deadline, s.aiDue, s.status === 'PLAYING' && !s.paused && !s.recovery ? s.resultUntil : undefined, s.status === 'PLAYING' && !s.paused && !s.recovery ? s.aiReadUntil : undefined,
    s.reserved && s.status === 'PLAYING' ? s.reserveUntil : undefined,
    !s.web && s.deadline && s.config.values.reminderSeconds > 0 && !s.reminderSent ? s.deadline - s.config.values.reminderSeconds * 1000 : undefined,
    ...s.outbox.filter(t => t.state === 'SENDING').map(t => t.leaseUntil),
    ...s.money.filter(t => t.state === 'SENDING').map(t => t.leaseUntil)].filter((t): t is number => t !== undefined);

    return times.length ? Math.min(...times) : null;
}

export function workDue(s: RoomState, now: number): number | null {
    if (s.status === 'CLOSED') { return null; }

    const task = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && ['FAILED', 'UNKNOWN'].includes(t.state)));
    const money = s.money.find(t => t.state !== 'DONE');
    const pacing = !s.web && s.status === 'PLAYING' && !s.paused && !s.recovery && s.aiPaceUntil !== undefined && s.game?.players.some(p => p.id === s.game?.current && p.ai);
    const ready = pacing || task?.state === 'PENDING' && (task.notBefore ?? 0) <= now || task?.state === 'SENDING' || money?.state === 'PENDING' || money?.state === 'SENDING' || s.pendingReleases?.length || canClose(s);

    if (ready) { return s.indexDue != null && s.indexDue <= now ? s.indexDue : now; }

    const dates: number[] = [];

    if (task?.state === 'PENDING' && task.notBefore !== undefined) { dates.push(task.notBefore); }

    if (money?.state === 'UNKNOWN') { dates.push(money.retryAt ?? now); }

    if (s.reserved && s.status === 'PLAYING' && s.money.every(t => t.state === 'DONE')) { dates.push(s.reserveUntil! - 3600000); }

    return dates.length ? Math.min(...dates) : null;
}
