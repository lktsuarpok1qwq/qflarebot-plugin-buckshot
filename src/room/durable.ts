import { completeChoices, expireRecalls, nextRecall, registerRecall, type RecallReceipt, type RecallState } from './recalls.js';
import { moneyReason } from './money-reason.js';
import { formatPoints } from '../amounts.js';
import { validateChallenge } from '../game/random.js';
import { RoomIndex, type IndexSnapshot } from './index.js';
import { captureStatistics, freshCounters, statisticsFact } from '../statistics/model.js';
import { StatisticsJournal } from '../statistics/store.js';
import { replayLink } from '../replay/access.js';
import { validReplayKey } from '../replay/manage.js';
import { ReplayJournal } from '../replay/journal.js';
import { operationStep, safeAction, type ReplayAction, type ReplayStep } from '../replay/format.js';
import { validateConversation } from '../conversation.js';
import { identifier, payout, validateConfig } from '../config.js';
import { requireRule, secureRandom } from '../game/types.js';
import { legalActions } from '../game/engine.js';
import type { CreateInput, MoneyTask, PanelReceipt, Request, RoomState, Task } from './model.js';
import { localWake, workDue, canClose } from './schedule.js';
import { blockClock, cancelGame, clock, mutate, playerName, enqueue, startGame, tick, view } from './state.js';
import { cleanName } from './names.js';
import { StoredObject } from './storage.js';
import { prepareDelivery } from './outbox.js';

export class BuckshotRoom extends StoredObject {
    private journal: ReplayJournal;
    private statisticsJournal: StatisticsJournal;
    private replaySteps: ReplayStep[] = [];
    private recordedStep = false;
    private index: RoomIndex;
    private latestState?: RoomState;

    constructor(state: DurableObjectState, env: unknown) {
        super(state, env, [...ReplayJournal.schema, ...StatisticsJournal.schema]);
        this.journal = new ReplayJournal(state.storage, state.id?.toString());
        this.statisticsJournal = new StatisticsJournal(state.storage);
        this.index = new RoomIndex(() => this.plugin.db, job => this.ctx.waitUntil(job), snapshot => this.indexPublished(snapshot), () => this.plugin.logger.warn('房间发现索引等待恢复'));
    }

    async deleteReplay(key: string): Promise<void> {
        const room = this.read<RoomState>('room');
        requireRule(room && validReplayKey(room.botId, key), '回放范围不符');
        await this.journal.remove(key, this.plugin.r2);
        await this.refreshSchedule();
    }

    private state(gameId?: string): RoomState {
        const s = this.read<RoomState>('room');
        requireRule(s && s.schemaVersion === 2 && (!gameId || s.gameId === gameId), '房间不存在或已失效');

        return s;
    }

    private async indexPublished(snapshot: IndexSnapshot): Promise<void> {
        await this.ctx.blockConcurrencyWhile(async () => {
            const current = this.latestState;

            if (current) {
                this.index.committed(snapshot, current);
                await this.setWake(current, this.index.dirty(current));
            }
        });
    }

