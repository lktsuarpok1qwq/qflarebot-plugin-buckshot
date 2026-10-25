import { appendPersonal, emptyPersonal, type PersonalTotals } from '../statistics/personal.js';
import type { PlayerResult } from '../statistics/model.js';
import { requireRule } from '../game/types.js';

export type PlayerReplay = { game: string; object_key: string; mode: string; created: number; result?: PlayerResult }

// 复用玩家 Registry 的已有释放事务，不额外发跨 DO 写入调用。
export class PlayerHistory {
    static readonly schema = [
        'CREATE TABLE player_replays (id INTEGER PRIMARY KEY, game TEXT NOT NULL UNIQUE, object_key TEXT NOT NULL, mode TEXT NOT NULL, created INTEGER NOT NULL,result TEXT)',
        'CREATE TABLE player_totals(id INTEGER PRIMARY KEY,value TEXT NOT NULL)',
        'CREATE INDEX player_results_recent ON player_replays(id DESC) WHERE result IS NOT NULL'
    ];

    constructor(private sql: SqlStorage) {
        // 当前结构必须具备战绩列；不探测旧版或自动 ALTER。
        sql.exec('SELECT result FROM player_replays LIMIT 0');
    }

    record(game: string, replay: PlayerReplay): void {
        requireRule(replay.game === game && typeof replay.object_key === 'string' && ['solo', 'duo', 'multi'].includes(replay.mode) && Number.isSafeInteger(replay.created) && replay.created >= 0, '历史记录不符');
        requireRule(!replay.result || replay.result.game === game && replay.result.mode === replay.mode, '战绩记录不符');
        const inserted = this.sql.exec('INSERT INTO player_replays(game,object_key,mode,created,result) VALUES(?,?,?,?,?) ON CONFLICT(game) DO NOTHING RETURNING id', game, replay.object_key, replay.mode, replay.created, replay.result ? JSON.stringify(replay.result) : null).toArray();

        if (inserted.length && replay.result) {
            const totals = this.totals();
            appendPersonal(totals, replay.result);
            this.sql.exec('INSERT INTO player_totals(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(totals));
        }
    }

    private totals(): PersonalTotals {
        const row = this.sql.exec<{ value: string }>('SELECT value FROM player_totals WHERE id=1').toArray()[0];

        return row ? JSON.parse(row.value) : emptyPersonal();
    }

    statistics() {
        const totals = this.totals();
        const recent = this.sql.exec<{ game: string; result: string }>('SELECT game,result FROM player_replays WHERE result IS NOT NULL ORDER BY id DESC LIMIT 10').toArray().map(r => ({ game: r.game, result: JSON.parse(r.result) as PlayerResult }));

        return { totals, recent };
    }

    list(before = Number.MAX_SAFE_INTEGER) {
        requireRule(Number.isSafeInteger(before) && before > 0, '历史游标无效');
        const rows = this.sql.exec<Omit<PlayerReplay, 'result'> & { id: number }>("SELECT id,game,object_key,mode,created FROM player_replays WHERE id<? AND object_key LIKE 'replays/bs1/%' ORDER BY id DESC LIMIT 11", before).toArray();

        return { items: rows.slice(0, 10), next: rows.length > 10 ? rows[9].id : null };
    }
}
