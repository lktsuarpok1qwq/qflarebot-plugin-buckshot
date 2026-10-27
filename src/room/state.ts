import { beginWebFrame, webEvents } from '../web/state.js';
import { moneyReason } from './money-reason.js';
import { roomRandom, type RandomState } from '../game/random.js';
import { PERSONALITIES } from '../game/personality.js';
import { secureRandom } from '../game/types.js';
import { replayLink } from '../replay/access.js';
import { isPrivateScope } from '../conversation.js';
import { DEFAULT_REPLIES, renderTemplate } from '../templates/replies.js';
import { applyAction, createGame, publicGame } from '../game/engine.js';
import { chooseAction, observe } from '../game/ai.js';
import { requireRule, type Action, type GameEvent } from '../game/types.js';
import { payout } from '../config.js';
import type { RoomState, Request, Task } from './model.js';

// 在房间事务中分配展示名；请求仍保留原始昵称，重放不因房间人数变化而改变参数。
export function playerName(name: string, members: Pick<RoomState['members'][number], 'name'>[]): string {
    if (name) { return name; }

    for (let number = 1; number <= members.length + 1; number++) {
        const candidate = renderTemplate(DEFAULT_REPLIES.fallbackPlayer, { number: String(number) });

        if (!members.some(m => m.name === candidate)) { return candidate; }
    }

    throw Error('默认玩家昵称模板须保留编号变量');
}

export function enqueue(s: RoomState, text: string, critical = false, privateId?: string, loadId?: number, panel = false): Task {
    const seq = ++s.seq;
    const task: Task = {
        id: `${s.gameId}:m:${seq}`, seq, kind: 'message', target: privateId ?? s.groupId, private: !!privateId,
        text, critical, loadId, panel, state: s.web && s.game ? 'SENT' : 'PENDING', attempts: 0
    };
    s.outbox.push(task);

    return task;
}

export function blockClock(s: RoomState, now: number): void {
    if (s.deadline !== undefined) { s.remainingMs = Math.max(0, s.deadline - now); }

    s.deadline = undefined;
    s.aiDue = undefined;
}

export function clock(s: RoomState, now: number): void {
    if (s.resultUntil !== undefined && s.resultUntil <= now) { s.resultUntil = undefined; }

    if (s.aiReadUntil !== undefined && s.aiReadUntil <= now) { s.aiReadUntil = undefined; }

    if (s.status !== 'PLAYING' || s.paused || s.recovery || s.aiReadUntil !== undefined || s.resultUntil !== undefined || s.outbox.some(t => t.critical && t.state !== 'SENT' || t.kind === 'recall' && ['PENDING', 'SENDING'].includes(t.state))) {
        blockClock(s, now);

        return;
    }

    const ai = s.game!.players.find(p => p.id === s.game!.current)!.ai;

    if (ai) {
        if (s.aiPaceUntil === undefined) {
            const min = Math.round(s.config.values.aiIntervalMin * 10), max = Math.round(s.config.values.aiIntervalMax * 10);
            // 展示节奏不消耗游戏或 AI 决策随机流；截止时间随原房间事务保存。
            s.aiPaceUntil = now + (min + (max > min ? secureRandom(max - min + 1) : 0)) * 100;
        }

        if (s.aiPaceUntil > now) {
            blockClock(s, now);
            s.aiDue = s.aiPaceUntil + (s.web ? 0 : s.config.values.aiDelaySeconds * 1000);

            return;
        }
    } else { s.aiPaceUntil = undefined; }

    if (s.deadline === undefined) { s.deadline = now + s.remainingMs; }

    if (ai && s.aiDue === undefined) { s.aiDue = now + (s.web ? 0 : s.config.values.aiDelaySeconds * 1000); }
}

