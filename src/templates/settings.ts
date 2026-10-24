import type { PluginContext } from '@qqbot/sdk';
import { DEFAULT_CONFIGURATION, configurationError, type ReplyConfiguration } from './reply-config.js';
import { DATABASE_VERSION, ensureDatabase } from '../integration/database.js';
import { identifier } from '../config.js';
import { requireRule } from '../game/types.js';

export async function loadTemplates(ctx: Pick<PluginContext, 'db' | 'botId'>) {
    const read = () => ctx.db.first<{ schema: number; revision: number | null; value: string | null }>("SELECT m.version AS schema,t.revision,t.value FROM {meta} m LEFT JOIN {templates} t ON t.bot=? WHERE m.id=1", ctx.botId);
    let row;

    try { row = await read(); } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_buckshot_(?:meta|templates)\b/.test(error.message)) { throw error; }

        await ensureDatabase(ctx as PluginContext);
        row = await read();
    }

    requireRule(row?.schema === DATABASE_VERSION, '业务数据版本不匹配');

    return { revision: row.revision ?? 0, ...(row.value ? JSON.parse(row.value) as ReplyConfiguration : structuredClone(DEFAULT_CONFIGURATION)) };
}

// 只对已通过结构校验的 JSON 配置求摘要；对象键排序，数组顺序与正文留白保留。
async function fingerprint(value: unknown): Promise<string> {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
        : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical((v as Record<string, unknown>)[key])])) : v;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));

    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveTemplates(ctx: PluginContext, input: { operationId: string; expectedRevision: number } & ReplyConfiguration) {
    identifier(input.operationId);
    requireRule(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, '模板版本无效');
    const value = { replies: input.replies, buttons: input.buttons, ...(input.historySeparator !== undefined ? { historySeparator: input.historySeparator } : {}) };
    const error = configurationError(value);
    requireRule(!error, error ? `${error.field}：${error.message}` : '模板无效');
    const requestHash = await fingerprint({ expectedRevision: input.expectedRevision, ...value });
    const old = await ctx.db.first<{ request_hash: string; result: string }>('SELECT request_hash,result FROM {template_ops} WHERE bot=? AND id=?', ctx.botId, input.operationId);

    if (old) {
        requireRule(old.request_hash === requestHash, '操作编号冲突');
        const result = JSON.parse(old.result);
        requireRule(!result.error, result.error);

        return result;
    }

    const result = { operationId: input.operationId, revision: input.expectedRevision + 1, ...value };
    const batch = await ctx.db.batch([
        { sql: 'INSERT OR IGNORE INTO {templates}(bot,revision,value,op) VALUES(?,0,?,?)', params: [ctx.botId, JSON.stringify(DEFAULT_CONFIGURATION), ''] },
        { sql: 'UPDATE {templates} SET revision=revision+1,value=?,op=? WHERE bot=? AND revision=? AND NOT EXISTS(SELECT 1 FROM {template_ops} WHERE bot=? AND id=?)', params: [JSON.stringify(value), input.operationId, ctx.botId, input.expectedRevision, ctx.botId, input.operationId] },
        { sql: 'INSERT OR IGNORE INTO {template_ops}(bot,id,request_hash,result) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM {templates} WHERE bot=? AND op=? AND revision=?)', params: [ctx.botId, input.operationId, requestHash, JSON.stringify(result), ctx.botId, input.operationId, result.revision] },
        { sql: 'INSERT OR IGNORE INTO {template_ops}(bot,id,request_hash,result) VALUES(?,?,?,?)', params: [ctx.botId, input.operationId, requestHash, JSON.stringify({ error: '模板版本冲突，草稿已保留，请重新加载' })] }
    ]);

    if (!batch[1].changes) {
        const saved = await ctx.db.first<{ request_hash: string; result: string }>('SELECT request_hash,result FROM {template_ops} WHERE bot=? AND id=?', ctx.botId, input.operationId);
        requireRule(saved?.request_hash === requestHash, '操作编号冲突');
        const result = JSON.parse(saved.result);
        requireRule(!result.error, result.error);

        return result;
    }

    return result;
}
