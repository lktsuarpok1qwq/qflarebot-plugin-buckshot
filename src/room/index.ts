import type { PluginDB } from '@qqbot/sdk';
import type { RoomState } from './model.js';

export type IndexSnapshot = Pick<RoomState, 'botId' | 'groupId' | 'gameId' | 'status' | 'indexDue' | 'indexVersion'>;
const signature = (s: IndexSnapshot) => JSON.stringify([s.gameId, s.status, s.indexDue]);

// 权威状态与恢复 Alarm 先落盘，发现索引在串行事务之外合并发布。
export class RoomIndex {
    private game = '';
    private version = 0;
    private saved?: string;
    private status?: RoomState['status'];
    private pending?: IndexSnapshot;
    private publishing?: Promise<void>;
    private inflight?: IndexSnapshot;

    constructor(private db: () => PluginDB, private background: (job: Promise<void>) => void, private acknowledge: (snapshot: IndexSnapshot) => Promise<void>, private failed: () => void) { }

    enter(s: RoomState): void {
        if (this.game !== s.gameId) {
            this.game = s.gameId;
            this.version = 0;
            this.saved = undefined;
            this.status = undefined;
            this.pending = undefined;
        }
    }

    observe(s: RoomState): void {
        const changing = this.inflight?.gameId === s.gameId && signature(this.inflight) !== this.saved;

        if (!changing && this.saved === signature(s)) { this.version = s.indexVersion; }
    }

    dirty(s: RoomState): boolean { return this.game !== s.gameId || this.version < s.indexVersion; }

    deferred(s: RoomState, force: boolean): boolean { return !force && this.status === s.status && s.indexDue != null && s.indexDue <= Date.now(); }

    committed(snapshot: IndexSnapshot, current: RoomState): void {
        if (snapshot.gameId !== this.game || snapshot.gameId !== current.gameId || snapshot.indexVersion < this.version) { return; }

        this.version = snapshot.indexVersion;
        this.saved = signature(snapshot);
        this.status = snapshot.status;
        this.observe(current);
    }

    enqueue(snapshot: IndexSnapshot): void {
        if (snapshot.gameId !== this.game || snapshot.indexVersion <= this.version) { return; }

        if (!this.pending || snapshot.indexVersion >= this.pending.indexVersion) { this.pending = snapshot; }

        if (this.publishing) { return; }

        const job = Promise.resolve().then(async () => {
            // 高并发时合并中间状态；本轮有界，剩余脏索引仍由已落盘 Alarm 恢复。
            for (let i = 0; this.pending && i < 4; i++) {
                const next = this.pending;
                this.pending = undefined;

                if (next.gameId !== this.game || next.indexVersion <= this.version) { continue; }

                this.inflight = next;

                try {
                    await this.db().run('UPDATE {rooms} SET status=?,due=?,revision=? WHERE bot=? AND group_id=? AND game=? AND revision<?', next.status, next.indexDue ?? null, next.indexVersion, next.botId, next.groupId, next.gameId, next.indexVersion);

                    if (next.status === 'CLOSED') { await this.db().run("DELETE FROM {coord_ops} WHERE bot=? AND game_id=? AND state<>'PENDING'", next.botId, next.gameId); }

                    await this.acknowledge(next);
                } catch {
                    if (next.gameId === this.game) {
                        this.saved = undefined;
                        this.status = undefined;
                    }

                    this.failed();

                    return;
                } finally { this.inflight = undefined; }
            }
        }).finally(() => { this.publishing = undefined; });
        this.publishing = job;
        this.background(job);
    }
}