export function events(s: RoomState, values: GameEvent[], oldTurn: number, now: number, oldCurrent?: string): void {
    s.replayIntel = [...(s.replayIntel ?? []), ...values.filter(e => e.type === 'intel')];

    if (s.web) {
        webEvents(s, values, now);
        (s.operationEvents ??= []).push(...values);
    }

    if (!s.web) { s.aiPaceUntil = undefined; }

    let summary: import('../templates/presentation.js').Part[] = [];
    const flush = () => {
        if (summary.length) {
            const task = enqueue(s, '', true);
            task.parts = summary;
            task.actionResult = true;
            summary = [];
        }
    };

    for (const event of values) {
        if (s.web && event.type !== 'finish') { continue; }

        if (event.type === 'intel' || event.type === 'load' || event.type === 'finish') { flush(); }

        if (event.type === 'intel') {
            const member = s.members.find(m => m.id === event.recipient);

            if (member) {
                const task = enqueue(s, event.text, true, member.privateId, event.loadId);
                task.actionResult = true;
                task.parts = [{ ...event.message!, values: { ...event.message!.values, gameId: s.gameId } }];
            }
        } else if (event.type !== 'load' && event.type !== 'finish') {
            summary.push(event.message!);
        } else {
            const task = enqueue(s, event.text, event.type === 'load' || event.type === 'finish', undefined, event.type === 'load' ? event.loadId : undefined);

            if (s.web && event.type === 'finish') {
                task.state = 'PENDING';
                task.critical = false;
            }

            task.parts = [{ ...event.message!, values: { ...event.message!.values, ...(event.type === 'finish' && s.replay?.key ? { replayUrl: replayLink(s.replay.key, s.replay.base) } : {}) } }];
        }
    }

    flush();

    if (s.game!.finished) {
        s.status = 'FINISHED';
        blockClock(s, now);
        settlement(s);
    } else {
        if (s.game!.turn !== oldTurn) {
            s.remainingMs = s.config.values.turnSeconds * 1000;
            s.deadline = undefined;
            s.reminderSent = false;
        }

        if (!s.web && (oldTurn === -1 || s.game!.current !== oldCurrent || values.some(e => e.type === 'load') || !s.game!.players.find(p => p.id === s.game!.current)!.ai)) { enqueue(s, '', true, undefined, undefined, true); }

        blockClock(s, now);
    }
}

export function startGame(s: RoomState, now: number): void {
    beginWebFrame(s, undefined, undefined, now);
    const players = s.members.map(p => ({ id: p.id, name: p.name, ai: false }));

    requireRule(!s.opponents?.length || s.mode === 'multi' && s.stake === 0 && !isPrivateScope(s.groupId) && s.members.length > 0, '人机仅支持多人免费房间');
    players.push(...(s.opponents ?? []).map(p => ({ id: p.id, name: p.name, ai: true })));

    if (s.mode === 'solo') { players.push({ id: 'ai', name: '庄家', ai: true }); }

    if (s.challenge) {
        s.gameRandom = s.challenge.seed.slice(0, 4) as RandomState;
        s.aiRandom = s.challenge.seed.slice(4) as RandomState;
    }

    if (s.mode === 'solo') { s.aiPersonality = PERSONALITIES[s.challenge ? s.challenge.seed[7] % PERSONALITIES.length : secureRandom(PERSONALITIES.length)]; }

    const result = createGame(s.mode, players, roomRandom(s));
    s.game = result.game;
    s.status = 'PLAYING';
    events(s, result.events, -1, now);

    for (const id of s.departures ?? []) {
        if (s.game.finished) { break; }

        const turn = s.game.turn, oldCurrent = s.game.current, removed = applyAction(s.game, id, { type: 'eliminate', target: id }, roomRandom(s));
        s.game = removed.game;
        events(s, removed.events, turn, now, oldCurrent);
    }
}

export function reserve(s: RoomState, now: number): void {
    s.status = 'PREPARING';
    s.reserveAt = now;
    s.reserveUntil = now + 86400000;
    s.money.push({
        id: `${s.gameId}:reserve`, kind: 'reserve', state: 'PENDING', input: {
            source: 'buckshot', operationId: `${s.gameId}:reserve`, referenceId: `buckshot:${s.gameId}`, expiresAtMs: s.reserveUntil,
            reason: moneyReason(s, 'reserve'),
            funds: s.members.map((m, i) => ({ userId: m.id, amountMinor: s.stake, reservationId: `${s.gameId}:r:${i}` }))
        }
    });
}

