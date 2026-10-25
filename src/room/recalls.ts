import type { RoomState } from './model.js';

export interface RecallReceipt {
    messageId: string; target: string; key: string; seconds: number; sentAt: number;
    gameId?: string; version?: number; owner?: string; navigation?: string; previous?: string;
    until?: number; kind?: 'choice' | 'create' | 'quit' | 'close' | 'aiRoster';
}
export interface RecallJob extends RecallReceipt { due: number; attempts: number; lease?: string }
export interface RecallState { bot: string; scope: string; jobs: RecallJob[] }

export function completeChoices(state: RecallState, receipt: RecallReceipt, panel = false): void {
    for (const job of state.jobs) {
        if (job.kind && job.owner === receipt.owner && job.target === receipt.target && (receipt.kind || panel || receipt.previous && receipt.previous === job.navigation)) {
            job.due = Math.min(job.due, receipt.sentAt + job.seconds * 1000);
        }
    }
}

// 回执独立于当前对局保存，关房和新开房不丢弃旧消息；只保存待办，不保存消息正文。
export function registerRecall(state: RecallState, receipt: RecallReceipt): void {
    const same = state.jobs.find(j => j.messageId === receipt.messageId && j.target === receipt.target);

    if (same) { return; }

    completeChoices(state, receipt);

    state.jobs.push({ ...receipt, due: (receipt.until ?? receipt.sentAt) + receipt.seconds * 1000, attempts: 0 });
}

export function expireRecalls(state: RecallState, room: RoomState | undefined, now: number): void {
    for (const job of state.jobs) {
        if (!job.kind || job.lease) { continue; }

        const same = room?.gameId === job.gameId;
        const completed = job.kind === 'create' ? same
            : job.kind === 'close' ? !same || room!.status !== 'WAITING' || room!.host !== job.owner || room!.closeConfirmation?.version !== job.version || room!.version !== job.version
                : job.kind === 'aiRoster' ? !same || room!.status !== 'WAITING' || room!.version !== job.version
                    : job.kind === 'quit' ? !same || room!.status !== 'PLAYING' || room!.confirmations[job.owner ?? '']?.version !== job.version || room!.version !== job.version
                        : false;

        if (completed) { job.due = Math.min(job.due, now + job.seconds * 1000); }
    }
}

export function nextRecall(state?: RecallState): number | null {
    return state?.jobs.length ? Math.min(...state.jobs.map(j => j.due)) : null;
}
