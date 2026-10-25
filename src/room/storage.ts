import { PluginDurableObject } from '@qqbot/sdk';
import { requireRule } from '../game/types.js';

export abstract class StoredObject extends PluginDurableObject {
    protected cache?: Map<string, unknown>;
    protected pending?: Map<string, unknown>;
    protected encoded?: Map<string, string | undefined>;
    constructor(state: DurableObjectState, env: unknown, schema: readonly string[]) {
        super(state, env);
        const sql = this.ctx.storage.sql;
        const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'").toArray().map(t => t.name);

        if (!tables.length) {
            this.ctx.storage.transactionSync(() => {
                sql.exec('CREATE TABLE meta (version INTEGER NOT NULL)');
                sql.exec('INSERT INTO meta(version) VALUES(2)');
                sql.exec('CREATE TABLE state (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
                sql.exec('CREATE TABLE ops (id TEXT PRIMARY KEY, game TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');

                for (const statement of schema) { sql.exec(statement); }
            });
        } else {
            const required = ['meta', 'state', 'ops', ...schema.flatMap(statement => statement.match(/^CREATE TABLE (\w+)/)?.[1] ?? [])];
            requireRule(required.every(name => tables.includes(name)), '存储结构未识别');
            requireRule(sql.exec<{ version: number }>('SELECT version FROM meta').toArray()[0]?.version === 2, '存储版本不匹配');
        }
    }

    protected read<T>(id: string): T | undefined {
        if (this.cache?.has(id)) { return this.cache.get(id) as T; }

        const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM state WHERE id=?', id).toArray()[0];
        const value = row ? JSON.parse(row.value) as T : undefined;
        this.cache?.set(id, value);
        this.encoded?.set(id, row?.value);

        return value;
    }

    protected write(id: string, value: unknown): void {
        if (this.pending) {
            this.pending.set(id, value);
            this.cache!.set(id, value);

            return;
        }

        this.ctx.storage.sql.exec('INSERT INTO state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', id, JSON.stringify(value));
    }
}
