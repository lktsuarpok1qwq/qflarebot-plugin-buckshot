import type { GameEvent } from '../game/types.js';

export interface WebAccess {
    ticket?: { digest: string; expires: number; event: string; delivery: string; used?: boolean; proof?: string; deliveryState?: 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' };
    session?: { digest: string; expires: number; generation: number; ready: boolean };
}
export interface WebFrame {
    id: number; at: number; until: number; actor?: string;
    move?: import('../game/types.js').Action; item?: string; stolenItem?: string;
    sawed?: boolean;
    before: { id: string; life: number; items: import('../game/types.js').Item[] }[];
    events: GameEvent[];
}
export interface WebRoom {
    joiningUntil?: number;
    access: Record<string, WebAccess>;
    frame?: WebFrame;
    sequence: number;
    endedAt?: number;
    replayReady?: boolean;
}
