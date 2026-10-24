import { renderMessage } from '../templates/send.js';
import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import { PluginDurableObject } from '@qqbot/sdk';
import { identifier, payout, validateConfig } from '../config.js';
import { requireRule } from '../game/types.js';
import { legalActions } from '../game/engine.js';
import type { CreateInput, MoneyTask, Request, RoomState, Task } from './model.js';
import { localWake, workDue, canClose } from './schedule.js';
import { blockClock, cancelGame, clock, mutate, playerName, startGame, tick, view } from './state.js';

abstract class StoredObject extends PluginDurableObject {
    protected cache?: Map<string, unknown>;
    protected pending?: Map<string, unknown>;
    protected encoded?: Map<string, string | undefined>;
    constructor(state: DurableObjectState, env: unknown) {
        super(state, env);
        const sql = this.ctx.storage.sql;
        const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'").toArray().map(t => t.name);

        if (!tables.length) {
            this.ctx.storage.transactionSync(() => {
                sql.exec('CREATE TABLE meta (version INTEGER NOT NULL)');
                sql.exec('INSERT INTO meta(version) VALUES(2)');
                sql.exec('CREATE TABLE state (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
                sql.exec('CREATE TABLE ops (id TEXT PRIMARY KEY, game TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
            });
        } else {
            requireRule(['meta', 'state', 'ops'].every(name => tables.includes(name)), '存储结构未识别');
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
export class BuckshotPlayerRegistry extends StoredObject {
    claim(input: { botId: string; userId: string; gameId: string; groupId: string; claimId?: string }): void {
        Object.values(input).forEach(identifier);
        this.ctx.storage.transactionSync(() => {
            const old = this.read<typeof input>('owner');
            requireRule(!old || JSON.stringify(old) === JSON.stringify(input), '你已在其他房间或等待安全关闭');

            if (!old) { this.write('owner', input); }
        });
    }

    owner() { return this.read<{ botId: string; userId: string; gameId: string; groupId: string; claimId?: string }>('owner') ?? null; }

    release(gameId: string, claimId?: string): void {
        this.ctx.storage.transactionSync(() => {
            const owner = this.owner();

            if (owner?.gameId === gameId && (!claimId || owner.claimId === claimId)) { this.ctx.storage.sql.exec('DELETE FROM state WHERE id=?', 'owner'); }
        });
    }
}
export class BuckshotRoom extends StoredObject {
    private state(gameId?: string): RoomState {
        const s = this.read<RoomState>('room');
        requireRule(s && s.schemaVersion === 2 && (!gameId || s.gameId === gameId), '房间不存在或已失效');

        return s;
    }

    private published = 0;
    private publishedSignature?: string;
    private publishedStatus?: string;
    private publishedGame = '';

    // 状态与恢复 Alarm 同一事务落盘；D1 是可重建的发现索引，发布失败由 Alarm 续做。
    private async change<T>(fn: () => T, publishWork = false): Promise<T> {
        return this.ctx.blockConcurrencyWhile(async () => {
            let state: RoomState | undefined;
            const result = await this.ctx.storage.transaction(async () => {
                this.cache = new Map();
                this.pending = new Map();
                this.encoded = new Map();
                this.read<RoomState>('room');
                const original = this.encoded.get('room');
                let roomText: string | undefined;

                try {
                    const result = fn();
                    state = this.cache.get('room') as RoomState | undefined;

                    if (state && this.publishedGame !== state.gameId) {
                        this.published = 0;
                        this.publishedSignature = undefined;
                        this.publishedStatus = undefined;
                        this.publishedGame = state.gameId;
                    }

                    if (state) {
                        const due = workDue(state, Date.now());

                        if (state.indexStatus !== state.status || state.indexDue !== due) {
                            state.indexVersion++;
                            state.indexStatus = state.status;
                            state.indexDue = due;
                        }

                        if (this.publishedSignature === JSON.stringify([state.gameId, state.status, state.indexDue])) { this.published = state.indexVersion; }

                        roomText = JSON.stringify(state);

                        if (roomText !== original) { this.pending.set('room', state); } else { this.pending.delete('room'); }
                    }

                    const writes = this.pending;
                    this.pending = undefined;

                    for (const [id, value] of writes) {
                        this.ctx.storage.sql.exec('INSERT INTO state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', id, id === 'room' ? roomText! : JSON.stringify(value));
                    }

                    return result;
                } finally {
                    this.cache = undefined;
                    this.pending = undefined;
                    this.encoded = undefined;

                    if (state) { await this.setWake(state, this.published < state.indexVersion); }
                }
            });
            // 前台短暂待办由当前请求执行；持久化 Alarm 在请求中断后发布，避免每枪两次 D1 心跳。
            const deferred = state && !publishWork && this.publishedStatus === state.status && state.indexDue != null && state.indexDue <= Date.now();

            if (state && this.published < state.indexVersion && !deferred) {
                try {
                    await this.plugin.db.run('UPDATE {rooms} SET status=?,due=?,revision=? WHERE bot=? AND group_id=? AND game=? AND revision<?', state.status, state.indexDue ?? null, state.indexVersion, state.botId, state.groupId, state.gameId, state.indexVersion);

                    if (state.status === 'CLOSED') { await this.plugin.db.run("DELETE FROM {coord_ops} WHERE bot=? AND game_id=? AND state<>'PENDING'", state.botId, state.gameId); }

                    this.published = state.indexVersion;
                    this.publishedSignature = JSON.stringify([state.gameId, state.status, state.indexDue]);
                    this.publishedStatus = state.status;
                    await this.setWake(state, false);
                } catch {
                    this.publishedSignature = undefined;
                    this.publishedStatus = undefined;
                    this.plugin.logger.warn('房间发现索引等待恢复');
                }
            }

            return result;
        });
    }

    private async setWake(s: RoomState, dirty: boolean): Promise<void> {
        const now = Date.now(), local = localWake(s);
        // 同一批待办共用首次到期时间，确认消息不反复将恢复 Alarm 后移几毫秒。
        const firstDue = s.indexDue != null && s.indexDue <= now && s.indexDue + 60000 > now ? s.indexDue : now;
        const due = dirty ? Math.min(local ?? Infinity, firstDue + 60000) : local;
        const current = await this.ctx.storage.getAlarm();

        if (due === null) { if (current !== null) { await this.ctx.storage.deleteAlarm(); } } else if (current !== due) { await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, due)); }
    }

    async refreshSchedule(): Promise<void> { await this.change(() => { }); }

    async create(input: CreateInput) {
        identifier(input.gameId);
        identifier(input.botId);
        identifier(input.groupId);
        identifier(input.member.id);
        identifier(input.member.privateId);
        requireRule(['solo', 'duo', 'multi'].includes(input.mode) && input.member.id !== 'ai', '模式或玩家无效');
        requireRule(Number.isInteger(input.difficulty) && input.difficulty >= 0 && input.difficulty <= 4, '难度无效');
        validateConfig(input.config.values);
        requireRule(Number.isSafeInteger(input.stake) && input.stake >= 0, '下注金额无效');
        const cfg = input.config.values;
        requireRule(input.stake ? cfg.stakesEnabled && cfg.calibrated && input.stake >= cfg.minStake && input.stake <= cfg.maxStake : cfg.freeEnabled, '该模式未启用或金额不符');
        requireRule(input.stake === 0 || (input.mode !== 'solo' || payout(input.stake, cfg.multipliers[input.difficulty]) <= 1e12 && payout(input.stake, cfg.multipliers[input.difficulty]) - input.stake <= cfg.rewardLimit), '奖励超出配置上限');
        await this.change(() => {
            const old = this.read<RoomState>('room');

            if (old?.gameId === input.gameId) {
                requireRule(this.read<string>('create') === JSON.stringify(input), '创建编号冲突');

                return;
            }

            requireRule(!old || old.status === 'CLOSED', '本群已有房间');
            requireRule(!this.read(`closed:${input.gameId}`), '创建编号已关闭');
            const s: RoomState = {
                ...input, schemaVersion: 2, host: input.member.id, version: 1, status: 'WAITING', createdAt: Date.now(),
                members: [{ ...input.member, name: playerName(input.member.name, []) }], paused: false, recovery: false, remainingMs: cfg.turnSeconds * 1000, reminderSent: false,
                outbox: [], seq: 0, money: [], reserved: false, renewal: 0, released: [], confirmations: {}, indexVersion: 0
            };
            this.write('room', s);
            this.write('create', JSON.stringify(input));
        });

        return this.publicState();
    }

    isClosed(gameId: string): boolean { return !!this.read(`closed:${gameId}`); }

    async abandonCreation(gameId: string): Promise<void> {
        await this.change(() => {
            requireRule(this.read<RoomState>('room')?.gameId !== gameId, '房间已创建，须按房间状态恢复');
            this.write(`closed:${gameId}`, true);
        });
    }

    safeToRelease(gameId: string, userId: string): boolean {
        if (this.isClosed(gameId)) { return true; }

        const s = this.read<RoomState>('room');

        return !!s && s.gameId === gameId && !s.members.some(m => m.id === userId) && !!s.pendingReleases?.some(p => p.id === userId);
    }

    async acknowledgeRelease(gameId: string, userId: string, claimId: string): Promise<void> {
        await this.change(() => {
            const s = this.state(gameId);
            s.pendingReleases = s.pendingReleases?.filter(p => p.id !== userId || p.claimId !== claimId);
            this.write('room', s);
        });
    }

    menu(gameId: string, actor: string) {
        identifier(gameId);
        identifier(actor);
        const s = this.state(gameId), room = view(s), player = s.game?.players.find(p => p.id === actor);
        const current = s.game?.players.find(p => p.id === s.game?.current);
        const reason = !s.members.some(m => m.id === actor) ? 'menuSpectator'
            : ['FINISHED', 'SETTLED', 'CANCELLED', 'CLOSED'].includes(s.status) || s.game?.finished ? 'menuEnded'
                : s.recovery ? 'menuRecovery' : s.paused ? 'menuPaused'
                    : s.status === 'WAITING' ? 'menuWaiting' : s.status !== 'PLAYING' ? 'menuPreparing'
                        : player && player.life <= 0 ? 'menuEliminated'
                            : s.game?.current !== actor ? 'menuOtherTurn'
                                : s.outbox.some(t => t.critical && t.state !== 'SENT') ? 'menuBusy'
                                    : s.deadline === undefined || s.deadline <= Date.now() ? 'menuExpired' : undefined;

        return { room, moves: reason || !s.game ? [] : legalActions(s.game, actor), reason, name: current?.name };
    }

    async act(request: Request) {
        const result = await this.change(() => {
            const outcome = this.execute(request);

            if ('error' in outcome) { return { error: outcome.error, room: view(this.state(request.gameId)) }; }

            return { work: this.prepareWork(this.state(request.gameId), true, request.action.type !== 'confirmQuit') };
        });

        if (result.error) {
            if (result.error === '面板已更新，请查询状态') { return { stale: true as const, room: result.room! }; }

            throw new Error(result.error);
        }

        return { stale: false as const, work: result.work! };
    }

    publicState() {
        const s = this.read<RoomState>('room');

        return s ? view(s) : null;
    }

    coordinationState() { return this.read<RoomState>('room') ?? null; }

    operation(gameId: string, actionId: string) {
        const row = this.ctx.storage.sql.exec<{ result: string }>('SELECT result FROM ops WHERE game=? AND id=?', gameId, actionId).toArray()[0];

        return row ? JSON.parse(row.result) as { error?: string } : null;
    }

    async systemEvent(actionId: string, target: string | null, timestamp: number): Promise<boolean> {
        const s = this.read<RoomState>('room');

        if (!s || s.status === 'CLOSED' || Math.floor(timestamp / 1000) < Math.floor(s.createdAt / 1000)) { return false; }

        if (target && (!['WAITING', 'PREPARING', 'PLAYING'].includes(s.status) || !s.members.some(m => m.id === target))) { return false; }

        await this.command({ gameId: s.gameId, expectedVersion: s.version, actionId, actor: 'admin', action: target ? { type: 'removed', target } : { type: 'abort' } }, true);

        return true;
    }

    private execute(request: Request, admin = false) {
        identifier(request.gameId);
        identifier(request.actionId);
        identifier(request.actor);
        const s = this.state(request.gameId), serialized = JSON.stringify({ request, admin });
        const prior = this.ctx.storage.sql.exec<{ request: string; result: string }>('SELECT request,result FROM ops WHERE id=?', request.actionId).toArray()[0];

        if (prior) {
            requireRule(prior.request === serialized, '操作编号冲突');

            return JSON.parse(prior.result) as ReturnType<typeof view> | { error: string };
        }

        let value: ReturnType<typeof view> | { error: string };
        const unchanged = this.encoded!.get('room')!;

        try {
            requireRule(request.expectedVersion === s.version, '面板已更新，请查询状态');
            mutate(s, request, admin, Date.now());
            value = view(s);
            this.write('room', s);
        } catch (error) {
            this.cache!.set('room', JSON.parse(unchanged));
            this.pending!.delete('room');
            value = { error: error instanceof Error ? error.message : '操作被拒绝' };
        }

        this.ctx.storage.sql.exec('INSERT INTO ops(id,game,request,result) VALUES(?,?,?,?)', request.actionId, s.gameId, serialized, JSON.stringify(value));

        return value;
    }

    async command(request: Request, admin = false) {
        const result = await this.change(() => this.execute(request, admin));

        if ('error' in result) { throw new Error(result.error); }

        return result;
    }

    async alarm(): Promise<void> {
        await this.change(() => {
            const s = this.read<RoomState>('room');

            if (s) {
                tick(s, Date.now());
                this.write('room', s);
            }
        }, true);
    }

    async claimMessage(gameId: string): Promise<Task | null> {
        const result = await this.change(() => {
            const s = this.state(gameId), now = Date.now();
            tick(s, now);
            const next = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && (t.state === 'FAILED' || t.state === 'UNKNOWN')));

            if (!next || next.state !== 'PENDING') {
                this.write('room', s);

                return null;
            }

            if (next.panel && !next.snapshot) { next.snapshot = JSON.parse(JSON.stringify(view(s))) as ReturnType<typeof view>; }

            next.state = 'SENDING';
            next.lease = crypto.randomUUID();
            next.leaseUntil = now + 60000;
            next.attempts++;
            this.write('room', s);

            return next;
        });

        return result;
    }

    private ack(s: RoomState, taskId: string, lease: string, outcome: 'SENT' | 'FAILED' | 'UNKNOWN', messageId?: string, errorCode?: string): void {
        const task = s.outbox.find(t => t.id === taskId);
        requireRule(task?.state === 'SENDING' && task.lease === lease && task.leaseUntil! > Date.now(), '投递租约已失效');
        requireRule(outcome !== 'SENT' || task.kind === 'recall' || !!messageId, '缺少消息回执');
        task.state = outcome;
        task.error = errorCode;

        if (outcome === 'SENT') {
            task.sentAt = Date.now();

            if (task.kind === 'message' && !task.private && task.loadId === s.game?.loadId && s.game?.players.find(p => p.id === s.game?.current)?.ai) { s.aiReadUntil = task.sentAt + 5000; }

            if (messageId) { task.messageId = messageId; }
        }

        if (outcome !== 'SENT' && task.critical) {
            s.recovery = true;
            s.reason = '关键消息投递失败或结果未知';
            blockClock(s, Date.now());
        }

        // 群消息清理由当前请求的 SDK waitUntil 执行，不把成功消息累积成历史。
        s.outbox = s.outbox.filter(t => t.state !== 'SENT');
        clock(s, Date.now());
        this.write('room', s);
    }

    async acknowledge(gameId: string, taskId: string, lease: string, outcome: 'SENT' | 'FAILED' | 'UNKNOWN', messageId?: string, errorCode?: string): Promise<void> {
        await this.change(() => this.ack(this.state(gameId), taskId, lease, outcome, messageId, errorCode));
    }

    private prepareWork(s: RoomState, claim: boolean, immediateAI = false) {
        tick(s, Date.now(), immediateAI);
        const next = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && (t.state === 'FAILED' || t.state === 'UNKNOWN')));
        let task: Task | null = null;

