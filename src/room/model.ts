import type { PointsService } from 'qflarebot-plugin-points';
import type { ConfigSnapshot } from '../config.js';
import type { Action, Game, Mode } from '../game/types.js';

export type Status = 'WAITING' | 'PREPARING' | 'PLAYING' | 'FINISHED' | 'SETTLING' | 'SETTLED' | 'CLOSED' | 'CANCELLED';
export interface Member { id: string; name: string; ready: boolean; privateId: string; claimId?: string }
export interface PanelReference { gameId: string; version: number; status: Status; order: string }
export interface PanelReceipt extends PanelReference { messageId: string }
export interface Task {
    id: string; seq: number; kind: 'message' | 'recall'; target: string; private: boolean;
    parts?: import('../templates/presentation.js').Part[]; payload?: import('@qqbot/sdk').OutgoingMessage; text: string; critical: boolean; loadId?: number; panel?: boolean; messageId?: string;
    state: 'PENDING' | 'SENDING' | 'SENT' | 'UNKNOWN' | 'FAILED'; lease?: string; leaseUntil?: number; attempts: number;
    panelOrder?: string; keep?: boolean; error?: string; announcementSentAt?: number; sentAt?: number; expiresAt?: number; plain?: boolean; snapshot?: ReturnType<typeof import('./state.js').view>;
}
export interface MoneyTask {
    id: string; kind: 'reserve' | 'settle' | 'release' | 'renew'; input: Parameters<PointsService['reserveBundle']>[0] | Parameters<PointsService['settle']>[0] | Parameters<PointsService['release']>[0] | Parameters<PointsService['renewReservation']>[0];
    retryAt?: number; retries?: number; state: 'PENDING' | 'SENDING' | 'DONE' | 'UNKNOWN' | 'FAILED'; lease?: string; leaseUntil?: number; error?: string; evidence?: string; resolution?: 'committed' | 'inactive' | 'rejected';
}
export interface RoomState {
    schemaVersion: 2; gameId: string; botId: string; groupId: string; host: string;
    version: number; status: Status; mode: Mode; stake: number; difficulty: number;
    config: ConfigSnapshot; createdAt: number; members: Member[]; game?: Game;
    paused: boolean; recovery: boolean; reason?: string; remainingMs: number; deadline?: number; reminderSent: boolean;
    aiDue?: number; aiReadUntil?: number; outbox: Task[]; seq: number; money: MoneyTask[]; reserved: boolean;
    reserveAt?: number; reserveUntil?: number; renewal: number; released: string[];
    confirmations: Record<string, { version: number; expires: number }>; indexVersion: number; indexDue?: number | null; indexStatus?: Status; departures?: string[]; abortRequested?: boolean; pendingReleases?: { id: string; claimId: string }[];
}
export interface Request {
    gameId: string; actionId: string; expectedVersion: number; actor: string;
    action: { type: 'join'; member: Member } | { type: 'leave' } | { type: 'ready' } | { type: 'start' }
    | { type: 'confirmQuit' } | { type: 'quit' } | { type: 'play'; move: Action }
    | { type: 'pause' } | { type: 'resume' } | { type: 'cancel' } | { type: 'retry'; taskId: string; plain?: boolean }
    | { type: 'reconcile'; taskId: string } | { type: 'removed'; target: string } | { type: 'abort' };
}
export interface CreateInput {
    botId: string; groupId: string; gameId: string; mode: Mode; stake: number; difficulty: number;
    member: Member; config: ConfigSnapshot;
}