export function settlement(s: RoomState): void {
    if (s.money.some(t => t.kind === 'settle' || t.kind === 'release' || t.kind === 'credit')) { return; }

    if (s.challenge && s.status !== 'CANCELLED' && s.game?.winner === s.host && s.config.values.dailyReward > 0) {
        const amount = s.config.values.dailyReward;
        s.money.push({
            id: `${s.gameId}:challenge-reward`, kind: 'credit', state: 'PENDING', input: {
                source: 'buckshot', operationId: `${s.gameId}:challenge-reward`, referenceId: `buckshot:${s.gameId}`,
                userId: s.host, amountMinor: amount, reason: moneyReason(s, 'credit', amount)
            }
        });
        s.status = 'SETTLING';

        return;
    }

    if (!s.stake || !s.reserved) { return; }

    if (!s.game?.winner || s.status === 'CANCELLED') {
        s.members.forEach((_, i) => s.money.push({
            id: `${s.gameId}:release:${i}`, kind: 'release', state: 'PENDING', input: {
                source: 'buckshot', operationId: `${s.gameId}:release:${i}`, referenceId: `buckshot:${s.gameId}`, reservationId: `${s.gameId}:r:${i}`,
                reason: moneyReason(s, 'release')
            }
        }));
    } else {
        const winner = s.game.winner, aiWon = winner === 'ai';
        const reward = s.mode === 'solo' && !aiWon ? payout(s.stake, s.config.values.multipliers[s.difficulty]) - s.stake : 0;
        s.money.push({
            id: `${s.gameId}:settle`, kind: 'settle', state: 'PENDING', input: {
                source: 'buckshot', operationId: `${s.gameId}:settle`, referenceId: `buckshot:${s.gameId}`,
                reason: moneyReason(s, 'settle', reward),
                funds: s.members.map((_, i) => ({ reservationId: `${s.gameId}:r:${i}`, payouts: aiWon ? [] : [{ userId: winner, amountMinor: s.stake }], burnMinor: aiWon ? s.stake : 0 })),
                rewards: reward > 0 ? [{ userId: winner, amountMinor: reward }] : []
            }
        });
    }

    s.status = 'SETTLING';
}

export function cancelGame(s: RoomState, now: number): void {
    s.status = 'CANCELLED';
    blockClock(s, now);

    for (const task of s.outbox) {
        task.critical = false;

        if (task.state === 'PENDING') { task.state = 'FAILED'; }
    }

    settlement(s);

    if (s.game) { enqueue(s, '', true).parts = [{ key: 'matchCancelled', values: { ...(s.replay ? { replayUrl: replayLink(s.replay.key, s.replay.base) } : {}) } }]; }
}

function abortWebAdmission(s: RoomState, now: number): void {
    const reserveTask = s.money.find(t => t.kind === 'reserve');

    if (s.status === 'PREPARING' && reserveTask && !['PENDING', 'FAILED'].includes(reserveTask.state)) {
        s.abortRequested = true;
        blockClock(s, now);

        return;
    }

    if (reserveTask?.state === 'PENDING') {
        reserveTask.state = 'FAILED';
        reserveTask.error = 'CANCELLED_BEFORE_DISPATCH';
    }

    cancelGame(s, now);
}

