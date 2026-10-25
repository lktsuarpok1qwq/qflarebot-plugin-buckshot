import type { view } from '../room/state.js';

// 只解释本次查询快照，不轮询、不推断资金到账，也不自动重试任何操作。
export function explainRoom(room: ReturnType<typeof view>, now: number) {
    const lines: string[] = [], warnings: string[] = [];
    const names = { credit: '每日挑战奖励', reserve: '冻结下注', settle: '结算', release: '退回本金', renew: '延长冻结' };
    const states = { PENDING: '等待处理', SENDING: '正在处理', DONE: '已处理', FAILED: '处理失败', UNKNOWN: '结果未知' };
    const unresolved = room.funds.filter(t => t.state === 'UNKNOWN' || t.state === 'FAILED');
    const busyFunds = room.funds.filter(t => t.state === 'PENDING' || t.state === 'SENDING');
    const failedMessages = room.tasks.filter(t => t.kind === 'message' && (t.state === 'FAILED' || t.state === 'UNKNOWN'));
    const busyMessages = room.tasks.filter(t => t.kind === 'message' && (t.state === 'PENDING' || t.state === 'SENDING'));
    const current = room.game?.players.find(p => p.id === room.game?.current);
    const remaining = typeof room.deadline === 'number' ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : undefined;
    let title = '等待对局继续';

    if (unresolved.length) {
        title = unresolved.some(t => t.state === 'UNKNOWN') ? '积分结果待核对' : '积分任务失败';
        warnings.push('请核对原资金任务；不要重复扣款或另行补发。');
    } else if (room.status === 'CLOSED') {
        title = '房间已关闭';
    } else if (room.paused) {
        title = '对局已暂停';
    } else if (room.recovery) {
        title = '等待人工核对';
    } else if (busyFunds.length || room.status === 'SETTLING') {
        title = '积分处理中';
        lines.push('正在处理冻结、结算或退款，以原资金任务的确认结果为准。');
    } else if (room.status === 'WAITING') {
        const minimum = room.mode === 'multi' ? 3 : 2;

        if (room.mode === 'solo') {
            title = '正在准备单人对局';
        } else if (room.members.length < minimum) {
            title = '等待玩家加入';
            lines.push('已有 ' + room.members.length + ' 人，至少 ' + minimum + ' 人才能开始。');
        } else {
            const unready = room.members.filter(m => !m.ready);
            title = unready.length ? '等待玩家准备' : '等待房主开始';

            if (unready.length) { lines.push('未准备：' + unready.map(m => m.name).join('、')); }
        }
    } else if (['FINISHED', 'SETTLED', 'CANCELLED'].includes(room.status)) {
        title = room.status === 'CANCELLED' ? '对局已取消，等待收尾' : '对局已结束，等待收尾';
    } else if (typeof room.aiReadUntil === 'number' && room.aiReadUntil > now) {
        title = '装填阅读中';
        lines.push('查询时还剩 ' + Math.ceil((room.aiReadUntil - now) / 1000) + ' 秒；阅读结束后再开始操作计时。');
    } else if (busyMessages.length && remaining === undefined) {
        title = '等待消息发送确认';
        lines.push('本次查询有 ' + busyMessages.length + ' 条消息正在处理。');
    } else if (remaining !== undefined) {
        title = remaining === 0 ? '操作时间已到，等待系统处理' : current?.ai ? '等待庄家行动' : '等待玩家操作';

        if (remaining > 0) { lines.push((current?.name ? '当前：' + current.name + '；' : '') + '查询时还剩 ' + remaining + ' 秒。'); }
    } else if (room.status === 'PREPARING') { title = '正在准备对局'; }

    if (room.paused && title !== '对局已暂停') { lines.push('对局已暂停。'); }

    if (room.recovery) { warnings.push('恢复前请检查资金和消息任务，核对原因后再手动处理。'); }

    if (room.reason) { warnings.push('原因：' + room.reason); }

    for (const task of unresolved) { warnings.push((names[task.kind] || task.kind) + '：' + states[task.state] + '（' + task.id + '）'); }

    if (failedMessages.length) { warnings.push('有 ' + failedMessages.length + ' 条消息失败或结果未知；请先确认是否已送达，再决定是否重发。'); }

    if (room.stake && !unresolved.length) { lines.push('房间状态不代表积分已到账，到账与纠错以 Points 流水为准。'); }

    return { title, lines, warnings };
}

export const roomExplanationStyle = String.raw`
.room-explanation{margin:16px 0;padding:12px;border:1px solid var(--qb-border);border-radius:var(--qb-radius);overflow-wrap:anywhere}.room-explanation p{margin:8px 0}.room-explanation .warning{color:var(--qb-warning-fg,var(--qb-fg))}.room-explanation ul{padding-left:20px;line-height:1.8}.room-raw{margin:16px 0}.room-raw summary{cursor:pointer;padding:8px 0}.room-raw summary:focus-visible{outline:2px solid var(--qb-ring)}@media(pointer:coarse){.room-raw summary{min-height:44px}}
`;
export const roomExplanationScript = 'const explainRoom = ' + explainRoom.toString() + ';\n' + String.raw`
function renderRoomExplanation(room) {
    const explanation = explainRoom(room, Date.now()), box = document.createElement('article'), title = document.createElement('h2');
    box.className = 'room-explanation';
    title.textContent = explanation.title;
    box.append(title);

    for (const text of explanation.lines) {
        const line = document.createElement('p');
        line.textContent = text;
        box.append(line);
    }

    if (explanation.warnings.length) {
        const list = document.createElement('ul');
        list.className = 'warning';

        for (const text of explanation.warnings) {
            const item = document.createElement('li');
            item.textContent = text;
            list.append(item);
        }

        box.append(list);
    }

    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '仅说明本次查询状态；需要最新状态时请手动查询。';
    box.append(note);
    $('roomView').append(box);
}
`;
