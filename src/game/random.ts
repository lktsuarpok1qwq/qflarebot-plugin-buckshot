import { secureRandom, requireRule, type RNG } from './types.js';
import type { RoomState, CreateInput } from '../room/model.js';
import { dateParts } from '../replay/format.js';

export type RandomState = [number, number, number, number];
export interface Challenge { date: string; seed: number[] }
export const challengeDifficulty = (challenge: Challenge): number => Math.floor(challenge.seed[7] / 0x100000000 * 5);
export const challengeDate = (time = Date.now()) => dateParts(time).date;

export function validateChallenge(input: Pick<CreateInput, 'challenge' | 'mode' | 'stake' | 'difficulty'>): void {
    const c = input.challenge;
    requireRule(!c || input.mode === 'solo' && input.stake === 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Array.isArray(c.seed) && c.seed.length === 8 && c.seed.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff) && c.seed.slice(0, 4).some(Boolean) && c.seed.slice(4).some(Boolean) && input.difficulty === challengeDifficulty(c), '每日挑战参数无效');
}

// 只有北京时间日期和统一 OpenID 进入消息；服务端密钥防止从公开身份推算隐藏弹仓。
export async function challengeSeed(secret: number[], date: string, userId: string): Promise<Challenge> {
    const key = await crypto.subtle.importKey('raw', new Uint8Array(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify([date, userId])));
    const bytes = new DataView(hash);

    return { date, seed: Array.from({ length: 8 }, (_, i) => bytes.getUint32(i * 4)) };
}

// xoshiro128**，状态随原房间事务落盘；模拟抽样不消耗实局随机流。
export function seededRandom(state: RandomState): RNG {
    const rotate = (v: number, n: number) => (v << n | v >>> (32 - n)) >>> 0;
    const next = () => {
        const value = Math.imul(rotate(Math.imul(state[1], 5), 7), 9) >>> 0, t = state[1] << 9;
        state[2] ^= state[0];
        state[3] ^= state[1];
        state[1] ^= state[2];
        state[0] ^= state[3];
        state[2] ^= t;
        state[3] = rotate(state[3], 11);

        for (let i = 0; i < 4; i++) { state[i] >>>= 0; }

        return value;
    };

    return max => {
        requireRule(Number.isInteger(max) && max > 0 && max <= 0x100000000, '随机范围无效');
        const limit = Math.floor(0x100000000 / max) * max;
        let value;

        do { value = next(); } while (value >= limit);

        return value % max;
    };
}

export function roomRandom(s: RoomState, simulation = false): RNG {
    const state = simulation ? s.aiRandom : s.gameRandom;

    return state ? seededRandom(state) : secureRandom;
}