export function mutate(s: RoomState, request: Request, admin: boolean, now: number): void {
    const a = request.action, id = request.actor;
    requireRule(a && ['addAI', 'removeAI', 'join', 'leave', 'ready', 'start', 'confirmClose', 'close', 'confirmQuit', 'quit', 'play', 'pause', 'resume', 'cancel', 'retry', 'removed', 'abort', 'reconcile'].includes(a.type), '操作类型无效');

    if (['pause', 'resume', 'cancel', 'retry', 'removed', 'abort', 'reconcile'].includes(a.type)) { requireRule(admin, '仅管理入口允许此操作'); } else { requireRule(!s.paused && !s.recovery, '房间已暂停或等待恢复'); }

    requireRule(s.status !== 'WAITING' || now < s.createdAt + s.config.values.waitingMinutes * 60000 || admin, '等待房间已到期');
    requireRule(!s.reserved || s.reserveUntil! > now || admin, '本金预留已到期，等待善后');
    const member = s.members.find(p => p.id === id);

    if (a.type === 'addAI' || a.type === 'removeAI') {
        requireRule(s.mode === 'multi' && s.stake === 0 && !isPrivateScope(s.groupId), '人机仅支持多人免费房间');
        requireRule(s.status === 'WAITING' && member && s.host === id, '仅等待中的房主可以管理人机');
        const opponents = s.opponents ?? [];

        if (a.type === 'addAI') {
            requireRule(Number.isInteger(a.difficulty) && a.difficulty >= 0 && a.difficulty <= 4, '难度无效');
            requireRule(s.members.length + opponents.length < 4, '房间已满，真人和人机合计最多4人');
            let number = 1;

            while (opponents.some(p => p.name.startsWith('人机' + number + '（'))) { number++; }

            opponents.push({ id: 'ai:' + crypto.randomUUID(), name: `人机${number}（${DEFAULT_REPLIES['level' + a.difficulty]}）`, difficulty: a.difficulty, personality: PERSONALITIES[secureRandom(PERSONALITIES.length)] });
        } else {
            requireRule(opponents.some(p => p.id === a.target), '该人机已移除，请查看最新面板');
        }

        s.opponents = a.type === 'removeAI' ? opponents.filter(p => p.id !== a.target) : opponents;
        s.members.forEach(p => p.ready = false);
    } else if (a.type === 'join') {
        requireRule(!isPrivateScope(s.groupId), '私聊只支持单人对局');
        requireRule(s.status === 'WAITING' && s.mode !== 'solo' && s.members.length + (s.opponents?.length ?? 0) < (s.mode === 'duo' ? 2 : 4), '当前不能加入');
        requireRule(!member && a.member.id === id && id !== 'ai' && !id.startsWith('ai:'), '已加入或身份不符');
        s.members.push({ ...a.member, name: playerName(a.member.name, s.members) });
        s.members.forEach(p => p.ready = false);
    } else if (s.web && ['WEB_JOINING', 'PREPARING'].includes(s.status) && (a.type === 'leave' || a.type === 'removed')) {
        requireRule(s.members.some(m => m.id === (a.type === 'removed' ? a.target : id)), '玩家不在本局');
        abortWebAdmission(s, now);
    } else if (a.type === 'leave') {
        requireRule(s.status === 'WAITING' && member, '当前不能离开等待房间');
        s.pendingReleases = [...(s.pendingReleases ?? []), { id, claimId: member.claimId ?? s.gameId }];
        s.members = s.members.filter(p => p.id !== id);
        s.members.forEach(p => p.ready = false);
        s.host = s.members[0]?.id ?? '';

        if (!s.host) {
            s.status = 'CANCELLED';
            s.opponents = [];
        }
    } else if (a.type === 'ready') {
        requireRule(s.status === 'WAITING' && member, '当前不能准备');
        member.ready = true;
    } else if (a.type === 'start') {
        requireRule(s.status === 'WAITING' && s.host === id, '仅等待中的房主可以开始');
        requireRule(s.mode === 'solo' || s.members.length > 0 && s.members.length + (s.opponents?.length ?? 0) >= (s.mode === 'duo' ? 2 : 3) && s.members.every(p => p.ready), '人数不足或尚未全部准备');

        requireRule(!s.opponents?.length || s.mode === 'multi' && s.stake === 0, '人机仅支持多人免费房间');

        if (s.web) {
            s.status = 'WEB_JOINING';
            s.web.joiningUntil = now + 120000;
        } else if (s.stake) { reserve(s, now); } else { startGame(s, now); }
    } else if (a.type === 'confirmClose' || a.type === 'close') {
        requireRule((['WAITING', 'WEB_JOINING'].includes(s.status) || s.web && s.status === 'PREPARING') && member && s.host === id, '仅等待中的房主可以关闭房间');

        if (a.type === 'confirmClose') {
            s.closeConfirmation = { actor: id, version: s.version + 1, expires: now + s.config.values.confirmSeconds * 1000 };
        } else {
            requireRule(s.closeConfirmation?.actor === id && s.closeConfirmation.version === s.version && s.closeConfirmation.expires > now, '请重新确认关闭房间');

            if (s.web && s.status === 'PREPARING') { abortWebAdmission(s, now); } else {
                requireRule(!s.reserved && s.money.length === 0, '资金状态待核对，暂不能关闭');
                cancelGame(s, now);
            }

            delete s.closeConfirmation;
        }
    } else if (a.type === 'confirmQuit') {
        requireRule(member && s.status === 'PLAYING', '当前不能认输');
        s.confirmations[id] = { version: s.version + 1, expires: now + s.config.values.confirmSeconds * 1000 };
    } else if (a.type === 'removed' && s.status === 'PREPARING') {
        requireRule(s.members.some(m => m.id === a.target), '玩家不在本局');

        if (s.web) { s.abortRequested = true; } else { s.departures = [...new Set([...(s.departures ?? []), a.target])]; }
    } else if (a.type === 'removed' && s.status === 'WAITING') {
        const departed = s.members.find(m => m.id === a.target);
        requireRule(departed, '玩家已离开');
        s.pendingReleases = [...(s.pendingReleases ?? []), { id: a.target, claimId: departed.claimId ?? s.gameId }];
        s.members = s.members.filter(m => m.id !== a.target);
        s.members.forEach(m => m.ready = false);
        s.host = s.members[0]?.id ?? '';

        if (!s.host) {
            s.status = 'CANCELLED';
            s.opponents = [];
        }
    } else if (a.type === 'quit' || a.type === 'removed') {
        const target = a.type === 'removed' ? a.target : id;

        if (a.type === 'quit') { requireRule(member && s.confirmations[id]?.version === s.version && s.confirmations[id].expires > now, '请重新确认认输'); }

        requireRule(s.status === 'PLAYING' && s.game, '当前不能淘汰玩家');
        beginWebFrame(s, id, { type: 'eliminate', target }, now);
        const oldTurn = s.game.turn, oldCurrent = s.game.current, result = applyAction(s.game, target, { type: 'eliminate', target }, roomRandom(s));
        s.game = result.game;
        events(s, result.events, oldTurn, now, oldCurrent);
        delete s.confirmations[target];
    } else if (a.type === 'play') {
        requireRule(member && s.status === 'PLAYING' && s.game && !s.outbox.some(t => t.critical && t.state !== 'SENT'), '当前不能操作');
        requireRule(a.move.type === 'shoot' || a.move.type === 'item', '操作类型无效');
        requireRule(s.deadline !== undefined && s.deadline > now, '操作时间已到');
        beginWebFrame(s, id, a.move, now);
        const oldTurn = s.game.turn, oldCurrent = s.game.current, result = applyAction(s.game, id, a.move, roomRandom(s));
        s.game = result.game;
        events(s, result.events, oldTurn, now, oldCurrent);
    } else if (a.type === 'pause') {
        requireRule(s.status === 'WAITING' || s.status === 'PLAYING', '当前状态不能暂停');
        blockClock(s, now);
        s.paused = true;
    } else if (a.type === 'resume') {
        requireRule(!s.outbox.some(t => t.critical && (t.state === 'FAILED' || t.state === 'UNKNOWN')) && !s.money.some(t => t.state === 'UNKNOWN' || t.state === 'FAILED'), '请先恢复异常任务');
        s.paused = false;
        s.recovery = false;
        s.reason = undefined;
    } else if (a.type === 'abort' && s.game?.finished) {
        for (const task of s.outbox) {
            task.critical = false;

            if (task.state === 'PENDING') {
                task.state = 'FAILED';
                task.error = 'BOT_REMOVED';
            }
        }

        blockClock(s, now);
    } else if (a.type === 'abort' && s.status === 'PREPARING') {
        s.abortRequested = true;
        s.recovery = true;
        s.reason = '机器人已退群，待预留核对后退回本金';
        blockClock(s, now);
    } else if (a.type === 'cancel' || a.type === 'abort') {
        requireRule(['WAITING', 'WEB_JOINING', 'PREPARING', 'PLAYING'].includes(s.status) && !s.game?.finished, '胜负已固定，不能取消');
        requireRule(!s.money.some(t => t.kind === 'reserve' && t.state !== 'DONE' && t.state !== 'FAILED'), '预留结果未确定');
        cancelGame(s, now);
    } else if (a.type === 'reconcile') {
        const task = s.money.find(t => t.id === a.taskId);
        requireRule(task && (task.state === 'FAILED' || task.state === 'UNKNOWN'), '资金任务当前不能核对');
        task.state = 'UNKNOWN';
        task.retryAt = now;
    } else if (a.type === 'retry') {
        const task = s.outbox.find(t => t.id === a.taskId);
        requireRule(task && (task.state === 'UNKNOWN' || task.state === 'FAILED'), '任务不允许重发');
        task.state = 'PENDING';
        task.plain = a.plain === true;
        task.lease = undefined;
        task.error = undefined;
    }

    s.version++;
    clock(s, now);
}

