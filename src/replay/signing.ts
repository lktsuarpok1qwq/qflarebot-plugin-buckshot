import type { PluginDB } from '@qqbot/sdk';
import { replayContainer } from './container.js';

type SavedKey = { id: string; public_key: string; private_key: string };
type SigningKey = { id: string; publicKey: number[]; privateKey: CryptoKey };
const signing = new WeakMap<PluginDB, Map<string, Promise<SigningKey>>>();

// 使用插件受保护的 D1 存储；私钥不进入配置 API、日志、回放或前端。
export function replaySigningKey(db: PluginDB, bot: string): Promise<SigningKey> {
    let keys = signing.get(db);

    if (!keys) {
        keys = new Map();
        signing.set(db, keys);
    }

    const saved = keys.get(bot);

    if (saved) { return saved; }

    const pending = loadKey(db, bot).catch(error => {
        keys!.delete(bot);
        throw error;
    });

    if (keys.size >= 4) { keys.delete(keys.keys().next().value!); }

    keys.set(bot, pending);

    return pending;
}

async function loadKey(db: PluginDB, bot: string): Promise<SigningKey> {
    let saved: SavedKey | null;

    try { saved = await db.first<SavedKey>('SELECT id,public_key,private_key FROM {replay_keys} WHERE bot=?', bot); } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_buckshot_replay_keys\b/.test(error.message)) { throw error; }

        await db.exec('CREATE TABLE IF NOT EXISTS {replay_keys} (bot TEXT PRIMARY KEY,id TEXT NOT NULL,public_key TEXT NOT NULL,private_key TEXT NOT NULL)');
        saved = null;
    }

    if (!saved) {
        const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
        const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', generated.publicKey) as ArrayBuffer);
        const privateKey = await crypto.subtle.exportKey('jwk', generated.privateKey);
        const id = await replayContainer.fingerprint(publicKey);
        await db.run('INSERT OR IGNORE INTO {replay_keys}(bot,id,public_key,private_key) VALUES(?,?,?,?)', bot, id, JSON.stringify([...publicKey]), JSON.stringify(privateKey));
        saved = await db.first<SavedKey>('SELECT id,public_key,private_key FROM {replay_keys} WHERE bot=?', bot);
    }

    if (!saved) { throw Error('回放签名密钥未保存'); }

    const publicKey: number[] = JSON.parse(saved.public_key);

    if (await replayContainer.fingerprint(new Uint8Array(publicKey)) !== saved.id) { throw Error('回放签名密钥不符'); }

    const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(saved.private_key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

    return { id: saved.id, publicKey, privateKey };
}

export async function replayPublicKey(db: PluginDB, bot: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) { return null; }

    try {
        const row = await db.first<{ id: string; public_key: string }>('SELECT id,public_key FROM {replay_keys} WHERE bot=? AND id=?', bot, id);

        return row ? { id: row.id, publicKey: JSON.parse(row.public_key) } : null;
    } catch (error) {
        if (error instanceof Error && /no such table: (?:\w+\.)?p_buckshot_replay_keys\b/.test(error.message)) { return null; }

        throw error;
    }
}
