import type { view } from '../room/state.js';

export function base(s: ReturnType<typeof view>) { return { gameId: s.gameId, expectedVersion: s.version }; }
