import { configForm } from './config-form.js';

export const page = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tokens.css">
<style>
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--qb-border-strong) transparent}body{margin:0;color:var(--qb-fg);background:var(--qb-bg);font:var(--qb-text-base)/var(--qb-leading) var(--qb-font-sans)}#content{padding:16px;min-width:0}.tabs,.actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}.qb-card{margin-bottom:16px;padding:16px}.row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(160px,1fr);align-items:center;gap:16px;padding:10px 0}#cfg-multipliers{display:grid;gap:8px}#cfg-multipliers label{display:flex;align-items:center;justify-content:space-between;gap:12px}#cfg-multipliers input{max-width:160px}.row input{width:100%;min-width:0}button,input{font:inherit}button,input,select{border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius);background:var(--qb-input);color:var(--qb-fg);padding:7px 12px}button{cursor:pointer;border-radius:var(--qb-radius-full);background:var(--qb-surface)}button[aria-selected=true]{background:var(--qb-primary);color:var(--qb-on-primary)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--qb-ring);outline-offset:2px}h2{font-size:var(--qb-text-lg);margin:0 0 12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--qb-text-sm)/1.7 var(--qb-font-mono);max-height:480px;overflow:auto}input[type=checkbox]{width:22px;height:22px;accent-color:var(--qb-accent)}.hint{color:var(--qb-fg-muted)}.danger{color:var(--qb-danger)}.viewport-probe{position:fixed;inset:0;pointer-events:none;visibility:hidden}dialog{margin:0;position:fixed;top:var(--dialog-top,50%);left:var(--dialog-left,50%);transform:translate(-50%,-50%);max-height:calc(var(--dialog-height,100vh) - 32px);overflow:auto;border:1px solid var(--qb-border);border-radius:var(--qb-radius-xl);background:var(--qb-surface);color:var(--qb-fg);max-width:min(480px,calc(var(--dialog-width,100vw) - 32px));box-shadow:var(--qb-shadow);padding:24px}dialog::backdrop{background:var(--qb-overlay,rgba(0,0,0,.4))}#toasts{position:fixed;top:12px;right:12px;max-width:80vw;z-index:20}.toast{padding:12px;border-radius:var(--qb-radius);background:var(--qb-surface);box-shadow:var(--qb-shadow);margin-bottom:8px}.skeleton{height:72px;border-radius:var(--qb-radius);background:var(--qb-surface-muted)}@media(max-width:600px){.row{grid-template-columns:1fr;gap:6px}button,input{min-height:44px}.qb-card{padding:12px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
</style></head><body class="qb-page"><main id="content">
<nav class="tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="rooms">房间</button><button role="tab" aria-selected="false" data-tab="config" tabindex="-1">游戏配置</button><button role="tab" aria-selected="false" data-tab="points" tabindex="-1">积分与占用</button></nav>
<section id="rooms" role="tabpanel"><div class="qb-card"><div class="actions"><button id="loadRooms">加载房间</button></div><div id="roomList" class="hint">尚未加载</div><div class="actions"><button id="nextRooms" disabled>下一页</button></div><p id="roomObservation" class="hint">索引用于发现房间，详情以房间实际状态为准</p></div>
<div class="qb-card"><div class="actions"><input id="group" aria-label="群 OpenID" placeholder="群 OpenID"><button id="loadRoom">查询详情</button><button id="collapseRoom" disabled>收起</button></div><div id="roomView"></div><div id="roomActions" class="actions"></div><button id="checkRoom" hidden>核对房间操作</button></div></section>
<section id="config" role="tabpanel" hidden><div class="qb-card"><div class="actions"><input id="scope" placeholder="留空为全局；填写群 OpenID" aria-label="配置范围"><button id="loadConfig">加载配置</button></div><p id="configStatus" class="hint">尚未加载</p><form id="configForm" hidden></form><p class="hint">自动撤回默认 10 秒，可设 1～20 秒整数：普通群消息从发送成功起计时，旧面板从新面板发送成功起计时；最新面板和私聊情报保留。房间沿用创建时配置，修改对新房间生效；AI 装填阅读等待仍为 5 秒。</p><p id="configErrors" role="alert" class="danger"></p><div class="actions"><button id="saveConfig" disabled>保存</button><button id="undoConfig" disabled>撤销修改</button><button id="clearConfig" disabled>清除群覆盖</button><button id="checkConfig" hidden>核对保存结果</button></div></div></section>
<section id="points" role="tabpanel" hidden><div class="qb-card"><h2>积分来源</h2><div class="actions"><button id="pointsQuery">查询授权</button><button id="pointsRegister">登记来源</button></div><pre id="pointsResult">尚未查询</pre></div><div class="qb-card"><h2>玩家占用</h2><div class="actions"><input id="userId" placeholder="玩家 OpenID" aria-label="玩家 OpenID"><button id="ownerQuery">查询</button><button id="ownerRepair">修复已关闭房间占用</button></div><pre id="ownerResult">尚未查询</pre></div></section>
</main><div id="toasts" aria-live="polite"></div><dialog id="confirm" aria-labelledby="confirmTitle" aria-describedby="confirmText"><h2 id="confirmTitle">确认操作</h2><p id="confirmText"></p><div class="actions"><button id="cancel">取消</button><button id="accept" class="danger">确认</button></div></dialog>
<script type="module">
import { createBridge } from '/bridge.js';