export function tick(s: RoomState, now: number, immediateAI = false, onAction?: (actor: string, move: Action) => void): void {
    for (const task of s.outbox) {
        if (task.state === 'PENDING' && task.expiresAt !== undefined && task.expiresAt <= now) { task.state = 'FAILED'; }

        if (task.state === 'SENDING' && task.leaseUntil! <= now) {
            task.state = 'UNKNOWN';

            if (task.critical) { s.recovery = true; }
        }
    }

    for (const task of s.money) {
        if (task.state === 'SENDING' && task.leaseUntil! <= now) {
            task.state = 'UNKNOWN';
            s.recovery = true;
        }
    }

    if (s.status === 'WEB_JOINING' && now >= s.web!.joiningUntil!) {
        cancelGame(s, now);
        s.version++;
    }

    if (s.status === 'WAITING' && now >= s.createdAt + s.config.values.waitingMinutes * 60000) {
        s.status = 'CANCELLED';
        s.version++;
    }

    if (s.reserved && s.reserveUntil! <= now && s.status === 'PLAYING') {
        cancelGame(s, now);
        s.version++;
    }

    clock(s, now);

    if (s.status !== 'PLAYING' || s.paused || s.recovery || s.deadline === undefined) { return; }

    const game = s.game!, oldTurn = game.turn, oldCurrent = game.current;

    if (s.deadline <= now) {
        beginWebFrame(s, game.current, { type: 'timeout' }, now);
        const result = applyAction(game, game.current, { type: 'timeout' }, roomRandom(s));
        onAction?.(oldCurrent, { type: 'timeout' });
        s.game = result.game;
        s.version++;
        events(s, result.events, oldTurn, now, oldCurrent);
    } else if (s.aiDue !== undefined && (immediateAI || s.aiDue <= now)) {
        let move;

        const opponent = s.opponents?.find(p => p.id === game.current);

        try { move = chooseAction(observe(game), opponent?.difficulty ?? s.difficulty, roomRandom(s, true), s.challenge ? Infinity : s.config.values.aiBudgetMs, opponent?.personality ?? s.aiPersonality); } catch { move = { type: 'shoot' as const, target: game.players.find(p => p.life > 0 && p.id !== game.current)!.id }; }

        beginWebFrame(s, game.current, move, now);
        const result = applyAction(game, game.current, move, roomRandom(s));
        onAction?.(oldCurrent, move);
        s.game = result.game;
        s.version++;
        events(s, result.events, oldTurn, now, oldCurrent);
    } else if (!s.web && s.config.values.reminderSeconds > 0 && !s.reminderSent && s.deadline - now <= s.config.values.reminderSeconds * 1000) {
        const reminder = enqueue(s, '');
        reminder.expiresAt = s.deadline;
        reminder.parts = [{ key: 'reminder', values: { seconds: String(s.config.values.reminderSeconds) } }];
        s.reminderSent = true;
    }
}