        if (claim && next?.state === 'PENDING') {
            if (next.panel && !next.snapshot) { next.snapshot = view(s); }

            if (next.kind === 'message' && !next.payload) {
                const player = s.game?.players.find(p => p.id === s.game?.current);
                const menu = next.panel && s.status === 'PLAYING' && !s.paused && !s.recovery && player && !player.ai;
                next.keep = !!menu || !!next.panel && s.status === 'WAITING';
                next.payload = renderMessage(DEFAULT_CONFIGURATION, menu ? 'menu' : next.panel ? 'panel' : next.parts![0].key,
                    { room: next.snapshot, parts: next.parts, mentionCurrent: next.panel, ...(menu ? { actor: player.id, moves: legalActions(s.game!, player.id) } : {}) });
            }

            next.state = 'SENDING';
            next.lease = crypto.randomUUID();
            next.leaseUntil = Date.now() + 60000;
            next.attempts++;
            task = structuredClone(next);
        }

        return {
            moves: !task && s.game && s.status === 'PLAYING' && !s.paused && !s.recovery && s.deadline !== undefined && s.deadline > Date.now() && !s.game.players.find(p => p.id === s.game?.current)?.ai ? legalActions(s.game) : [],
            gameId: s.gameId, stake: s.stake, mode: s.mode, resumeAt: !task && s.status === 'PLAYING' && !s.paused && !s.recovery ? s.aiReadUntil : undefined, moneyDue: !!s.stake && (s.money.some(t => t.state === 'PENDING' || t.state === 'UNKNOWN' && (t.retryAt ?? 0) <= Date.now()) || s.reserved && s.status === 'PLAYING' && s.reserveUntil! - Date.now() <= 3600000), task,
            release: canClose(s) ? s.members.filter(m => !s.released.includes(m.id)).map(m => m.id) : [], closeEmpty: canClose(s) && !s.members.length,
            pendingReleases: s.pendingReleases ?? [], room: view(s)
        };
    }

    async work(gameId?: string, ack?: { id: string; lease: string; outcome: 'SENT' | 'FAILED' | 'UNKNOWN'; messageId?: string; errorCode?: string }, claim = true, immediateAI = false) {
        return this.change(() => {
            const s = this.read<RoomState>('room');

            if (!s) { return null; }

            requireRule(!gameId || s.gameId === gameId, '房间已失效');

            if (ack) { this.ack(s, ack.id, ack.lease, ack.outcome, ack.messageId, ack.errorCode); }

            return this.prepareWork(s, claim, claim && immediateAI && (!ack || ack.outcome === 'SENT'));
        });
    }

    operationState(gameId: string, actionId: string) {
        const result = this.operation(gameId, actionId);

        return { status: result ? result.error ? 'REJECTED' : 'DONE' : this.isClosed(gameId) ? 'CLOSED' : 'NOT_FOUND', error: result?.error, room: this.publicState() };
    }

    async claimMoney(gameId: string): Promise<MoneyTask | null> {
        const result = await this.change(() => {
            const s = this.state(gameId);

            if (!s.stake) { return null; }

            const now = Date.now();
            tick(s, now);

            for (const t of s.money) { if (t.state === 'SENDING' && t.leaseUntil! <= now) { t.state = 'UNKNOWN'; } }

            if (s.reserved && s.reserveUntil! - now <= 3600000 && s.status === 'PLAYING' && !s.money.some(t => t.state !== 'DONE')) {
                const expiresAtMs = Math.min(now + 86400000, s.reserveAt! + 180 * 86400000);

                if (expiresAtMs <= now + 3600000) {
                    cancelGame(s, now);
                } else {
                    s.renewal++;
                    s.members.forEach((_, i) => s.money.push({
                        id: `${s.gameId}:renew:${s.renewal}:${i}`, kind: 'renew', state: 'PENDING', input: {
                            source: 'buckshot', operationId: `${s.gameId}:renew:${s.renewal}:${i}`, reservationId: `${s.gameId}:r:${i}`, expiresAtMs
                        }
                    }));
                }
            }

            if (s.status === 'SETTLING') {
                for (const t of s.money) {
                    if (t.kind === 'renew' && t.state === 'FAILED') {
                        t.state = 'DONE';
                        t.evidence = '续期确定拒绝，继续核对既有本金';
                        t.resolution = 'rejected';
                    }
                }
            }

            const t = s.money.find(t => t.state !== 'DONE');

            if (!t || t.state === 'SENDING' || t.state === 'FAILED' || t.state === 'UNKNOWN' && (t.retryAt ?? 0) > now) {
                this.write('room', s);

                return null;
            }

            const prior = structuredClone(t);
            t.state = 'SENDING';
            t.lease = crypto.randomUUID();
            t.leaseUntil = now + 60000;
            this.write('room', s);

            return { ...t, state: prior.state };
        });

        return result;
    }

    async moneyResult(gameId: string, taskId: string, lease: string, outcome: 'DONE' | 'UNKNOWN' | 'FAILED', evidence?: string, resolution: 'committed' | 'inactive' | 'rejected' = 'committed'): Promise<void> {
        await this.change(() => {
            const s = this.state(gameId), t = s.money.find(t => t.id === taskId);
            requireRule(t?.state === 'SENDING' && t.lease === lease && t.leaseUntil! > Date.now(), '资金租约失效');
            t.state = outcome;

            if (outcome === 'UNKNOWN') {
                t.retries = (t.retries ?? 0) + 1;
                t.retryAt = Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(t.retries - 1, 6));
            }

            t.evidence = evidence;
            t.resolution = outcome === 'DONE' ? resolution : outcome === 'FAILED' ? 'rejected' : undefined;
            requireRule(outcome !== 'DONE' || evidence, '缺少资金核对依据');

            if (outcome === 'DONE') {
                if (t.kind === 'reserve') {
                    s.reserved = true;

                    if (s.abortRequested || s.reserveUntil! <= Date.now()) {
                        cancelGame(s, Date.now());
                    } else { startGame(s, Date.now()); }
                }

                if (t.kind === 'renew' && s.money.filter(m => m.kind === 'renew' && (m.input as { expiresAtMs: number }).expiresAtMs === (t.input as { expiresAtMs: number }).expiresAtMs).every(m => m.state === 'DONE' && m.resolution === 'committed')) { s.reserveUntil = (t.input as { expiresAtMs: number }).expiresAtMs; }

                if (s.status === 'SETTLING' && s.money.every(m => m.state === 'DONE')) { s.status = 'SETTLED'; }
            } else if (outcome === 'FAILED' && t.kind === 'reserve') {
                s.status = 'CANCELLED';
                s.recovery = false;
            } else {
                s.recovery = true;
                s.reason = '资金操作需要核对';
                blockClock(s, Date.now());
            }

            this.write('room', s);
        });
    }

    async markReleased(gameId: string, userId: string): Promise<void> {
        await this.change(() => {
            const s = this.state(gameId);
            requireRule(['FINISHED', 'SETTLED', 'CANCELLED'].includes(s.status) && (!s.stake || s.money.every(t => t.state === 'DONE' || t.kind === 'reserve' && t.state === 'FAILED')), '房间尚未安全结算');

            if (userId && !s.released.includes(userId)) { s.released.push(userId); }

            if (s.members.every(m => s.released.includes(m.id)) && !s.outbox.some(t => t.critical && t.state !== 'SENT')) {
                s.status = 'CLOSED';
                this.write(`closed:${gameId}`, true);
                this.ctx.storage.sql.exec('DELETE FROM ops WHERE game=?', gameId);
            }

            this.write('room', s);
        });
    }
}