const bridge = await createBridge(), $ = id => document.getElementById(id);
bridge.setTitle('恶魔轮盘');
new ResizeObserver(() => bridge.resize(Math.ceil($('content').getBoundingClientRect().height))).observe($('content'));
const embedded = window.parent !== window;

if (!embedded) {
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', e => document.documentElement.dataset.theme = e.matches ? 'dark' : 'light');
}

function toast(text, level = 'success') {
    if (embedded) {
        bridge.toast(text, level);

        return;
    }

    const e = document.createElement('div');
    e.className = 'toast';
    e.textContent = text;
    e.onclick = () => e.remove();
    $('toasts').append(e);

    while ($('toasts').children.length > 3) { $('toasts').firstChild.remove(); }

    setTimeout(() => e.remove(), 4500);
}

async function api(path, body) {
    const response = await bridge.fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();

    if (!response.ok) { throw new Error(value.error || '请求未完成'); }

    return value;
}

function restoreFocus(control) {
    if (document.activeElement !== document.body || !control?.isConnected || control.disabled || !control.getClientRects().length) { return; }

    control.focus({ preventScroll: true });
}

let confirmation = false;

async function visibleArea() {
    const probe = document.createElement('div');
    probe.className = 'viewport-probe';
    document.body.append(probe);

    return new Promise(resolve => {
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            probe.remove();
            const rect = entry.intersectionRect, viewport = window.visualViewport;
            const left = Math.max(rect.left, viewport?.offsetLeft || 0), top = Math.max(rect.top, viewport?.offsetTop || 0);
            const right = Math.min(rect.right, viewport ? viewport.offsetLeft + viewport.width : innerWidth);
            const bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight);
            resolve({ left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
        });
        observer.observe(probe);
    });
}

async function confirmAction(text) {
    if (confirmation) { return false; }

    confirmation = true;
    const focus = document.activeElement, dialog = $('confirm');
    let timer, revision = 0;
    const position = area => {
        dialog.style.setProperty('--dialog-top', area.top + area.height / 2 + 'px');
        dialog.style.setProperty('--dialog-left', area.left + area.width / 2 + 'px');
        dialog.style.setProperty('--dialog-height', area.height + 'px');
        dialog.style.setProperty('--dialog-width', area.width + 'px');
    };

    try {
        const area = await visibleArea();

        if (!area.width || !area.height) { return false; }

        position(area);
        $('confirmText').textContent = text;
        dialog.showModal();
        $('cancel').focus({ preventScroll: true });
        // 仅在确认框打开时测量父页裁切；不发业务请求。
        timer = setInterval(async () => {
            const own = ++revision, area = await visibleArea();

            if (dialog.open && own === revision) { position(area); }
        }, 100);

        return await new Promise(resolve => {
            function close(result) {
                dialog.close();
                dialog.oncancel = null;
                dialog.onkeydown = null;
                dialog.onclick = null;
                $('cancel').onclick = null;
                $('accept').onclick = null;

                if (focus?.isConnected && !focus.disabled && focus.getClientRects().length) { focus.focus({ preventScroll: true }); }

                resolve(result);
            }

            dialog.onkeydown = e => {
                if (e.key !== 'Tab') { return; }

                const first = $('cancel'), last = $('accept');

                if (e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    (e.shiftKey ? last : first).focus({ preventScroll: true });
                }
            };
            $('cancel').onclick = () => close(false);
            $('accept').onclick = () => close(true);
            dialog.oncancel = e => {
                e.preventDefault();
                close(false);
            };
            dialog.onclick = e => {
                const rect = dialog.getBoundingClientRect();

                if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) { close(false); }
            };
        });
    } finally {
        revision++;
        clearInterval(timer);
        confirmation = false;
    }
}

