import type { publicGame } from './engine.js';
import type { Knowledge } from './types.js';

export interface AIView { public: ReturnType<typeof publicGame>; knowledge: Knowledge; cursor: number }
