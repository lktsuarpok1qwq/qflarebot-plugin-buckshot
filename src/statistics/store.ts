import type { PluginDB } from '@qqbot/sdk';
import { COUNTS, MONEY, type Fact } from './model.js';

export const STAT_COLUMNS = ['bot', 'game', 'day', 'mode', 'paid', 'difficulty', ...COUNTS, ...MONEY] as const;

export function statisticsDDL(): string[] {
    const numbers = [...COUNTS, ...MONEY];

    return [
        `CREATE TABLE IF NOT EXISTS {stats_games} (${STAT_COLUMNS.map(k => ['bot', 'game', 'day', 'mode'].includes(k) ? k + ' TEXT NOT NULL' : k + ' INTEGER NOT NULL').join(',')},PRIMARY KEY(bot,game)) WITHOUT ROWID`,
        `CREATE TABLE IF NOT EXISTS {stats_daily} (bot TEXT NOT NULL,day TEXT NOT NULL,mode TEXT NOT NULL,paid INTEGER NOT NULL,difficulty INTEGER NOT NULL,${numbers.map(k => k + ' INTEGER NOT NULL').join(',')},PRIMARY KEY(bot,day,mode,paid,difficulty)) WITHOUT ROWID`,
        `CREATE TRIGGER IF NOT EXISTS {stats_rollup} AFTER INSERT ON {stats_games} BEGIN UPDATE {stats_daily} SET ${numbers.map(k => k + '=' + k + '+NEW.' + k).join(',')} WHERE bot=NEW.bot AND day=NEW.day AND mode=NEW.mode AND paid=NEW.paid AND difficulty=NEW.difficulty; INSERT OR IGNORE INTO {stats_daily}(bot,day,mode,paid,difficulty,${numbers.join(',')}) VALUES(NEW.bot,NEW.day,NEW.mode,NEW.paid,NEW.difficulty,${numbers.map(k => 'NEW.' + k).join(',')}); END`
    ];
}

export async function publishFact(db: PluginDB, fact: Fact): Promise<void> {
    const inserted = await db.run(`INSERT OR IGNORE INTO {stats_games}(${STAT_COLUMNS.join(',')}) VALUES(${STAT_COLUMNS.map(() => '?').join(',')})`, ...STAT_COLUMNS.map(k => fact[k]));

    if (!inserted.changes) {
        const old = await db.first<Fact>(`SELECT ${STAT_COLUMNS.join(',')} FROM {stats_games} WHERE bot=? AND game=?`, fact.bot, fact.game);

        if (!old || STAT_COLUMNS.some(k => old[k] !== fact[k])) { throw Error('统计摘要编号冲突'); }
    }
}

export class StatisticsJournal {
    private due: number | null;
    private queue: Promise<unknown> = Promise.resolve();
    static readonly schema = [
        'CREATE TABLE statistics_jobs(game TEXT PRIMARY KEY,value TEXT NOT NULL,due INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)',
        'CREATE INDEX statistics_jobs_due ON statistics_jobs(due)'
    ];

    constructor(private storage: DurableObjectStorage) { this.due = this.readDue(); }

    private readDue(): number | null { return this.storage.sql.exec<{ due: number | null }>('SELECT MIN(due) AS due FROM statistics_jobs').toArray()[0]?.due ?? null; }

    nextDue(): number | null { return this.due; }

    seal(fact: Fact): void {
        const due = Date.now() + 1;
        this.storage.sql.exec('INSERT OR IGNORE INTO statistics_jobs(game,value,due) VALUES(?,?,?)', fact.game, JSON.stringify(fact), due);
        this.due = Math.min(this.due ?? Infinity, due);
    }

    publish(db: PluginDB): Promise<void> {
        if (this.due === null || this.due > Date.now()) { return Promise.resolve(); }

        const run = this.queue.then(async () => {
            const sql = this.storage.sql;
            const job = sql.exec<{ game: string; value: string; attempts: number }>('SELECT game,value,attempts FROM statistics_jobs WHERE due<=? ORDER BY due LIMIT 1', Date.now()).toArray()[0];

            if (!job) {
                this.due = this.readDue();

                return;
            }

            sql.exec('UPDATE statistics_jobs SET due=?,attempts=attempts+1 WHERE game=?', Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(6, job.attempts)), job.game);

            try {
                await publishFact(db, JSON.parse(job.value));
                sql.exec('DELETE FROM statistics_jobs WHERE game=?', job.game);
            } finally { this.due = this.readDue(); }
        });
        this.queue = run.catch(() => { });

        return run;
    }
}