let active = 'rooms', epoch = { rooms: 0, config: 0, points: 0 };
const tabs = [...document.querySelectorAll('[data-tab]')];

function tab(name) {
    epoch[active]++;
    active = name;

    for (const t of tabs) {
        const on = t.dataset.tab === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.dataset.tab).hidden = !on;
    }
}

for (const [index, t] of tabs.entries()) {
    t.onclick = () => tab(t.dataset.tab);
    t.onkeydown = e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.click();
            next.focus();
        }
    };
}

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
        $('roomObservation').textContent = '采集：' + new Date(result.observedAt).toLocaleString() + ' · 索引可能不完整，详情以实际状态为准';
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
        && Array.isArray(value.members) && Array.isArray(value.tasks) && Array.isArray(value.funds);
}

function renderRoom(value) {
    room = value;
    $('roomView').replaceChildren();
    $('roomActions').replaceChildren();

    if (!room) {
        $('roomView').textContent = '没有房间';

        return;
    }

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(room, null, 2);
    $('roomView').append(pre);
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

/* BUCKSHOT_CONFIG_FORM */
let pointsBusy = false, ownerBusy = false, ownerEpoch = 0;
$('userId').oninput = () => {
    ownerEpoch++;
    $('ownerResult').textContent = '尚未查询';
};

async function points(action) {
    if (pointsBusy) { return; }

    pointsBusy = true;
    const own = epoch.points, focus = document.activeElement;

    try {
        if (action === 'register' && !await confirmAction('登记 Buckshot 积分来源；登记不会自动获得授权')) { return; }

        for (const id of ['pointsQuery', 'pointsRegister']) { $(id).disabled = true; }

        $('pointsResult').setAttribute('aria-busy', 'true');
        const r = await api('/api/points', { action });

        if (r.ok !== true) { throw new Error(r.message || '积分服务未完成请求'); }

        if (own === epoch.points) {
            $('pointsResult').textContent = JSON.stringify(r, null, 2);
            toast('请求完成');
        }
    } catch (e) { if (own === epoch.points) { toast(e.message, 'error'); } } finally {
        pointsBusy = false;

        for (const id of ['pointsQuery', 'pointsRegister']) { $(id).disabled = false; }

        $('pointsResult').setAttribute('aria-busy', 'false');

        if (own === epoch.points) { restoreFocus(focus); }
    }
}

$('pointsQuery').onclick = () => points('query');
$('pointsRegister').onclick = () => points('register');

async function occupancy(release) {
    if (ownerBusy) { return; }

    const userId = $('userId').value.trim();

    if (!userId) {
        toast('请填写玩家 OpenID', 'error');

        return;
    }

    ownerBusy = true;
    const own = ownerEpoch, feedback = epoch.points, focus = document.activeElement;

    try {
        if (release && !await confirmAction('仅释放已安全关闭房间的残留占用')) { return; }

        for (const id of ['ownerQuery', 'ownerRepair']) { $(id).disabled = true; }

        $('ownerResult').setAttribute('aria-busy', 'true');
        const r = await api('/api/occupancy', { userId, release });

        if (r.userId !== userId || !('owner' in r)) { throw new Error('占用响应无效'); }

        if (own === ownerEpoch) {
            $('ownerResult').textContent = JSON.stringify(r, null, 2);

            if (feedback === epoch.points) { toast('占用已核对'); }
        }
    } catch (e) { if (own === ownerEpoch && feedback === epoch.points) { toast(e.message, 'error'); } } finally {
        ownerBusy = false;

        for (const id of ['ownerQuery', 'ownerRepair']) { $(id).disabled = false; }

        $('ownerResult').setAttribute('aria-busy', 'false');

        if (own === ownerEpoch && feedback === epoch.points) { restoreFocus(focus); }
    }
}

$('ownerQuery').onclick = () => occupancy(false);
$('ownerRepair').onclick = () => occupancy(true);
</script></body></html>`.replace('/* BUCKSHOT_CONFIG_FORM */', () => configForm);
