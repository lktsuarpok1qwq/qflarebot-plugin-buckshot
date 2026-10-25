import { replaySigningKey } from './signing.js';
import { replayContainer } from './container.js';
import { replayCodec, type ReplayWireStep } from './codec.js';
import type { ScopedR2, PluginDB } from '@qqbot/sdk';
import type { RoomState } from '../room/model.js';
import { MAX_REPLAY_BYTES, MAX_REPLAY_STEPS, replayHeader, replayKey, type ReplayHeader, type ReplayStep } from './format.js';

// 独立于房间状态保留未归档日志；新局不会覆盖上一局失败的归档。
export class ReplayJournal {
    private sql: SqlStorage;
    private due: number | null;
    private queue: Promise<unknown> = Promise.resolve();

    static readonly schema = [
        'CREATE TABLE replay_jobs (game TEXT PRIMARY KEY, object_key TEXT NOT NULL, header TEXT NOT NULL, due INTEGER, attempts INTEGER NOT NULL DEFAULT 0)',
        'CREATE UNIQUE INDEX replay_jobs_key ON replay_jobs(object_key)',
        'CREATE TABLE replay_steps (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, value TEXT NOT NULL)',
        'CREATE INDEX replay_steps_game ON replay_steps(game,seq)'
    ];

    constructor(private storage: DurableObjectStorage, private owner?: string) {
        this.sql = storage.sql;
        this.due = this.readDue();
    }

    start(s: RoomState, base?: string): void {
        s.replay = { version: 5, key: replayKey(s), ...(base ? { base } : {}), bytes: 0, count: 0, truncated: false, ids: {}, players: [] };
        this.sql.exec('INSERT INTO replay_jobs(game,object_key,header) VALUES(?,?,?)', s.gameId, s.replay.key, JSON.stringify(replayHeader(s)));
    }

    append(s: RoomState, steps: ReplayStep[]): void {
        if (s.replay?.version !== 5 || !steps.length || s.replay.truncated) { return; }

        const value = JSON.stringify(steps.map(replayCodec.encodeStep)), bytes = new TextEncoder().encode(value).length;

        if (s.replay.count + steps.length > MAX_REPLAY_STEPS || s.replay.bytes + bytes > MAX_REPLAY_BYTES - 32768) {
            s.replay.truncated = true;

            return;
        }

        this.sql.exec('INSERT INTO replay_steps(game,value) VALUES(?,?)', s.gameId, value);
        s.replay.bytes += bytes;
        s.replay.count += steps.length;
    }

    seal(s: RoomState): void {
        if (!s.replay) { return; }

        if (s.replay.version !== 5) { return; }

        this.sql.exec('UPDATE replay_jobs SET header=?,due=? WHERE game=? AND due IS NULL', JSON.stringify(replayHeader(s)), Date.now() + 1, s.gameId);

        this.due = Math.min(this.due ?? Infinity, Date.now() + 1);
    }

    private readDue(): number | null { return this.sql.exec<{ due: number | null }>("SELECT MIN(due) AS due FROM replay_jobs WHERE due IS NOT NULL AND object_key LIKE 'replays/bs1/%'").toArray()[0]?.due ?? null; }

    nextDue(): number | null { return this.due; }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const result = this.queue.then(work);
        this.queue = result.catch(() => { });

        return result;
    }

    remove(key: string, r2: ScopedR2): Promise<void> {
        return this.serial(async () => {
            const job = this.sql.exec<{ game: string; due: number | null }>('SELECT game,due FROM replay_jobs WHERE object_key=? LIMIT 1', key).toArray()[0];

            if (job?.due === null) { throw Error('对局尚未安全关闭'); }

            if (job) {
                this.storage.transactionSync(() => {
                    this.sql.exec('DELETE FROM replay_steps WHERE game=?', job.game);
                    this.sql.exec('DELETE FROM replay_jobs WHERE game=?', job.game);
                });
            }

            this.due = this.readDue();
            // 先持久取消归档，再删除 R2；失败后仍可按原键重试，不会重新写回。
            await r2.delete(key);
        });
    }

    archive(r2: ScopedR2, db: PluginDB): Promise<void> {
        if (this.due === null || this.due > Date.now()) { return Promise.resolve(); }

        return this.serial(() => this.archiveOne(r2, db));
    }

    private async archiveOne(r2: ScopedR2, db: PluginDB): Promise<void> {
        if (this.due === null || this.due > Date.now()) { return; }

        const job = this.sql.exec<{ game: string; object_key: string; header: string; attempts: number }>("SELECT game,object_key,header,attempts FROM replay_jobs WHERE due<=? AND object_key LIKE 'replays/bs1/%' ORDER BY due LIMIT 1", Date.now()).toArray()[0];

        if (!job) {
            this.due = this.readDue();

            return;
        }

        // 写前保存退避时间，失败或结果未知均复用同一对象键；不重执行游戏或积分。
        this.sql.exec('UPDATE replay_jobs SET due=?,attempts=attempts+1 WHERE game=?', Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6)), job.game);

        try {
            const rows = this.sql.exec<{ value: string }>('SELECT value FROM replay_steps WHERE game=? ORDER BY seq', job.game).toArray();
            const header = JSON.parse(job.header) as ReplayHeader;
            const encodedHeader = JSON.stringify(header);
            // 步数已在 append 与房间状态同一事务限额；这里只拼接内部生成的 JSON 数组片段。
            let plain = new TextEncoder().encode(encodedHeader.slice(0, -1) + ',"steps":[' + rows.map(row => row.value.slice(1, -1)).filter(Boolean).join(',') + ']}');

            if (plain.length > MAX_REPLAY_BYTES) {
                const steps = rows.flatMap(row => JSON.parse(row.value) as ReplayWireStep[]);
                header.integrity = { complete: false, reason: '回放达到大小或操作步数上限，末尾步骤已截断' };

                do {
                    if (!steps.length) { throw Error('回放头部超过大小限制'); }

                    steps.splice(Math.floor(steps.length * 0.9));
                    plain = new TextEncoder().encode(JSON.stringify({ ...header, steps }));
                } while (plain.length > MAX_REPLAY_BYTES);
            }

            const signer = await replaySigningKey(db, decodeURIComponent(job.object_key.split('/')[2]));
            const file = await replayContainer.encode(plain, signer.privateKey, signer.id);
            await r2.put(job.object_key, file, { contentType: 'application/octet-stream', ...(this.owner ? { metadata: { room: this.owner } } : {}) });
            this.storage.transactionSync(() => {
                this.sql.exec('DELETE FROM replay_steps WHERE game=?', job.game);
                this.sql.exec('DELETE FROM replay_jobs WHERE game=?', job.game);
            });
        } finally { this.due = this.readDue(); }
    }
}
