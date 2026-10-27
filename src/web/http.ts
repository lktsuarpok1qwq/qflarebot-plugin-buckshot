import { requireRule } from '../game/types.js';

const attempts = new Map<string, { second: number; count: number }>();
let rateSecond = 0, rateCount = 0;

export function rate(request: Request) {
    const second = Math.floor(Date.now() / 1000), ip = request.headers.get('cf-connecting-ip') ?? 'local';

    if (rateSecond !== second) {
        rateSecond = second;
        rateCount = 0;
    }

    requireRule(++rateCount <= 128, '请求繁忙，请稍后重试');

    if (attempts.size >= 512) { for (const [key, value] of attempts) { if (value.second < second - 60) { attempts.delete(key); } } }

    requireRule(attempts.has(ip) || attempts.size < 512, '请求繁忙，请稍后重试');
    const saved = attempts.get(ip), bucket = saved?.second === second ? saved : { second, count: 0 };
    requireRule(++bucket.count <= 24, '请求过快，请稍后重试');
    attempts.set(ip, bucket);
}

export async function readBody(request: Request, maxBytes = 4096, requireJSON = false): Promise<Record<string, unknown>> {
    if (requireJSON) { requireRule(request.headers.get('content-type')?.startsWith('application/json'), '请求格式错误'); }

    const reader = request.body?.getReader();
    requireRule(reader, '缺少请求');
    let text = '', bytes = 0;
    const decoder = new TextDecoder();

    try {
        for (; ;) {
            const { done, value } = await reader.read();

            if (done) { break; }

            bytes += value.byteLength;
            requireRule(bytes <= maxBytes, '请求过大');
            text += decoder.decode(value, { stream: true });
        }

        text += decoder.decode();
    } finally { await reader.cancel(); }

    const result = JSON.parse(text);
    requireRule(result && typeof result === 'object' && !Array.isArray(result), '请求格式错误');

    return result;
}
