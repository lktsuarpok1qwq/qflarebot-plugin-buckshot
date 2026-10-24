import type { RoomState } from './model.js';

export function canClose(s: RoomState): boolean {
    return ['FINISHED', 'SETTLED', 'CANCELLED'].includes(s.status) && !s.outbox.some(t => t.critical && t.state !== 'SENT')
        && (!s.stake || s.money.every(t => t.state === 'DONE' || t.kind === 'reserve' && t.state === 'FAILED'));
}

export function localWake(s: RoomState): number | null {
    const times = [s.status === 'WAITING' ? s.createdAt + 600000 : undefined, s.deadline, s.aiDue, s.status === 'PLAYING' && !s.paused && !s.recovery ? s.aiReadUntil : undefined,
    s.reserved && s.status === 'PLAYING' ? s.reserveUntil : undefined,
    s.deadline && !s.reminderSent ? s.deadline - 15000 : undefined,
    ...s.outbox.filter(t => t.state === 'SENDING').map(t => t.leaseUntil),
    ...s.money.filter(t => t.state === 'SENDING').map(t => t.leaseUntil)].filter((t): t is number => t !== undefined);

    return times.length ? Math.min(...times) : null;
}

export function workDue(s: RoomState, now: number): number | null {
    if (s.status === 'CLOSED') { return null; }

    const task = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && ['FAILED', 'UNKNOWN'].includes(t.state)));
    const money = s.money.find(t => t.state !== 'DONE');
    const ready = task?.state === 'PENDING' || task?.state === 'SENDING' || money?.state === 'PENDING' || money?.state === 'SENDING' || s.pendingReleases?.length || canClose(s);

    if (ready) { return s.indexDue != null && s.indexDue <= now ? s.indexDue : now; }

    const dates: number[] = [];

    if (money?.state === 'UNKNOWN') { dates.push(money.retryAt ?? now); }

    if (s.reserved && s.status === 'PLAYING' && s.money.every(t => t.state === 'DONE')) { dates.push(s.reserveUntil! - 3600000); }

    return dates.length ? Math.min(...dates) : null;
}
