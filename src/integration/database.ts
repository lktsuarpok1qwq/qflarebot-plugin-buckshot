import type { PluginContext } from '@qqbot/sdk';
import { DEFAULTS, identifier, validateConfig, type Config, type ConfigSnapshot } from '../config.js';
import { requireRule } from '../game/types.js';

export const DATABASE_VERSION = 3;

export async function ensureDatabase(ctx: PluginContext): Promise<void> {
    async function marker() { return ctx.db.first<{ version: number }>('SELECT version FROM {meta} WHERE id=1'); }

    try {
        const row = await marker();
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
        'CREATE TABLE {templates}(bot TEXT PRIMARY KEY,revision INTEGER NOT NULL,value TEXT NOT NULL,op TEXT NOT NULL)',
        'CREATE TABLE {template_ops}(bot TEXT NOT NULL,id TEXT NOT NULL,request_hash TEXT NOT NULL CHECK(length(request_hash)=64),result TEXT NOT NULL,PRIMARY KEY(bot,id))',
        `INSERT INTO {meta}(id,version) VALUES(1,${DATABASE_VERSION})`
    ];

    try { await ctx.db.batch(ddl.map(sql => ({ sql }))); } catch (error) {
        // 并发初始化的另一个事务成功后可继续；其他错误不能当作缺库。
        const current = await marker().catch(() => null);

        if (current?.version !== 2) { throw error; }
    }
}

export async function configView(ctx: PluginContext, group: string) {
    const rows = await ctx.db.all<{ scope: string; version: number; value: string }>('SELECT scope,version,value FROM {config} WHERE bot=? AND scope IN (?,?)', ctx.botId, '*', group);
    const global = rows.find(r => r.scope === '*'), local = rows.find(r => r.scope === group);
    const values = { ...DEFAULTS, ...JSON.parse(global?.value ?? '{}'), ...JSON.parse(local?.value ?? '{}') } as Config;
    validateConfig(values);

    return { scope: group, version: local?.version ?? 0, value: JSON.parse(local?.value ?? '{}') as Partial<Config>, effective: { values, globalVersion: global?.version ?? 0, groupVersion: local?.version ?? 0, ruleVersion: 1 as const } };
}

export async function readConfig(ctx: PluginContext, group: string): Promise<ConfigSnapshot> { return (await configView(ctx, group)).effective; }

export async function saveConfig(ctx: PluginContext, input: { scope: string; operationId: string; version: number; value: unknown }) {
    identifier(input.operationId);

    if (input.scope !== '*') { identifier(input.scope); }

    requireRule(Number.isSafeInteger(input.version) && input.version >= 0, '配置版本无效');
    const value = validateConfig(input.value, true), request = JSON.stringify({ ...input, value });
    const old = await ctx.db.first<{ request: string; result: string }>('SELECT request,result FROM {config_ops} WHERE bot=? AND id=?', ctx.botId, input.operationId);

    if (old) {
        requireRule(old.request === request, '操作编号冲突');

        const result = JSON.parse(old.result);
        requireRule(result.status !== 'REJECTED', result.error);

        return result;
    }

    const result = { scope: input.scope, version: input.version + 1, value, operationId: input.operationId };
    const rejected = { scope: input.scope, operationId: input.operationId, status: 'REJECTED', error: '配置已被修改，请重新加载并保留草稿' };
    const batch = await ctx.db.batch([
        { sql: 'INSERT OR IGNORE INTO {config}(bot,scope,version,value,op) VALUES(?,?,0,?,?)', params: [ctx.botId, input.scope, '{}', ''] },
        { sql: 'UPDATE {config} SET version=version+1,value=?,op=? WHERE bot=? AND scope=? AND version=? AND NOT EXISTS (SELECT 1 FROM {config_ops} WHERE bot=? AND id=?)', params: [JSON.stringify(value), input.operationId, ctx.botId, input.scope, input.version, ctx.botId, input.operationId] },
        { sql: 'INSERT OR IGNORE INTO {config_ops}(bot,id,request,result) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM {config} WHERE bot=? AND scope=? AND op=? AND version=?)', params: [ctx.botId, input.operationId, request, JSON.stringify(result), ctx.botId, input.scope, input.operationId, result.version] },
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