    // 状态与恢复 Alarm 同一事务落盘；D1 是可重建的发现索引，发布失败由 Alarm 续做。
    private async change<T>(fn: () => T, publishWork = false): Promise<T> {
        const completed = await this.ctx.blockConcurrencyWhile(async () => {
            let state: RoomState | undefined;
            const result = await this.ctx.storage.transaction(async () => {
                this.cache = new Map();
                this.pending = new Map();
                this.encoded = new Map();
                this.read<RoomState>('room');
                const original = this.encoded.get('room');
                const before = this.cache.get('room') as RoomState | undefined;
                const beforeSeq = before?.seq ?? 0, beforeGame = !!before?.game;
                const beforeStatus = before?.status;
                this.replaySteps = [];
                this.recordedStep = false;
                let roomText: string | undefined;

                try {
                    const result = fn();
                    state = this.cache.get('room') as RoomState | undefined;

                    if (state) { this.index.enter(state); }

                    if (state?.statistics && state.status === 'CLOSED' && beforeStatus !== 'CLOSED') {
                        state.statistics.sealedAt ??= Date.now();
                        const fact = statisticsFact(state);

                        if (fact) { this.statisticsJournal.seal(fact); }
                    }

                    if (state?.replay || state?.statistics) {
                        if (!this.recordedStep && (!beforeGame && state.game || state.status === 'CANCELLED' && beforeStatus !== 'CANCELLED')) {
                            this.recordStep(state, { type: state.game && !beforeGame ? 'start' : 'cancel' }, state.game && !beforeGame ? state.host : undefined, beforeSeq);
                        }

                        if (state.replay?.version === 5) { this.journal.append(state, this.replaySteps); }

                        if (state.replay && state.status === 'CLOSED' && beforeStatus !== 'CLOSED') { this.journal.seal(state); }
                    }

                    if (state) {
                        const due = workDue(state, Date.now());

                        if (state.indexStatus !== state.status || state.indexDue !== due) {
                            state.indexVersion++;
                            state.indexStatus = state.status;
                            state.indexDue = due;
                        }

                        this.index.observe(state);

                        roomText = JSON.stringify(state);

                        if (roomText !== original) { this.pending.set('room', state); } else { this.pending.delete('room'); }
                    }

                    if (state && ['CANCELLED', 'CLOSED'].includes(state.status)) {
                        for (const messageId of this.retirePanel(state)) {
                            this.registerMessage(state.botId, state.groupId, { messageId, target: state.groupId, key: 'oldPanel', gameId: state.gameId, seconds: state.config.values.recallSeconds, sentAt: Date.now() });
                        }
                    }

                    const cleanup = this.read<RecallState>('message-cleanup');

                    if (cleanup && expireRecalls(cleanup, state, Date.now())) { this.write('message-cleanup', cleanup); }

                    const writes = this.pending;
                    this.pending = undefined;

                    for (const [id, value] of writes) {
                        this.ctx.storage.sql.exec('INSERT INTO state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', id, id === 'room' ? roomText! : JSON.stringify(value));
                    }

                    return result;
                } finally {
                    try { await this.setWake(state, state ? this.index.dirty(state) : false); } finally {
                        this.cache = undefined;
                        this.pending = undefined;
                        this.encoded = undefined;
                    }
                }
            });
            this.latestState = state;
            const snapshot: IndexSnapshot | undefined = state && this.index.dirty(state) && !this.index.deferred(state, publishWork)
                ? { botId: state.botId, groupId: state.groupId, gameId: state.gameId, status: state.status, indexDue: state.indexDue, indexVersion: state.indexVersion } : undefined;

            return { result, snapshot };
        });

        if (completed.snapshot) { this.index.enqueue(completed.snapshot); }

        return completed.result;
    }

