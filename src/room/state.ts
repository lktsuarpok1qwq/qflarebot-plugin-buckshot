import { DEFAULT_REPLIES, renderTemplate } from '../templates/replies.js';
import { applyAction, createGame, publicGame } from '../game/engine.js';
import { chooseAction, observe } from '../game/ai.js';
import { requireRule, type GameEvent } from '../game/types.js';
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
        text, critical, loadId, panel, state: 'PENDING', attempts: 0
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
    if (s.aiReadUntil !== undefined && s.aiReadUntil <= now) { s.aiReadUntil = undefined; }

    if (s.status !== 'PLAYING' || s.paused || s.recovery || s.aiReadUntil !== undefined || s.outbox.some(t => t.critical && t.state !== 'SENT')) {
        blockClock(s, now);

        return;
    }

    const ai = s.game!.players.find(p => p.id === s.game!.current)!.ai;

    if (s.deadline === undefined) { s.deadline = now + s.remainingMs; }

    if (ai && s.aiDue === undefined) { s.aiDue = now + s.config.values.aiDelaySeconds * 1000; }
}

export function events(s: RoomState, values: GameEvent[], oldTurn: number, now: number, oldCurrent?: string): void {
    let summary: import('../templates/presentation.js').Part[] = [];
    const flush = () => {
        if (summary.length) {
            enqueue(s, '', true).parts = summary;
            summary = [];
        }
    };

    for (const event of values) {
        if (event.type === 'intel' || event.type === 'load' || event.type === 'finish') { flush(); }

        if (event.type === 'intel') {
            const member = s.members.find(m => m.id === event.recipient);

            if (member) {
                const task = enqueue(s, event.text, true, member.privateId, event.loadId);
                task.parts = [{ ...event.message!, values: { ...event.message!.values, gameId: s.gameId } }];
            }
        } else if (event.type !== 'load' && event.type !== 'finish') {
            summary.push(event.message!);
        } else {
            enqueue(s, event.text, event.type === 'load' || event.type === 'finish', undefined, event.type === 'load' ? event.loadId : undefined).parts = [event.message!];
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

        if (oldTurn === -1 || s.game!.current !== oldCurrent) { enqueue(s, '', true, undefined, undefined, true); }

        blockClock(s, now);
    }
}

export function startGame(s: RoomState, now: number): void {
    const players = s.members.map(p => ({ id: p.id, name: p.name, ai: false }));

    if (s.mode === 'solo') { players.push({ id: 'ai', name: '庄家', ai: true }); }

    const result = createGame(s.mode, players);
    s.game = result.game;
    s.status = 'PLAYING';
    events(s, result.events, -1, now);

    for (const id of s.departures ?? []) {
        if (s.game.finished) { break; }

        const turn = s.game.turn, oldCurrent = s.game.current, removed = applyAction(s.game, id, { type: 'eliminate', target: id });
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
            funds: s.members.map((m, i) => ({ userId: m.id, amountMinor: s.stake, reservationId: `${s.gameId}:r:${i}` }))
        }
    });
}

