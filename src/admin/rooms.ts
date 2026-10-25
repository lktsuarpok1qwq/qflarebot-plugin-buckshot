export const roomsScript = String.raw`
let listVersion = 0, listBusy = false, next = null, roomEpoch = 0, room = null, roomBusy = false, pendingRoom = null;

async function list(after) {
    if (listBusy) { return; }

    listBusy = true;
    const own = epoch.rooms, version = listVersion;
    $('roomList').setAttribute('aria-busy', 'true');
    $('loadRooms').disabled = true;
    $('nextRooms').disabled = true;
    $('roomList').className = 'skeleton';

    if (!after) { next = null; }

    try {
        const result = await api('/api/rooms' + (after ? '?after=' + encodeURIComponent(after) : ''));

        if (!Array.isArray(result.items) || !Number.isFinite(result.observedAt) || !(result.next === null || typeof result.next === 'string')) { throw new Error('房间响应无效'); }

        if (own !== epoch.rooms || version !== listVersion) { return; }

        if (result.items.some(item => !item || typeof item.group_id !== 'string' || typeof item.game !== 'string' || typeof item.status !== 'string')) { throw new Error('房间响应无效'); }

        $('roomList').replaceChildren();

        for (const item of result.items) {
            const b = document.createElement('button');
            b.textContent = item.group_id + ' · ' + item.status;
            b.onclick = () => {
                $('group').value = item.group_id;
                invalidateRoom();
            };
            $('roomList').append(b);
        }

        if (!result.items.length) { $('roomList').textContent = '没有活跃房间'; }

        next = result.next;
        $('roomObservation').textContent = '采集（北京时间）：' + new Date(result.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' · 索引可能不完整，详情以实际状态为准';
        $('loadRooms').textContent = '重新加载房间';
        toast('房间已加载');
    } catch (e) { if (own === epoch.rooms && version === listVersion) { toast(e.message, 'error'); } } finally {
        listBusy = false;
        $('roomList').className = '';
        $('roomList').setAttribute('aria-busy', 'false');
        $('loadRooms').disabled = false;
        $('nextRooms').disabled = !next;
    }
}

$('loadRooms').onclick = () => list();
$('nextRooms').onclick = () => list(next);

function roomButtons() {
    $('loadRoom').disabled = roomBusy;
    $('checkRoom').disabled = roomBusy;
    $('roomView').setAttribute('aria-busy', String(roomBusy));
    $('checkRoom').setAttribute('aria-busy', String(roomBusy));

    for (const button of $('roomActions').querySelectorAll('button')) { button.disabled = roomBusy || !!pendingRoom; }
}

function staleList() {
    listVersion++;
    next = null;
    $('nextRooms').disabled = true;
    $('roomObservation').textContent = '房间状态可能已变化，请手动重新加载列表';
}

function invalidateRoom() {
    roomEpoch++;
    room = null;
    $('roomView').replaceChildren();
    $('roomActions').replaceChildren();
    $('collapseRoom').disabled = true;
}

$('group').oninput = invalidateRoom;
$('collapseRoom').onclick = invalidateRoom;

function validRoom(value) {
    if (value === null) { return true; }

    return value && typeof value.gameId === 'string' && Number.isSafeInteger(value.version) && value.version > 0
        && ['WAITING', 'PREPARING', 'PLAYING', 'FINISHED', 'SETTLING', 'SETTLED', 'CANCELLED', 'CLOSED'].includes(value.status)
        && Array.isArray(value.members) && value.members.every(m => m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.ready === 'boolean')
        && Array.isArray(value.tasks) && value.tasks.every(t => t && typeof t.id === 'string' && ['message', 'recall'].includes(t.kind) && ['PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'].includes(t.state))
        && Array.isArray(value.funds) && value.funds.every(t => t && typeof t.id === 'string' && ['reserve', 'settle', 'release', 'renew'].includes(t.kind) && ['PENDING', 'SENDING', 'DONE', 'FAILED', 'UNKNOWN'].includes(t.state))
        && (value.game === undefined || value.game && Array.isArray(value.game.players) && value.game.players.every(p => p && typeof p.id === 'string' && typeof p.name === 'string'));
}

/* BUCKSHOT_ROOM_EXPLANATION_SCRIPT */

function renderRoom(value) {
    room = value;
    $('roomView').replaceChildren();
    $('roomActions').replaceChildren();

    if (!room) {
        $('roomView').textContent = '没有房间';

        return;
    }

    renderRoomExplanation(room);
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    details.className = 'room-raw';
    summary.textContent = '原始详情';
    pre.textContent = JSON.stringify(room, null, 2);
    details.append(summary, pre);
    $('roomView').append(details);
    $('collapseRoom').disabled = false;

    for (const [label, type] of [['暂停', 'pause'], ['恢复', 'resume'], ['取消对局', 'cancel']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => roomAction({ type });
        $('roomActions').append(b);
    }

    for (const task of room.funds || []) {
        if (!['FAILED', 'UNKNOWN'].includes(task.state)) { continue; }

        const button = document.createElement('button');
        button.textContent = '核对资金 ' + task.id;
        button.onclick = () => roomAction({ type: 'reconcile', taskId: task.id });
        $('roomActions').append(button);
    }

    for (const task of room.tasks || []) {
        if (['UNKNOWN', 'FAILED'].includes(task.state)) {
            const b = document.createElement('button');
            b.textContent = '重发 ' + task.id;
            b.onclick = () => roomAction({ type: 'retry', taskId: task.id });
            const plain = document.createElement('button');
            plain.textContent = '文字重发 ' + task.id;
            plain.onclick = () => roomAction({ type: 'retry', taskId: task.id, plain: true });
            $('roomActions').append(plain);
            $('roomActions').append(b);
        }
    }
}

$('loadRoom').onclick = async () => {
    if (roomBusy) { return; }

    const group = $('group').value.trim(), own = ++roomEpoch, feedback = epoch.rooms;

    if (!group) {
        toast('请填写群 OpenID', 'error');

        return;
    }

    roomBusy = true;
    roomButtons();

    try {
        const r = await api('/api/room?group=' + encodeURIComponent(group));

        if (r.group !== group || !validRoom(r.room)) { throw new Error('详情响应无效'); }

        if (own === roomEpoch) {
            renderRoom(r.room);

            if (feedback === epoch.rooms) { toast('详情已加载'); }
        }
    } catch (e) { if (own === roomEpoch && feedback === epoch.rooms) { toast(e.message, 'error'); } } finally {
        roomBusy = false;
        roomButtons();

        if (own === roomEpoch && feedback === epoch.rooms) { restoreFocus($('loadRoom')); }
    }
};

function roomReceipt(r, operation) {
    if (r.group !== operation.group || r.gameId !== operation.command.gameId || r.operationId !== operation.command.actionId
        || !['DONE', 'REJECTED', 'CLOSED'].includes(r.status) || !validRoom(r.room)) { throw new Error('操作回执无效，请核对原请求'); }

    if (r.status !== 'REJECTED') { staleList(); }

    pendingRoom = null;
    $('checkRoom').hidden = true;

    if (operation.epoch === roomEpoch) {
        roomEpoch++;
        renderRoom(r.room);

        if (operation.feedback === epoch.rooms) { toast(r.status === 'REJECTED' ? r.error || '原请求已拒绝' : r.status === 'CLOSED' ? '本局已关闭，无需重试' : '房间操作已确认', r.status === 'REJECTED' ? 'error' : 'success'); }
    }
}

async function roomAction(action) {
    if (roomBusy || pendingRoom || !room) { return; }

    roomBusy = true;
    const snapshot = room, group = $('group').value.trim(), own = roomEpoch, feedback = epoch.rooms;

    try {
        const note = action.type === 'retry' ? '可能重复展示消息；仅重发原任务，不重复游戏效果' : action.type === 'reconcile' ? '按原编号核对资金；不会生成新的扣款或结算编号' : '对房间 ' + snapshot.gameId + ' 执行 ' + action.type;

        if (!await confirmAction(note)) { return; }

        const operation = { group, epoch: own, feedback, command: { gameId: snapshot.gameId, expectedVersion: snapshot.version, actionId: crypto.randomUUID(), action } };
        pendingRoom = operation;
        roomButtons();
        $('checkRoom').hidden = false;
        $('checkRoom').textContent = '核对未决房间操作 · ' + group;
        const r = await api('/api/room', { group, command: operation.command });
        roomReceipt(r, operation);
    } catch (e) {
        if (own === roomEpoch && feedback === epoch.rooms) { toast(e.message, 'error'); }
    } finally {
        roomBusy = false;
        roomButtons();

        if (feedback === epoch.rooms && (own === roomEpoch || own + 1 === roomEpoch && room?.gameId === snapshot.gameId)) { restoreFocus(pendingRoom ? $('checkRoom') : $('loadRoom')); }
    }
}

$('checkRoom').onclick = async () => {
    if (roomBusy || !pendingRoom) { return; }

    roomBusy = true;
    roomButtons();
    const operation = pendingRoom;

    try {
        const params = new URLSearchParams({ group: operation.group, game: operation.command.gameId, id: operation.command.actionId });
        const result = await api('/api/room-operation?' + params);

        if (result.group !== operation.group || result.gameId !== operation.command.gameId || result.operationId !== operation.command.actionId) { throw new Error('查询回执无效'); }

        if (result.status === 'NOT_FOUND') {
            roomReceipt(await api('/api/room', { group: operation.group, command: operation.command }), operation);
        } else { roomReceipt(result, operation); }
    } catch (e) {
        if (operation.epoch === roomEpoch && operation.feedback === epoch.rooms) { toast(e.message, 'error'); }
    } finally {
        roomBusy = false;
        roomButtons();

        if (operation.feedback === epoch.rooms && (operation.epoch === roomEpoch || operation.epoch + 1 === roomEpoch && room?.gameId === operation.command.gameId)) { restoreFocus(pendingRoom ? $('checkRoom') : $('loadRoom')); }
    }
};
`;
