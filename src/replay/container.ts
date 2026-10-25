// 同一容器实现用于归档、浏览器和验收；只依赖 Web Crypto 与原生压缩流。
export function createReplayContainer() {
    const max = 2 * 1024 * 1024, headerSize = 44, signatureSize = 64;
    const hex = (bytes: Uint8Array) => [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
    const fingerprint = async (raw: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)));
    const limited = async (stream: ReadableStream<Uint8Array>, limit = max): Promise<Uint8Array> => {
        const reader = stream.getReader(), parts: Uint8Array[] = [];
        let size = 0;

        try {
            for (; ;) {
                const next = await reader.read();

                if (next.done) { break; }

                size += next.value.length;

                if (size > limit) { throw Error('回放数据超过大小限制'); }

                parts.push(next.value);
            }
        } catch (error) {
            await reader.cancel().catch(() => { });
            throw error;
        } finally { reader.releaseLock(); }

        const bytes = new Uint8Array(size);
        let offset = 0;

        for (const part of parts) {
            bytes.set(part, offset);
            offset += part.length;
        }

        return bytes;
    };
    const inspect = (bytes: Uint8Array) => {
        if (bytes.length < headerSize + signatureSize + 20 || bytes.length > max + 4096 || bytes[0] !== 66 || bytes[1] !== 83 || bytes[2] !== 82 || bytes[3] !== 80 || bytes[4] !== 1 || bytes[5] !== 1 || bytes[6] !== 1 || bytes[7] !== 0) { throw Error('不支持的 .bs 回放格式'); }

        const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40);

        if (!size || size > max) { throw Error('回放展开大小无效'); }

        return { id: hex(bytes.slice(8, 40)), size };
    };
    const encode = async (plain: Uint8Array, key: CryptoKey, id: string): Promise<Uint8Array> => {
        if (!plain.length || plain.length > max || !/^[a-f0-9]{64}$/.test(id)) { throw Error('回放大小或签名标识无效'); }

        const zipped = await limited(new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip')), max + 3988);
        const signed = new Uint8Array(headerSize + zipped.length);
        signed.set([66, 83, 82, 80, 1, 1, 1, 0]);
        signed.set(Uint8Array.from(id.match(/../g)!, h => parseInt(h, 16)), 8);
        new DataView(signed.buffer).setUint32(40, plain.length);
        signed.set(zipped, headerSize);
        const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed));

        if (signature.length !== signatureSize) { throw Error('回放签名长度无效'); }

        const file = new Uint8Array(signed.length + signatureSize);
        file.set(signed);
        file.set(signature, signed.length);

        return file;
    };
    const decode = async (bytes: Uint8Array, trustedKey: CryptoKey): Promise<Uint8Array> => {
        const info = inspect(bytes), boundary = bytes.length - signatureSize;
        const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, trustedKey, bytes.slice(boundary), bytes.slice(0, boundary));

        if (!valid) { throw Error('签名验证失败，文件可能已被修改'); }

        let plain;

        try { plain = await limited(new Blob([bytes.slice(headerSize, boundary)]).stream().pipeThrough(new DecompressionStream('gzip')), info.size); } catch { throw Error('回放压缩数据损坏或展开大小超限'); }

        if (plain.length !== info.size) { throw Error('回放展开大小不符'); }

        return plain;
    };

    return { max, inspect, encode, decode, limited, fingerprint };
}

export const replayContainer = createReplayContainer();