export function settlement(s: RoomState): void {
    if (s.money.some(t => t.kind === 'settle' || t.kind === 'release')) { return; }

    if (!s.stake || !s.reserved) { return; }

    if (!s.game?.winner || s.status === 'CANCELLED') {
        s.members.forEach((_, i) => s.money.push({
            id: `${s.gameId}:release:${i}`, kind: 'release', state: 'PENDING', input: {
                source: 'buckshot', operationId: `${s.gameId}:release:${i}`, referenceId: `buckshot:${s.gameId}`, reservationId: `${s.gameId}:r:${i}`
            }
        }));
    } else {
        const winner = s.game.winner, aiWon = winner === 'ai';
        const reward = s.mode === 'solo' && !aiWon ? payout(s.stake, s.config.values.multipliers[s.difficulty]) - s.stake : 0;
        s.money.push({
            id: `${s.gameId}:settle`, kind: 'settle', state: 'PENDING', input: {
                source: 'buckshot', operationId: `${s.gameId}:settle`, referenceId: `buckshot:${s.gameId}`,
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
}

export function mutate(s: RoomState, request: Request, admin: boolean, now: number): void {
    const a = request.action, id = request.actor;
    requireRule(a && ['join', 'leave', 'ready', 'start', 'confirmQuit', 'quit', 'play', 'pause', 'resume', 'cancel', 'retry', 'removed', 'abort', 'reconcile'].includes(a.type), '操作类型无效');

    if (['pause', 'resume', 'cancel', 'retry', 'removed', 'abort', 'reconcile'].includes(a.type)) { requireRule(admin, '仅管理入口允许此操作'); } else { requireRule(!s.paused && !s.recovery, '房间已暂停或等待恢复'); }

    requireRule(s.status !== 'WAITING' || now < s.createdAt + 600000 || admin, '等待房间已到期');
    requireRule(!s.reserved || s.reserveUntil! > now || admin, '本金预留已到期，等待善后');
    const member = s.members.find(p => p.id === id);

    if (a.type === 'join') {
        requireRule(s.status === 'WAITING' && s.mode !== 'solo' && s.members.length < (s.mode === 'duo' ? 2 : 4), '当前不能加入');
        requireRule(!member && a.member.id === id, '已加入或身份不符');
        s.members.push({ ...a.member, name: playerName(a.member.name, s.members) });
        s.members.forEach(p => p.ready = false);
    } else if (a.type === 'leave') {
        requireRule(s.status === 'WAITING' && member, '当前不能离开等待房间');
        s.pendingReleases = [...(s.pendingReleases ?? []), { id, claimId: member.claimId ?? s.gameId }];
        s.members = s.members.filter(p => p.id !== id);
        s.members.forEach(p => p.ready = false);
        s.host = s.members[0]?.id ?? '';

        if (!s.host) { s.status = 'CANCELLED'; }
    } else if (a.type === 'ready') {
        requireRule(s.status === 'WAITING' && member, '当前不能准备');
        member.ready = true;
    } else if (a.type === 'start') {
        requireRule(s.status === 'WAITING' && s.host === id, '仅等待中的房主可以开始');
        requireRule(s.mode === 'solo' || s.members.length >= (s.mode === 'duo' ? 2 : 3) && s.members.every(p => p.ready), '人数不足或尚未全部准备');

        if (s.stake) { reserve(s, now); } else { startGame(s, now); }
    } else if (a.type === 'confirmQuit') {
        requireRule(member && s.status === 'PLAYING', '当前不能认输');
        s.confirmations[id] = { version: s.version + 1, expires: now + 30000 };
    } else if (a.type === 'removed' && s.status === 'PREPARING') {
        requireRule(s.members.some(m => m.id === a.target), '玩家不在本局');
        s.departures = [...new Set([...(s.departures ?? []), a.target])];
    } else if (a.type === 'removed' && s.status === 'WAITING') {
        const departed = s.members.find(m => m.id === a.target);
        requireRule(departed, '玩家已离开');
        s.pendingReleases = [...(s.pendingReleases ?? []), { id: a.target, claimId: departed.claimId ?? s.gameId }];
        s.members = s.members.filter(m => m.id !== a.target);
        s.members.forEach(m => m.ready = false);
        s.host = s.members[0]?.id ?? '';

        if (!s.host) { s.status = 'CANCELLED'; }
    } else if (a.type === 'quit' || a.type === 'removed') {
        const target = a.type === 'removed' ? a.target : id;

        if (a.type === 'quit') { requireRule(member && s.confirmations[id]?.version === s.version && s.confirmations[id].expires > now, '请重新确认认输'); }

        requireRule(s.status === 'PLAYING' && s.game, '当前不能淘汰玩家');
        const oldTurn = s.game.turn, oldCurrent = s.game.current, result = applyAction(s.game, target, { type: 'eliminate', target });
        s.game = result.game;
        events(s, result.events, oldTurn, now, oldCurrent);
        delete s.confirmations[target];
    } else if (a.type === 'play') {
        requireRule(member && s.status === 'PLAYING' && s.game && !s.outbox.some(t => t.critical && t.state !== 'SENT'), '当前不能操作');
        requireRule(a.move.type === 'shoot' || a.move.type === 'item', '操作类型无效');
        requireRule(s.deadline !== undefined && s.deadline > now, '操作时间已到');
        const oldTurn = s.game.turn, oldCurrent = s.game.current, result = applyAction(s.game, id, a.move);
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
        requireRule(['WAITING', 'PREPARING', 'PLAYING'].includes(s.status) && !s.game?.finished, '胜负已固定，不能取消');
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

export function tick(s: RoomState, now: number, immediateAI = false): void {
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

    if (s.status === 'WAITING' && now >= s.createdAt + 600000) {
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
        const result = applyAction(game, game.current, { type: 'timeout' });
        s.game = result.game;
        s.version++;
        events(s, result.events, oldTurn, now, oldCurrent);
    } else if (s.aiDue !== undefined && (immediateAI || s.aiDue <= now)) {
        let move;

        try { move = chooseAction(observe(game), s.difficulty, undefined, s.config.values.aiBudgetMs); } catch { move = { type: 'shoot' as const, target: game.players.find(p => p.life > 0 && p.id !== game.current)!.id }; }

        const result = applyAction(game, game.current, move);
        s.game = result.game;
        s.version++;
        events(s, result.events, oldTurn, now, oldCurrent);
    } else if (!s.reminderSent && s.deadline - now <= 15000) {
        const reminder = enqueue(s, '操作时间剩余 15 秒');
        reminder.expiresAt = s.deadline;
        reminder.parts = [{ key: 'reminder', values: {} }];
        s.reminderSent = true;
    }
}

export function view(s: RoomState) {
    return {
        gameId: s.gameId, groupId: s.groupId, version: s.version, status: s.status, mode: s.mode, stake: s.stake, difficulty: s.difficulty,
        recallSeconds: s.config.values.recallSeconds, host: s.host, members: s.members.map(({ id, name, ready }) => ({ id, name, ready })), paused: s.paused, recovery: s.recovery,
        ...(s.reason !== undefined ? { reason: s.reason } : {}), ...(s.deadline !== undefined ? { deadline: s.deadline } : {}), remainingMs: s.remainingMs, ...(s.aiReadUntil !== undefined ? { aiReadUntil: s.aiReadUntil } : {}), ...(s.game ? { game: publicGame(s.game) } : {}),
        tasks: s.outbox.filter(t => t.state !== 'SENT').map(({ id, state, private: secret, attempts, kind, error }) => ({ id, state, secret, attempts, kind, ...(error !== undefined ? { error } : {}) })),
        funds: s.money.map(({ id, kind, state }) => ({ id, kind, state }))
    };
}
