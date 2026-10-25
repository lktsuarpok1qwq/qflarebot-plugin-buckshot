import { statisticsUpgrade } from '../statistics/upgrade.js';
import { statisticsDDL } from '../statistics/store.js';
import type { PluginContext } from '@qqbot/sdk';
import { identifier, validateConfig, type ConfigSnapshot } from '../config.js';
import { requireRule } from '../game/types.js';

export const DATABASE_VERSION = 6;

export async function ensureDatabase(ctx: PluginContext): Promise<void> {
    async function marker() { return ctx.db.first<{ version: number }>('SELECT version FROM {meta} WHERE id=1'); }

    try {
        const row = await marker();

        if (row?.version === 5) {
            try { await ctx.db.batch(statisticsUpgrade().map(sql => ({ sql }))); } catch (error) {
                // 并发升级由一个原子事务完成；其他调用只在标记已更新时继续。
                if ((await marker().catch(() => null))?.version !== DATABASE_VERSION) { throw error; }
            }

            return;
        }

        requireRule(row?.version === DATABASE_VERSION, '业务数据版本不匹配');

        return;
    } catch (error) {
        if (!(error instanceof Error) || !/no such table: (?:\w+\.)?p_buckshot_meta\b/.test(error.message)) { throw error; }
    }

    const ddl = [
        'CREATE TABLE {meta} (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)',
        'CREATE TABLE {config} (bot TEXT NOT NULL, scope TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL, op TEXT NOT NULL, PRIMARY KEY(bot,scope))',
        'CREATE TABLE {config_ops} (bot TEXT NOT NULL, id TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, auth TEXT NOT NULL DEFAULT \'admin\', PRIMARY KEY(bot,id))',
        'CREATE TABLE {rooms} (bot TEXT NOT NULL, group_id TEXT NOT NULL, game TEXT NOT NULL, status TEXT NOT NULL, due INTEGER, revision INTEGER NOT NULL DEFAULT 0, intent TEXT NOT NULL, PRIMARY KEY(bot,group_id))',
        'CREATE INDEX {rooms_due} ON {rooms}(bot,due) WHERE due IS NOT NULL',
        "CREATE INDEX {rooms_open} ON {rooms}(bot,group_id) WHERE status<>'CLOSED'",
        'CREATE TABLE {coord_ops} (bot TEXT NOT NULL, id TEXT NOT NULL, game_id TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY(bot,game_id,id))',
        'CREATE INDEX {coord_expiry} ON {coord_ops}(bot,state,expires_at)',
        ...statisticsDDL(),
        `INSERT INTO {meta}(id,version) VALUES(1,${DATABASE_VERSION})`
    ];

    try { await ctx.db.batch(ddl.map(sql => ({ sql }))); } catch (error) {
        // 并发初始化的另一个事务成功后可继续；其他错误不能当作缺库。
        const current = await marker().catch(() => null);

        if (current?.version !== DATABASE_VERSION) { throw error; }
    }
}

// 每个机器人只使用一个固定配置记录；会话不参与配置查找。
export async function configView(ctx: PluginContext) {
    const row = await ctx.db.first<{ version: number; value: string }>("SELECT version,value FROM {config} WHERE bot=? AND scope='*'", ctx.botId);
    const values = validateConfig(JSON.parse(row?.value ?? '{}'));

    return { version: row?.version ?? 0, value: values, effective: { values, globalVersion: row?.version ?? 0, ruleVersion: 1 as const } };
}

export async function readConfig(ctx: PluginContext): Promise<ConfigSnapshot> {
    return (await configView(ctx)).effective;
}

// 每个事件独立持有；仅复用当前机器人本次请求的读取，不跨请求缓存。
export interface RequestConfig { read?: { botId: string; value: Promise<ConfigSnapshot> } }

export function readRequestConfig(ctx: PluginContext, request?: RequestConfig): Promise<ConfigSnapshot> {
    if (!request) { return readConfig(ctx); }

    if (request.read?.botId !== ctx.botId) {
        request.read = { botId: ctx.botId, value: readConfig(ctx) };
    }

    return request.read.value;
}

export async function saveConfig(ctx: PluginContext, input: { operationId: string; version: number; value: unknown }) {
    identifier(input.operationId);

    requireRule(Object.keys(input).every(key => ['operationId', 'version', 'value'].includes(key)), '配置请求字段无效');

    requireRule(Number.isSafeInteger(input.version) && input.version >= 0, '配置版本无效');
    const value = validateConfig(input.value), request = JSON.stringify({ ...input, value });
    const old = await ctx.db.first<{ request: string; result: string }>('SELECT request,result FROM {config_ops} WHERE bot=? AND id=?', ctx.botId, input.operationId);

    if (old) {
        requireRule(old.request === request, '操作编号冲突');

        const result = JSON.parse(old.result);
        requireRule(result.status !== 'REJECTED', result.error);

        return result;
    }

    const result = { version: input.version + 1, value, operationId: input.operationId };
    const rejected = { operationId: input.operationId, status: 'REJECTED', error: '配置已被修改，请重新加载并保留草稿' };
    const batch = await ctx.db.batch([
        { sql: 'INSERT OR IGNORE INTO {config}(bot,scope,version,value,op) VALUES(?,?,0,?,?)', params: [ctx.botId, '*', '{}', ''] },
        { sql: "UPDATE {config} SET version=version+1,value=?,op=? WHERE bot=? AND scope='*' AND version=? AND NOT EXISTS (SELECT 1 FROM {config_ops} WHERE bot=? AND id=?)", params: [JSON.stringify(value), input.operationId, ctx.botId, input.version, ctx.botId, input.operationId] },
        { sql: 'INSERT OR IGNORE INTO {config_ops}(bot,id,request,result) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM {config} WHERE bot=? AND scope=? AND op=? AND version=?)', params: [ctx.botId, input.operationId, request, JSON.stringify(result), ctx.botId, '*', input.operationId, result.version] },
        { sql: 'INSERT OR IGNORE INTO {config_ops}(bot,id,request,result) VALUES(?,?,?,?)', params: [ctx.botId, input.operationId, request, JSON.stringify(rejected)] }
    ]);

    if (!batch[1].changes) {
        const replay = await ctx.db.first<{ request: string; result: string }>('SELECT request,result FROM {config_ops} WHERE bot=? AND id=?', ctx.botId, input.operationId);
        requireRule(replay?.request === request, '配置已被修改，请重新加载');

        const result = JSON.parse(replay.result);
        requireRule(result.status !== 'REJECTED', result.error);

        return result;
    }

    return result;
}
