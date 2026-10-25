import type { PluginContext } from '@qqbot/sdk';

interface RecoveryRow {
    kind: 'cleanup' | 'join'; id: string; expires_at: number; request: string;
}

// 各分支沿用原索引和独立批次上限，共用一次 SDK 查询；不改变恢复频率。
export async function recoveryBatch(ctx: PluginContext) {
    const now = Date.now();
    const rows = await ctx.db.all<RecoveryRow>(`
        SELECT 'cleanup' AS kind,id,expires_at,NULL AS request
        FROM (SELECT id,expires_at FROM {coord_ops} WHERE bot=? AND game_id=? AND state=? AND expires_at<=? ORDER BY expires_at LIMIT 8)
        UNION ALL
        SELECT 'join',NULL,NULL,request
        FROM (SELECT request FROM {coord_ops} WHERE bot=? AND state=? LIMIT 4)
    `, ctx.botId, 'message-cleanup', 'CLEANUP', now, ctx.botId, 'PENDING');

    return { cleanup: rows.filter(r => r.kind === 'cleanup'), joins: rows.filter(r => r.kind === 'join') };
}
