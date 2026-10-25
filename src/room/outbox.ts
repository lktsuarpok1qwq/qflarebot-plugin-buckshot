import { legalActions } from '../game/engine.js';
import { isPrivateScope } from '../conversation.js';
import { playerResult } from '../statistics/model.js';
import { endStatistics } from '../statistics/messages.js';
import { panelReference, renderMessage } from '../templates/send.js';
import { DEFAULT_CONFIGURATION } from '../templates/reply-config.js';
import type { RoomState, Task } from './model.js';
import { canClose } from './schedule.js';
import { view, pendingTasks } from './state.js';

// 在房间原事务内准备投递，不执行存储或外部调用。
export function prepareDelivery(s: RoomState, claim: boolean) {
    const next = s.outbox.find(t => t.state !== 'SENT' && !(!t.critical && (t.state === 'FAILED' || t.state === 'UNKNOWN')));
    let task: Task | null = null;
    const room = view(s);

    if (claim && next?.state === 'PENDING') {
        if (next.panel && !next.snapshot) { next.snapshot = room; }

        if (next.kind === 'message' && !next.payload) {
            const player = s.game?.players.find(p => p.id === s.game?.current);
            const menu = next.panel && s.status === 'PLAYING' && !s.paused && !s.recovery && player && !player.ai;
            next.keep = !!next.panel;
            next.payload = renderMessage(DEFAULT_CONFIGURATION, menu ? 'menu' : next.panel ? 'panel' : next.parts![0].key,
                { room: next.snapshot, parts: next.parts?.some(p => ['finish', 'noWinner'].includes(p.key)) ? [...next.parts, ...endStatistics(s)] : next.parts, mentionCurrent: next.panel && !isPrivateScope(s.groupId), ...(menu ? { actor: player.id, moves: legalActions(s.game!, player.id) } : {}) });
            next.panelOrder = panelReference(next.payload)?.order;
        }

        next.state = 'SENDING';
        next.lease = crypto.randomUUID();
        next.leaseUntil = Date.now() + 60000;
        next.attempts++;
        task = structuredClone(next);
    }

    const closable = canClose(s);

    if (closable && s.statistics) { s.statistics.sealedAt ??= Date.now(); }

    return {
        recallSeconds: s.config.values.recallSeconds, aiReadSeconds: s.config.values.aiReadSeconds, discardPanels: [] as string[], moves: !task && s.game && s.status === 'PLAYING' && !s.paused && !s.recovery && s.deadline !== undefined && s.deadline > Date.now() && !s.game.players.find(p => p.id === s.game?.current)?.ai ? legalActions(s.game) : [],
        gameId: s.gameId, stake: s.stake, mode: s.mode, resumeAt: !task && s.status === 'PLAYING' && !s.paused && !s.recovery ? s.aiReadUntil : undefined, moneyDue: !!s.stake && (s.money.some(t => t.state === 'PENDING' || t.state === 'UNKNOWN' && (t.retryAt ?? 0) <= Date.now()) || s.reserved && s.status === 'PLAYING' && s.reserveUntil! - Date.now() <= 3600000), task,
        release: closable ? s.members.filter(m => !s.released.includes(m.id)).map(m => m.id) : [], closeEmpty: closable && !s.members.length,
        history: closable && s.game && s.replay?.key ? { game: s.gameId, object_key: s.replay.key, mode: s.mode, created: s.createdAt, results: Object.fromEntries(s.members.map(m => [m.id, playerResult(s, m.id)])) } : undefined,
        pendingReleases: s.pendingReleases ?? [], room: task ? { ...room, tasks: pendingTasks(s) } : room
    };
}
