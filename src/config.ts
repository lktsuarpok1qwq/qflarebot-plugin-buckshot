import { requireRule } from './game/types.js';

export interface Config {
    freeEnabled: boolean; stakesEnabled: boolean; showAIStyle: boolean;
    turnSeconds: number; recallSeconds: number; aiReadSeconds: number; aiDelaySeconds: number; aiBudgetMs: number;
    minStake: number; maxStake: number; rewardLimit: number; multipliers: number[];
}
export interface ConfigSnapshot { values: Config; globalVersion: number; ruleVersion: 1 }
export const DEFAULTS: Config = {
    freeEnabled: true, stakesEnabled: false, showAIStyle: false, turnSeconds: 60, recallSeconds: 10, aiReadSeconds: 5, aiDelaySeconds: 2,
    aiBudgetMs: 4, minStake: 1, maxStake: 10000, rewardLimit: 100000,
    multipliers: [1100, 1300, 1600, 2000, 3000]
};

export function validateConfig(input: unknown): Config {
    requireRule(input && typeof input === 'object' && !Array.isArray(input), '配置格式错误');
    const value = input as Record<string, unknown>;
    requireRule(Object.keys(value).every(k => Object.hasOwn(DEFAULTS, k)), '配置字段无效');
    const full = { ...DEFAULTS, ...value } as Config;

    for (const key of ['freeEnabled', 'stakesEnabled', 'showAIStyle'] as const) { requireRule(typeof full[key] === 'boolean', '开关格式错误'); }

    for (const [key, min, max] of [['turnSeconds', 20, 300], ['recallSeconds', 1, 20], ['aiReadSeconds', 0, 10], ['aiDelaySeconds', 1, 3], ['aiBudgetMs', 1, 8], ['minStake', 1, 1e12], ['maxStake', 1, 1e12], ['rewardLimit', 0, 1e12]] as const) {
        requireRule(Number.isSafeInteger(full[key]) && full[key] >= min && full[key] <= max, `${key} 超出范围`);
    }

    requireRule(full.minStake <= full.maxStake && full.maxStake * 4 <= 1e12, '下注范围无效');
    requireRule(Array.isArray(full.multipliers) && full.multipliers.length === 5 && full.multipliers.every(n => Number.isSafeInteger(n) && n >= 1000 && n <= 10000), '倍率须为五个 1000～10000 的整数，1000 表示一倍');

    return structuredClone(full);
}

export function payout(stake: number, multiplier: number): number {
    return Number(BigInt(stake) * BigInt(multiplier) / 1000n);
}

export function identifier(value: unknown): asserts value is string {
    requireRule(typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\w:.-]+$/.test(value), '标识无效');
}
