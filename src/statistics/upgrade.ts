import { COUNTS, MONEY } from './model.js';
import { statisticsDDL } from './store.js';

// 一次性补齐分类字段，保留旧金额和计数；不能从历史合计猜测玩法或均值。
export function statisticsUpgrade(): string[] {
    const added = ['started', 'unopened', 'timedGames', 'completedDurationMs', 'completedShots', 'completedItems', 'completedTimeouts'];
    const previous = [...COUNTS.filter(k => !added.includes(k)), ...MONEY];

    return [
        "ALTER TABLE {stats_games} ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'",
        ...added.map(k => `ALTER TABLE {stats_games} ADD COLUMN ${k} INTEGER NOT NULL DEFAULT 0`),
        'DROP TRIGGER {stats_rollup}',
        'ALTER TABLE {stats_daily} RENAME TO {stats_daily_previous}',
        ...statisticsDDL(),
        `INSERT INTO {stats_daily}(bot,day,mode,kind,paid,difficulty,${[...COUNTS, ...MONEY].join(',')}) SELECT bot,day,mode,'unknown',paid,difficulty,${[...COUNTS, ...MONEY].map(k => previous.includes(k) ? k : '0').join(',')} FROM {stats_daily_previous}`,
        'DROP TABLE {stats_daily_previous}',
        'UPDATE {meta} SET version=6 WHERE id=1 AND version=5'
    ];
}