export function pendingTasks(s: RoomState) {
    return s.outbox.filter(t => t.state !== 'SENT').map(({ id, state, private: secret, attempts, kind, error }) => ({ id, state, secret, attempts, kind, ...(error !== undefined ? { error } : {}) }));
}

export function view(s: RoomState) {
    return {
        ...(s.challenge ? { challengeDate: s.challenge.date, dailyReward: s.config.values.dailyReward } : {}), ...(s.aiPersonality ? { aiPersonality: s.aiPersonality } : {}),
        web: !!s.web, webJoiningUntil: s.web?.joiningUntil, webReady: s.web ? Object.values(s.web.access).filter(a => a.session?.ready).length : undefined, gameId: s.gameId, groupId: s.groupId, version: s.version, status: s.status, mode: s.mode, stake: s.stake, difficulty: s.difficulty,
        ...(s.stake && s.mode === 'solo' ? { winReturn: payout(s.stake, s.config.values.multipliers[s.difficulty]) } : {}),
        opponents: (s.opponents ?? []).map(({ id, name, difficulty, personality }) => ({ id, name, difficulty, ...(s.config.values.showAIStyle ? { personality } : {}) })),
        confirmSeconds: s.config.values.confirmSeconds, actionWaiting: s.status === 'PLAYING' && (s.resultUntil ?? 0) > Date.now(),
        reading: s.status === 'PLAYING' && s.outbox.some(t => t.parts?.some(p => p.key === 'load') && t.state !== 'SENT' || t.kind === 'recall' && ['PENDING', 'SENDING'].includes(t.state)), readingSeconds: s.config.values.aiReadSeconds, showAIStyle: s.config.values.showAIStyle === true, recallSeconds: s.config.values.recallSeconds, host: s.host, members: s.members.map(({ id, name, ready, claimId, nameLookupAt }) => ({ id, name, ready, ...(claimId !== undefined ? { claimId } : {}), ...(nameLookupAt !== undefined ? { nameLookupAt } : {}) })), paused: s.paused, recovery: s.recovery,
        ...(s.reason !== undefined ? { reason: s.reason } : {}), ...(s.deadline !== undefined ? { deadline: s.deadline } : {}), remainingMs: s.remainingMs, ...(s.aiReadUntil !== undefined ? { aiReadUntil: s.aiReadUntil } : {}), ...(s.game ? { game: publicGame(s.game) } : {}),
        tasks: pendingTasks(s),
        funds: s.money.map(({ id, kind, state }) => ({ id, kind, state }))
    };
}
