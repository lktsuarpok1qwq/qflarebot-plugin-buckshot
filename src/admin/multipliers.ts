import { parsePoints } from '../amounts.js';

// 管理端以十进制文本提交倍率；按十进制位拼接，避免浮点乘法及静默舍入。
// 此纯函数同时嵌入页面，服务端始终独立调用校验。
export function parseMultiplier(input: unknown): number {
    if (typeof input !== 'string' || !/^\d{1,2}(?:\.\d{1,3})?$/.test(input.trim())) {
        throw new Error('倍率须为 1～10 倍，最多支持小数点后 3 位');
    }

    const [whole, fraction = ''] = input.trim().split('.');
    const value = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));

    if (value < 1000 || value > 10000) { throw new Error('倍率须为 1～10 倍，最多支持小数点后 3 位'); }

    return value;
}

export function decodeAdminConfig(input: unknown): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input)) { return input; }

    const value = { ...input } as Record<string, unknown>;

    for (const key of ['minStake', 'maxStake', 'rewardLimit', 'dailyReward']) {
        if (Object.hasOwn(value, key)) { value[key] = parsePoints(value[key], ['rewardLimit', 'dailyReward'].includes(key)); }
    }

    if (Object.hasOwn(value, 'multipliers')) {
        if (!Array.isArray(value.multipliers) || value.multipliers.length !== 5) { throw new Error('请填写五档倍率'); }

        value.multipliers = value.multipliers.map(parseMultiplier);
    }

    return value;
}
