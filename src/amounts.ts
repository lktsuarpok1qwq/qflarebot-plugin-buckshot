// 用户填写积分，Points 接口使用百分之一积分；按十进制位转换，不浮点乘法舍入。
export function parsePoints(input: unknown, allowZero = false): number {
    if (typeof input !== 'string' || !/^(0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(input)) { throw new Error('金额须为积分数，最多支持小数点后 2 位'); }

    const [whole, fraction = ''] = input.split('.');
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

    if (!Number.isSafeInteger(value) || value > 1e12 || value < (allowZero ? 0 : 1)) { throw new Error('金额须为积分数，最多支持小数点后 2 位'); }

    return value;
}

export function formatPoints(minor: number): string {
    if (!Number.isSafeInteger(minor) || minor < 0 || minor > 1e12) { throw new Error('积分金额无效'); }

    return Math.floor(minor / 100) + '.' + String(minor % 100).padStart(2, '0');
}
