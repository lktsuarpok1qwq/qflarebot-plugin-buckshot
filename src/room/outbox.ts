import { legalActions } from '../game/engine.js';
import { isPrivateScope } from '../conversation.js';
import { playerResult } from '../statistics/model.js';
import { endStatistics } from '../statistics/messages.js';
import { panelReference, renderMessage, keepMessage } from '../templates/send.js';
import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import type { RoomState, Task } from './model.js';
import { canClose } from './schedule.js';
import { view, pendingTasks } from './state.js';

// 在房间原事务内准备投递，不执行存储或外部调用。
export function prepareDelivery(s: RoomState, claim: boolean, deliveryOnly = false) {
    const next = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && (t.state === 'FAILED' || t.state === 'UNKNOWN')));
    let task: Task | null = null;
    let room: ReturnType<typeof view> | undefined;

    const settling = next?.parts?.some(p => ['finish', 'noWinner', 'matchCancelled'].includes(p.key)) && s.money.some(t => ['PENDING', 'SENDING'].includes(t.state));

    if (claim && !settling && next?.state === 'PENDING' && (next.notBefore ?? 0) <= Date.now()) {
        if (next.kind === 'message' && !next.payload) {
            room = view(s);
            const player = s.game?.players.find(p => p.id === s.game?.current);
            const menu = next.panel && s.status === 'PLAYING' && !s.paused && !s.recovery && player && !player.ai;
            next.payload = renderMessage(DEFAULT_CONFIGURATION, menu ? 'menu' : next.panel ? 'panel' : next.parts![0].key,
                { room, scene: next.private || isPrivateScope(s.groupId) ? 'c2c' : 'group', parts: next.parts?.some(p => ['finish', 'noWinner', 'matchCancelled'].includes(p.key)) ? [...next.parts, ...endStatistics(s)] : next.parts?.map(p => p.key === 'load' ? { ...p, values: { ...p.values, seconds: String(s.config.values.aiReadSeconds) } } : p), ...(menu ? { actor: player.id, moves: legalActions(s.game!, player.id) } : {}) });

            if (next.panel) { next.snapshot = { version: room.version, status: room.status }; }

            next.keep = keepMessage(next.payload);
            next.panelOrder = panelReference(next.payload)?.order;
        }

        next.state = 'SENDING';
        next.lease = crypto.randomUUID();
        next.leaseUntil = Date.now() + 60000;
        next.attempts++;
        const { parts, ...delivery } = next;
        task = structuredClone(delivery);
    }

    const closable = canClose(s);

    if (closable && s.statistics) { s.statistics.sealedAt ??= Date.now(); }

    return {
        recallSeconds: s.config.values.recallSeconds, aiReadSeconds: s.config.values.aiReadSeconds, discardPanels: [] as string[], moves: !task && s.game && s.status === 'PLAYING' && !s.paused && !s.recovery && s.deadline !== undefined && s.deadline > Date.now() && !s.game.players.find(p => p.id === s.game?.current)?.ai ? legalActions(s.game) : [],
        gameId: s.gameId, stake: s.stake, mode: s.mode, resumeAt: !task ? next?.notBefore ?? (s.status === 'PLAYING' && !s.paused && !s.recovery ? s.aiReadUntil ?? s.resultUntil ?? s.aiPaceUntil : undefined) : undefined, moneyDue: (s.money.some(t => t.state === 'PENDING' || t.state === 'UNKNOWN' && (t.retryAt ?? 0) <= Date.now()) || s.reserved && s.status === 'PLAYING' && s.reserveUntil! - Date.now() <= 3600000), task,
        release: closable ? s.members.filter(m => !s.released.includes(m.id)).map(m => m.id) : [], closeEmpty: closable && !s.members.length,
        history: closable && s.game && s.replay?.key ? { game: s.gameId, object_key: s.replay.key, mode: s.mode, created: s.createdAt, results: Object.fromEntries(s.members.map(m => [m.id, playerResult(s, m.id)])) } : undefined,
        pendingReleases: s.pendingReleases ?? [], room: deliveryOnly && task && !closable ? null : task ? { ...(room ?? view(s)), tasks: pendingTasks(s) } : room ?? view(s)
    };
}
