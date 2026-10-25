import { createReplayContainer } from '../container.js';

export const replayFileScript = 'const replayContainer = (' + createReplayContainer.toString() + ')();\n' + String.raw`
const replayTrustedKeys = new Map();

async function replayReadWithin(work) {
    let timer;

    try {
        return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('回放读取超时，请重试')), 15000); })]);
    } finally { clearTimeout(timer); }
}

async function trustedReplayKey(id) {
    if (replayTrustedKeys.has(id)) { return replayTrustedKeys.get(id); }

    const load = async () => {
        const path = '/api/replay-key?id=' + encodeURIComponent(id);
        const response = typeof bridge === 'undefined' ? await fetch('/p/buckshot' + path, { credentials: 'omit' }) : await bridge.fetch(path);

        if (!response.ok) { throw Error('签名来源不受当前服务信任'); }

        const data = await response.json();

        if (data.id !== id || !Array.isArray(data.publicKey) || data.publicKey.length !== 65 || data.publicKey.some(n => !Number.isInteger(n) || n < 0 || n > 255)) { throw Error('回放公钥响应无效'); }

        const raw = new Uint8Array(data.publicKey);

        if (await replayContainer.fingerprint(raw) !== id) { throw Error('回放公钥标识不符'); }

        return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    };
    const pending = replayReadWithin(load).catch(error => {
        replayTrustedKeys.delete(id);
        throw error;
    });

    if (replayTrustedKeys.size >= 4) { replayTrustedKeys.delete(replayTrustedKeys.keys().next().value); }

    replayTrustedKeys.set(id, pending);

    return pending;
}

async function decodeReplayFile(bytes) {
    try {
        const info = replayContainer.inspect(bytes), key = await trustedReplayKey(info.id);
        const plain = await replayContainer.decode(bytes, key);
        let data;

        try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } catch { throw Error('回放内容无效'); }

        checkReplay(data);

        return data;
    } catch { throw Error('无法打开此回放'); }
}

async function readReplayFile(response) {
    if (!response.ok) { throw Error('回放尚未保存、已删除或链接无效'); }

    if (!response.body) { throw Error('回放内容为空'); }

    const bytes = await replayContainer.limited(response.body, replayContainer.max + 4096);

    return { bytes, data: await decodeReplayFile(bytes) };
}
`;