    private async setWake(s: RoomState | undefined, dirty: boolean): Promise<void> {
        const recallDue = nextRecall(this.read<RecallState>('message-cleanup'));
        const now = Date.now(), fallback = recallDue === null ? null : recallDue + 30000 > now ? recallDue + 30000 : now + 60000;
        const wakes = [s ? localWake(s) : null, fallback, this.journal.nextDue(), this.statisticsJournal.nextDue()].filter((n): n is number => n !== null);
        const local = wakes.length ? Math.min(...wakes) : null;
        // 同一批待办共用首次到期时间，确认消息不反复将恢复 Alarm 后移几毫秒。
        const firstDue = s?.indexDue != null && s.indexDue <= now && s.indexDue + 60000 > now ? s.indexDue : now;
        const due = dirty ? Math.min(local ?? Infinity, firstDue + 60000) : local;
        const current = await this.ctx.storage.getAlarm();

        if (due === null) { if (current !== null) { await this.ctx.storage.deleteAlarm(); } } else if (current !== due) { await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, due)); }
    }

    async refreshSchedule(): Promise<void> { await this.change(() => { }); }

    private registerMessage(bot: string, scope: string, receipt: RecallReceipt): void {
        const state = this.read<RecallState>('message-cleanup') ?? { bot, scope, jobs: [] };
        requireRule(state.bot === bot && state.scope === scope, '消息清理范围不符');
        registerRecall(state, receipt);
        this.write('message-cleanup', state);
    }

    recallDue(): number | null { return nextRecall(this.read<RecallState>('message-cleanup')); }

    // 清理仅改变队列；房间只用于确认失效与恢复调度，暖实例复用上次提交的状态。
    private async changeRecalls<T>(fn: () => T): Promise<T> {
        return this.ctx.blockConcurrencyWhile(async () => {
            let room: RoomState | undefined;

            try {
                const result = await this.ctx.storage.transaction(async () => {
                    this.cache = new Map();
                    this.pending = new Map();
                    this.encoded = new Map();
                    room = this.latestState ?? this.read<RoomState>('room');
                    const cleanup = this.read<RecallState>('message-cleanup');

                    if (cleanup) { expireRecalls(cleanup, room, Date.now()); }

                    const result = fn();
                    const next = this.read<RecallState>('message-cleanup');

                    if (next) {
                        const text = JSON.stringify(next);

                        if (text !== this.encoded.get('message-cleanup')) {
                            this.ctx.storage.sql.exec('INSERT INTO state(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', 'message-cleanup', text);
                        }
                    }

                    await this.setWake(room, room ? this.index.dirty(room) : false);

                    return result;
                });
                this.latestState = room;

                return result;
            } finally {
                this.cache = undefined;
                this.pending = undefined;
                this.encoded = undefined;
            }
        });
    }

    async messageSent(bot: string, scope: string, receipt: RecallReceipt, panel?: PanelReceipt): Promise<number | null> {
        if (!panel) {
            return this.changeRecalls(() => {
                this.registerMessage(bot, scope, receipt);
                const cleanup = this.read<RecallState>('message-cleanup')!;
                expireRecalls(cleanup, this.latestState ?? this.read<RoomState>('room'), Date.now());

                return nextRecall(cleanup);
            });
        }

        await this.change(() => {
            const s = this.read<RoomState>('room');
            const cleanup = this.read<RecallState>('message-cleanup');

            if (cleanup && completeChoices(cleanup, receipt, true)) { this.write('message-cleanup', cleanup); }

            for (const messageId of this.rememberPanel(s, panel)) {
                this.registerMessage(bot, scope, { ...receipt, messageId, key: 'oldPanel', kind: undefined, until: undefined });
            }
        });

        return this.recallDue();
    }

    private takeRecalls(limit: number) {
        const state = this.read<RecallState>('message-cleanup');

        if (!state || !limit) { return []; }

        const now = Date.now();
        const exhausted = state.jobs.filter(j => j.due <= now && j.attempts >= 3);

        for (const job of exhausted) { this.plugin.logger.warn('消息撤回重试已用尽', { key: job.key, gameId: job.gameId, message: job.messageId.slice(-8), attempts: job.attempts, code: 'RECALL_LEASE_EXHAUSTED' }); }

        state.jobs = state.jobs.filter(j => !exhausted.includes(j));
        const jobs = state.jobs.filter(j => j.due <= now).slice(0, limit);

        for (const job of jobs) {
            job.attempts++;
            job.lease = crypto.randomUUID();
            job.due = now + 30000;
        }

        return structuredClone(jobs);
    }

    async claimRecalls(limit = 12) {
        requireRule(Number.isInteger(limit) && limit >= 1 && limit <= 12, '清理批次无效');

        return this.changeRecalls(() => this.takeRecalls(limit));
    }

    async recallsDone(results: { messageId: string; target: string; lease: string; ok: boolean }[], nextLimit = 0) {
        requireRule(Number.isInteger(nextLimit) && nextLimit >= 0 && nextLimit <= 12 && results.length <= 12, '清理批次无效');

        return this.changeRecalls(() => {
            const state = this.read<RecallState>('message-cleanup');

            if (state) {
                state.jobs = state.jobs.filter(job => {
                    const result = results.find(r => r.messageId === job.messageId && r.target === job.target && r.lease === job.lease);

                    if (!result) { return true; }

                    if (result.ok || job.attempts >= 3) { return false; }

                    job.lease = undefined;
                    job.due = Date.now() + (job.attempts === 1 ? 10000 : 30000);
                    job.kind = undefined;

                    return true;
                });
            }

            const jobs = this.takeRecalls(nextLimit);

            return { jobs, due: this.recallDue() };
        });
    }

    async create(input: CreateInput, name?: string, nameLookupAt = 0, replayBase?: string) {
        validateChallenge(input);
        validateConversation(input.groupId, input.mode, input.member.id);
        identifier(input.gameId);
        identifier(input.botId);
        identifier(input.groupId);
        identifier(input.member.id);
        identifier(input.member.privateId);
        requireRule(['solo', 'duo', 'multi'].includes(input.mode) && input.member.id !== 'ai' && !input.member.id.startsWith('ai:'), '模式或玩家无效');
        requireRule(Number.isInteger(input.difficulty) && input.difficulty >= 0 && input.difficulty <= 4, '难度无效');
        validateConfig(input.config.values);
        requireRule(!input.challenge || input.config.values.dailyEnabled, '每日挑战暂未开放');
        requireRule(Number.isSafeInteger(input.stake) && input.stake >= 0, '下注金额无效');
        const cfg = input.config.values;
        requireRule(input.stake ? cfg.stakesEnabled && input.stake >= cfg.minStake && input.stake <= cfg.maxStake : cfg.freeEnabled, '该模式未启用或金额不符');
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
                members: [{ ...input.member, name: playerName(cleanName(name ?? input.member.name), []), nameLookupAt }], paused: false, recovery: false, remainingMs: cfg.turnSeconds * 1000, reminderSent: false,
                outbox: [], seq: 0, money: [], reserved: false, renewal: 0, released: [], confirmations: {}, indexVersion: 0
            };
            s.statistics = freshCounters();

            if (replayBase) { s.replayBase = replayBase; }

            this.write('room', s);
            this.write('create', JSON.stringify(input));
        });

        return this.publicState();
    }

    isClosed(gameId: string): boolean { return !!this.read(`closed:${gameId}`); }

    async updateName(gameId: string, actor: string, claimId: string, name: string, nextLookup = 0): Promise<boolean> {
        const value = cleanName(name);

        return this.change(() => {
            const s = this.read<RoomState>('room');

            if (!s || s.gameId !== gameId || !['WAITING', 'PREPARING', 'PLAYING'].includes(s.status)) { return false; }

            const member = s.members.find(m => m.id === actor && (m.claimId ?? s.gameId) === claimId);

            if (!member) { return false; }

            // 空结果只延后缺名补查，不能清除已保存的昵称。
            if (!value) {
                if (member.nameLookupAt !== 0) { member.nameLookupAt = Math.max(member.nameLookupAt ?? 0, nextLookup); }

                return false;
            }

            member.name = value;
            member.nameLookupAt = 0;
            const player = s.game?.players.find(p => p.id === actor);

            if (player) { player.name = value; }

            return true;
        });
    }

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
        const reason = !s.members.some(m => m.id === actor) ? 'menuSpectator'
            : ['FINISHED', 'SETTLED', 'CANCELLED', 'CLOSED'].includes(s.status) || s.game?.finished ? 'menuEnded'
                : s.recovery ? 'menuRecovery' : s.paused ? 'menuPaused'
                    : s.status === 'WAITING' ? 'menuWaiting' : s.status !== 'PLAYING' ? 'menuPreparing'
                        : player && player.life <= 0 ? 'menuEliminated'
                            : s.game?.current !== actor ? 'menuOtherTurn'
                                : s.outbox.some(t => t.critical && t.state !== 'SENT') || (s.resultUntil ?? 0) > Date.now() ? 'menuBusy'
                                    : s.deadline === undefined || s.deadline <= Date.now() ? 'menuExpired' : undefined;

        return { room, moves: reason || !s.game ? [] : legalActions(s.game, actor), reason, name: player?.name ?? s.members.find(m => m.id === actor)?.name };
    }

    async act(request: Request, deliveryOnly = false) {
        const result = await this.change(() => {
            const outcome = this.execute(request);

            if ('error' in outcome) { return { error: outcome.error, room: view(this.state(request.gameId)) }; }

            return { work: this.prepareWork(this.state(request.gameId), true, !['confirmQuit', 'confirmClose'].includes(request.action.type), deliveryOnly) };
        });

        if (result.error) {
            if (result.error === '面板已更新，请查询状态' || result.error === '未轮到你行动') { return { stale: true as const, notice: result.error === '面板已更新，请查询状态' ? 'staleAction' : undefined, room: result.room! }; }

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

    private execute(request: Request, admin = false, name?: string, nameLookupAt = 0) {
        identifier(request.gameId);
        identifier(request.actionId);
        identifier(request.actor);
        const s = this.state(request.gameId), serialized = JSON.stringify({ request, admin });
        const prior = this.ctx.storage.sql.exec<{ request: string; result: string }>('SELECT request,result FROM ops WHERE id=?', request.actionId).toArray()[0];

        if (prior) {
            requireRule(prior.request === serialized, '操作编号冲突');

            return JSON.parse(prior.result) as { version: number; status: RoomState['status'] } | { error: string };
        }

        let value: { version: number; status: RoomState['status'] } | { error: string };
        const unchanged = this.encoded!.get('room')!;

        try {
            const joining = request.action.type === 'join' && s.status === 'WAITING' && Number.isSafeInteger(request.expectedVersion) && request.expectedVersion > 0 && request.expectedVersion <= s.version;
            requireRule(joining || request.expectedVersion === s.version, '面板已更新，请查询状态');
            const action = request.action.type === 'join' && name !== undefined ? { ...request.action, member: { ...request.action.member, name: cleanName(name), nameLookupAt } } : request.action;
            const repeatedReady = action.type === 'ready' && s.members.some(m => m.id === request.actor && m.ready);
            const previousSeq = s.seq, recorded = s.replay?.version === 5 ? safeAction(s, action as unknown as Record<string, unknown>, request.actor) : action.type === 'play' ? action.move : { type: action.type };
            mutate(s, { ...request, action }, admin, Date.now());

            if (!repeatedReady && !['confirmQuit', 'confirmClose', 'retry', 'reconcile'].includes(action.type) && !(action.type === 'start' && s.status === 'PREPARING')) { this.recordStep(s, recorded, request.actor, previousSeq); }

            value = { version: s.version, status: s.status };
            this.write('room', s);
        } catch (error) {
            this.cache!.set('room', JSON.parse(unchanged));
            this.pending!.delete('room');
            value = { error: error instanceof Error ? error.message : '操作被拒绝' };
        }

        this.ctx.storage.sql.exec('INSERT INTO ops(id,game,request,result) VALUES(?,?,?,?)', request.actionId, s.gameId, serialized, JSON.stringify(value));

        return value;
    }

    async command(request: Request, admin = false, name?: string, nameLookupAt = 0) {
        const result = await this.change(() => this.execute(request, admin, name, nameLookupAt));

        if ('error' in result) { throw new Error(result.error); }

        return result;
    }

    private recordStep(s: RoomState, action: ReplayAction, actor: string | undefined, previousSeq: number): void {
        // 战绩计数独立于回放格式；升级中的对局仍按实际操作统计。
        this.recordedStep = true;
        captureStatistics(s, action, actor, previousSeq);

        if (!s.game) { return; }

        if (!s.replay) {
            this.journal.start(s, s.replayBase);
            delete s.replayBase;
            action = { type: 'start' };
            actor = s.host;

            // 开局时已离场的玩家可能立即触发终局，补齐同一批结束消息的回放链接。
            for (const task of s.outbox.filter(t => t.seq > previousSeq)) {
                for (const part of task.parts ?? []) {
                    if (part.key === 'finish') { part.values.replayUrl = replayLink(s.replay!.key, s.replay!.base); }
                }
            }
        }

        if (s.replay?.version === 5 && !s.replay.truncated) { this.replaySteps.push(operationStep(s, action, actor, previousSeq)); }
    }

    private tick(s: RoomState, now: number, immediateAI = false): void {
        const previousSeq = s.seq;
        let operation: { actor: string; action: ReplayAction } | undefined;
        tick(s, now, immediateAI, (actor, move) => {
            operation = { actor, action: s.replay?.version === 5 ? safeAction(s, move as unknown as Record<string, unknown>, actor) : move };
        });

        if (operation) { this.recordStep(s, operation.action, operation.actor, previousSeq); }
    }

    async alarm(): Promise<void> {
        await this.change(() => {
            const s = this.read<RoomState>('room');

            if (s) {
                this.tick(s, Date.now());
                this.write('room', s);
            }
        }, true);

        const cleanup = this.read<RecallState>('message-cleanup'), recallDue = nextRecall(cleanup);

        if (cleanup && recallDue !== null && recallDue <= Date.now() && this.read<number>('cleanup-published') !== recallDue) {
            try {
                await this.plugin.db.run('INSERT INTO {coord_ops}(bot,id,game_id,request,state,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(bot,game_id,id) DO UPDATE SET expires_at=excluded.expires_at', cleanup.bot, cleanup.scope, 'message-cleanup', '{}', 'CLEANUP', recallDue);
                this.write('cleanup-published', recallDue);
            } catch { this.plugin.logger.warn('消息清理索引等待恢复', { code: 'RECALL_INDEX_PENDING' }); }
        }

        try { await this.statisticsJournal.publish(this.plugin.db); } catch { this.plugin.logger.warn('统计发布未确认，保留原摘要等待重试'); }

        try { await this.journal.archive(this.plugin.r2, this.plugin.db); } catch { this.plugin.logger.warn('回放保存未确认，保留原记录等待重试'); }

        await this.refreshSchedule();
    }

    async claimMessage(gameId: string): Promise<Task | null> {
        const result = await this.change(() => {
            const s = this.state(gameId), now = Date.now();
            this.tick(s, now);
            const task = prepareDelivery(s, true).task;
            this.write('room', s);

            return task;
        });

        return result;
    }

    private rememberPanel(s: RoomState | undefined, receipt: PanelReceipt): string[] {
        const old = this.read<PanelReceipt>('panel');

        if (old?.messageId === receipt.messageId) { return []; }

        if (!s || s.gameId !== receipt.gameId || old?.gameId === receipt.gameId && (old.version > receipt.version || old.version === receipt.version && old.order >= receipt.order)) { return [receipt.messageId]; }

        if (['FINISHED', 'SETTLING', 'SETTLED', 'CANCELLED', 'CLOSED'].includes(s.status) && receipt.version < s.version) { return [receipt.messageId]; }

        this.write('panel', receipt);

        return old?.messageId ? [old.messageId] : [];
    }

    async panelSent(receipt: PanelReceipt): Promise<string[]> {
        return this.change(() => this.rememberPanel(this.read<RoomState>('room'), receipt));
    }

    private retirePanel(s: RoomState): string[] {
        const old = this.read<PanelReceipt>('panel');

        if (!old?.messageId || old.gameId !== s.gameId || !['WAITING', 'PREPARING', 'PLAYING'].includes(old.status)) { return []; }

        this.write('panel', { ...old, version: s.version, messageId: '' });

        return [old.messageId];
    }

    private ack(s: RoomState, taskId: string, lease: string, outcome: 'SENT' | 'FAILED' | 'UNKNOWN', messageId?: string, errorCode?: string, sentAt?: number): string[] {
        const discarded: string[] = [];
        const task = s.outbox.find(t => t.id === taskId);
        requireRule(task?.state === 'SENDING' && task.lease === lease && task.leaseUntil! > Date.now(), '投递租约已失效');
        requireRule(outcome !== 'SENT' || task.kind === 'recall' || !!messageId, '缺少消息回执');
        task.state = outcome;
        task.error = errorCode;

        if (outcome === 'SENT') {
            task.sentAt = sentAt ?? Date.now();

            if (task.kind === 'message' && !task.private && task.parts?.some(p => p.key === 'load') && task.loadId === s.game?.loadId) {
                s.aiReadUntil = task.sentAt + (s.status === 'PLAYING' ? s.config.values.aiReadSeconds * 1000 : 0);
                // 装填阅读已经提供停顿，首个行动不再叠加随机间隔。
                s.aiPaceUntil = s.aiReadUntil;
                const recall: Task = { id: `${s.gameId}:m:${++s.seq}`, seq: s.seq, kind: 'recall', target: task.target, private: false, text: '', critical: false, loadId: task.loadId, messageId, announcementSentAt: task.sentAt, notBefore: s.aiReadUntil, state: 'PENDING', attempts: 0 };
                s.outbox.splice(s.outbox.indexOf(task) + 1, 0, recall);
                discarded.push(...this.retirePanel(s));
            }

            if (task.actionResult && s.status === 'PLAYING' && !s.outbox.some(t => t.parts?.some(p => p.key === 'load'))) {
                const ai = s.game!.players.find(p => p.id === s.game!.current)!.ai;
                const min = Math.round(s.config.values.aiIntervalMin * 10), max = Math.round(s.config.values.aiIntervalMax * 10);
                const interval = ai ? (min + (max > min ? secureRandom(max - min + 1) : 0)) * 100 : 0;
                s.resultUntil = task.sentAt + Math.max(s.config.values.actionDelaySeconds * 1000, interval);

                if (ai) { s.aiPaceUntil = s.resultUntil; }

                for (const pending of s.outbox) { if (pending.panel && pending.state === 'PENDING') { pending.notBefore = s.resultUntil; } }
            }

            if (messageId) { task.messageId = messageId; }

            if (task.panel && task.snapshot && task.panelOrder) {
                discarded.push(...this.rememberPanel(s, { gameId: s.gameId, version: task.snapshot.version, status: task.snapshot.status, order: task.panelOrder, messageId: messageId! }));
            } else if (['FINISHED', 'SETTLING', 'SETTLED', 'CANCELLED', 'CLOSED'].includes(s.status)) { discarded.push(...this.retirePanel(s)); }
        }

        if (outcome === 'SENT' && task.kind === 'message') {
            const sent = task.sentAt ?? Date.now();
            const reading = !task.private && task.loadId === s.game?.loadId && s.game?.players.find(p => p.id === s.game?.current)?.ai ? s.config.values.aiReadSeconds : 0;

            if (!task.keep && messageId && !task.parts?.some(p => p.key === 'load')) {
                this.registerMessage(s.botId, s.groupId, { messageId, target: task.private ? 'c2c:' + task.target : task.target, key: task.parts?.[0]?.key ?? 'message', gameId: s.gameId, seconds: Math.max(s.config.values.recallSeconds, reading), sentAt: sent });
            }

            for (const id of discarded) { this.registerMessage(s.botId, s.groupId, { messageId: id, target: s.groupId, key: 'oldPanel', gameId: s.gameId, seconds: task.parts?.some(p => p.key === 'load') ? 0 : s.config.values.recallSeconds, sentAt: sent }); }
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

        return discarded;
    }

    async acknowledge(gameId: string, taskId: string, lease: string, outcome: 'SENT' | 'FAILED' | 'UNKNOWN', messageId?: string, errorCode?: string): Promise<void> {
        await this.change(() => this.ack(this.state(gameId), taskId, lease, outcome, messageId, errorCode));
    }

    private prepareWork(s: RoomState, claim: boolean, immediateAI = false, deliveryOnly = false) {
        this.tick(s, Date.now(), immediateAI);

        // 撤回失败或执行回执丢失交给原清理队列重试，不阻塞玩家面板和倒计时。
        for (const task of s.outbox.filter(t => t.kind === 'recall' && ['FAILED', 'UNKNOWN'].includes(t.state))) {
            if (task.messageId) { this.registerMessage(s.botId, s.groupId, { messageId: task.messageId, target: task.target, key: 'load', gameId: s.gameId, seconds: 10, sentAt: Date.now() }); }

            s.outbox = s.outbox.filter(t => t !== task);
        }

        const cleanup = this.read<RecallState>('message-cleanup');

        if (cleanup && expireRecalls(cleanup, s, Date.now())) { this.write('message-cleanup', cleanup); }

        return { ...prepareDelivery(s, claim, deliveryOnly), recallDue: this.recallDue() };
    }

    async work(gameId?: string, ack?: { id: string; lease: string; outcome: 'SENT' | 'FAILED' | 'UNKNOWN'; messageId?: string; errorCode?: string; sentAt?: number }, claim = true, immediateAI = false, deliveryOnly = false) {
        return this.change(() => {
            const s = this.read<RoomState>('room');

            if (!s) { return null; }

            requireRule(!gameId || s.gameId === gameId, '房间已失效');

            const discardPanels = ack ? this.ack(s, ack.id, ack.lease, ack.outcome, ack.messageId, ack.errorCode, ack.sentAt) : [];

            return { ...this.prepareWork(s, claim, claim && immediateAI && (!ack || ack.outcome === 'SENT'), deliveryOnly), discardPanels };
        });
    }

    operationState(gameId: string, actionId: string) {
        const result = this.operation(gameId, actionId);

        return { status: result ? result.error ? 'REJECTED' : 'DONE' : this.isClosed(gameId) ? 'CLOSED' : 'NOT_FOUND', error: result?.error, room: this.publicState() };
    }

    async claimMoney(gameId: string): Promise<MoneyTask | null> {
        const result = await this.change(() => {
            const s = this.state(gameId);

            if (!s.money.length && !s.stake) { return null; }

            const now = Date.now();
            this.tick(s, now);

            for (const t of s.money) { if (t.state === 'SENDING' && t.leaseUntil! <= now) { t.state = 'UNKNOWN'; } }

            if (s.reserved && s.reserveUntil! - now <= 3600000 && s.status === 'PLAYING' && !s.money.some(t => t.state !== 'DONE')) {
                const expiresAtMs = Math.min(now + 86400000, s.reserveAt! + 180 * 86400000);

                if (expiresAtMs <= now + 3600000) {
                    cancelGame(s, now);
                } else {
                    s.renewal++;
                    s.members.forEach((_, i) => s.money.push({
                        id: `${s.gameId}:renew:${s.renewal}:${i}`, kind: 'renew', state: 'PENDING', input: {
                            source: 'buckshot', operationId: `${s.gameId}:renew:${s.renewal}:${i}`, reservationId: `${s.gameId}:r:${i}`, expiresAtMs,
                            reason: moneyReason(s, 'renew')
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
                if (t.kind === 'credit') {
                    requireRule(resolution === 'committed', '挑战奖励缺少到账依据');
                    enqueue(s, '', true).parts = [{ key: 'dailyRewardPaid', values: { amount: formatPoints((t.input as { amountMinor: number }).amountMinor), gameId: s.gameId } }];
                }

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

    async markReleased(gameId: string, userIds: string[]): Promise<void> {
        await this.change(() => {
            const s = this.state(gameId);
            requireRule(['FINISHED', 'SETTLED', 'CANCELLED'].includes(s.status) && (s.money.every(t => t.state === 'DONE' || t.kind === 'reserve' && t.state === 'FAILED')), '房间尚未安全结算');

            for (const userId of userIds) {
                requireRule(s.members.some(m => m.id === userId), '玩家不存在');

                if (!s.released.includes(userId)) { s.released.push(userId); }
            }

            if (s.members.every(m => s.released.includes(m.id)) && !s.outbox.some(t => t.critical && t.state !== 'SENT')) {
                s.status = 'CLOSED';
                this.write(`closed:${gameId}`, true);
                this.ctx.storage.sql.exec('DELETE FROM ops WHERE game=?', gameId);
            }

            this.write('room', s);
        });
    }
}
