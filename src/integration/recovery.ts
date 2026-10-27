import type { PluginContext } from '@qqbot/sdk';
import { DATABASE_VERSION, ensureDatabase } from './database.js';
import { requireRule } from '../game/types.js';

interface RecoveryRow {
    kind: 'cleanup' | 'join' | 'schema' | 'expiry'; id: string; expires_at: number; request: string;
}

// 各分支沿用原索引和独立批次上限，共用一次 SDK 查询；不改变恢复频率。
export async function recoveryBatch(ctx: PluginContext) {
    const now = Date.now();
    const read = () => ctx.db.all<RecoveryRow>(`
        SELECT 'schema' AS kind,CAST(version AS TEXT) AS id,NULL AS expires_at,NULL AS request FROM {meta} WHERE id=1
        UNION ALL
        SELECT 'cleanup' AS kind,id,expires_at,NULL AS request
        FROM (SELECT id,expires_at FROM {coord_ops} WHERE bot=? AND game_id=? AND state=? AND expires_at<=? ORDER BY expires_at LIMIT 8)
        UNION ALL
        SELECT 'join',NULL,NULL,request
        FROM (SELECT request FROM {coord_ops} WHERE bot=? AND state=? LIMIT 4)
        UNION ALL
        SELECT 'expiry',NULL,NULL,NULL FROM (SELECT 1 FROM {coord_ops} WHERE bot=? AND state IN ('CREATE_READY','NAVIGATION') AND expires_at<=? LIMIT 1)
    `, ctx.botId, 'message-cleanup', 'CLEANUP', now, ctx.botId, 'PENDING', ctx.botId, now);
    let rows: RecoveryRow[];

    try { rows = await read(); } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_buckshot_(?:meta|coord_ops)\b/.test(error.message)) { throw error; }

        await ensureDatabase(ctx);
        rows = await read();
    }

    requireRule(rows.find(r => r.kind === 'schema')?.id === String(DATABASE_VERSION), '业务数据版本不匹配');

    return { expired: rows.some(r => r.kind === 'expiry'), cleanup: rows.filter(r => r.kind === 'cleanup'), joins: rows.filter(r => r.kind === 'join') };
}
