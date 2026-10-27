'use strict';
const replayMode = false;
const $ = s => document.querySelector(s), screen = $('#screen');
let ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
history.replaceState(null, '', location.pathname);
let proof, state, socket, selection, busy = false, pending = false, connected = false, epoch = 0, seen = 0, offset = 0, reconnects = 0, retryTimer, toastTimer, readyPending = false, unresolved;
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');

function notify(text) {
    $('#toast').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').hidden = true, 4000);
}

// All game requests use the cookie session; no identity or admin credential is stored by the page.
async function request(kind, data) {
    const response = await fetch('/p/buckshot/api/web/' + kind, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await response.json();

    if (!response.ok) { throw Object.assign(Error(result.error || '暂时无法连接'), { definite: response.status >= 400 && response.status < 500 }); }

    return result;
}

async function resolvePending() {
    if (!unresolved || pending) { return; }

    const data = unresolved;
    pending = true;

    try {
        let result;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                result = await request('action', data);
                break;
            } catch (error) {
                if (error.definite || attempt === 2) { throw error; }

                await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            }
        }

        unresolved = undefined;
        pending = false;
        await accept(result);
    } catch (error) {
        pending = false;

        // A rejected retry cannot prove that an earlier lost response did not commit.
        connected = false;
        notify(error.definite ? error.message : '操作结果待确认，恢复连接后继续核对');
        socket?.close();
        render();
    }
}

async function submit(action) {
    if (pending || unresolved || !connected) { return; }

    unresolved = { id: crypto.randomUUID(), version: state.version, action };
    selection = null;
    await resolvePending();
}

function selectMoves(moves, kind = 'target') {
    if (moves.length === 1) {
        submit({ type: 'play', move: moves[0] });

        return;
    }

    selection = { kind, moves };
    render();
}

function closeDialog() { $('#sheet').close(); }

async function confirm(kind) {
    if (pending || unresolved || !connected) { return; }

    const result = await request('action', { id: crypto.randomUUID(), version: state.version, action: { type: kind === 'close' ? 'confirmClose' : 'confirmQuit' } });
    await accept(result);

    if (result.error) { return; }

    $('#sheetTitle').textContent = kind === 'close' ? '关闭房间？' : '确认认输？';
    $('#sheetBody').innerHTML = `<div class="confirmbuttons">${button('继续对局', 'dismiss')}${button(kind === 'close' ? '关闭房间' : '认输', kind === 'close' ? 'closeConfirmed' : 'quitConfirmed', 'class="destructive"')}</div>`;
    $('#sheet').showModal();
}

let pointerStart, dragged = false;
document.addEventListener('pointerdown', e => {
    pointerStart = { x: e.clientX, y: e.clientY };
    dragged = false;
});
document.addEventListener('pointermove', e => { if (pointerStart && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 10) { dragged = true; } });
document.addEventListener('click', async e => {
    if (dragged) {
        dragged = false;

        return;
    }

    const b = e.target.closest('[data-action]') ?? e.target.closest('[data-player]')?.querySelector('.target-hit');

    if (!b || b.disabled) { return; }

    const type = b.dataset.action;

    if (type === 'dismiss') {
        closeDialog();

        return;
    }

    if (type === 'closeConfirmed' || type === 'quitConfirmed') {
        closeDialog();
        await submit({ type: type === 'closeConfirmed' ? 'close' : 'quit' });

        return;
    }

    if (type === 'close') {
        await confirm('close').catch(e => notify(e.message));

        return;
    }

    if (type === 'steal' && selection?.kind === 'steal') {
        if (busy || pending || !connected) { return; }

        const chosen = selection.moves.filter(m => m.target === b.dataset.owner && m.stolenSlot === Number(b.dataset.index));

        selectMoves(chosen);

        return;
    }

    if (busy || pending || !connected) { return; }

    if (type === 'shoot') {
        await submit({ type: 'play', move: { type: 'shoot', target: b.dataset.target } });

        return;
    }

    if (type === 'target' && selection) {
        const chosen = selection.moves.find(m => (m.stolenSlot === undefined ? m.target : m.stolenTarget) === b.dataset.target);

        if (chosen) { await submit({ type: 'play', move: chosen }); }

        return;
    }

    if (type === 'item') {
        const slot = Number(b.dataset.slot), moves = state.moves.filter(m => m.type === 'item' && m.slot === slot);
        const item = state.players.find(p => p.id === state.self).items[slot];

        if (item !== 'adrenaline') {
            selectMoves(moves);

            return;
        }

        selection = { kind: 'steal', moves };
        const selected = selection, mine = ++epoch;
        busy = true;
        render();
        await battleEffects.play({ kind: 'item', item: 'adrenaline', actor: state.self, viewer: state.self, title: '', detail: '' });

        if (mine !== epoch || selection !== selected) { return; }

        busy = false;

        render();
    }
});
$('#surrender').onclick = () => confirm('quit').catch(e => notify(e.message));
$('#theme').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    $('#theme').textContent = dark ? '☾' : '☀';
};

function connect() {
    clearTimeout(retryTimer);

    if (document.hidden) { return; }

    socket?.close();
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/p/buckshot/api/web/events');
    socket = ws;
    ws.onopen = () => {
        if (socket !== ws) { return; }

        connected = true;
        reconnects = 0;
        $('#connection').textContent = '已连接';
    };
    ws.onmessage = async e => {
        if (socket !== ws) { return; }

        try {
            const next = JSON.parse(e.data);
            await accept(next);

            if (unresolved) { await resolvePending(); }

            if (!next.ready && !next.terminal && !readyPending) {
                readyPending = true;

                try { await accept(await request('ready', {})); } finally { readyPending = false; }
            }
        } catch (error) { notify(error.message); }
    };
    let opened = false;
    ws.addEventListener('open', () => { opened = true; });
    ws.onclose = async e => {
        if (socket !== ws) { return; }

        connected = false;
        $('#connection').textContent = '连接中断';

        if (e.code === 1008) {
            epoch++;
            busy = false;
            selection = null;
            battleEffects.clear();
            battleSound.stop();
            render();
            notify('入口已失效，请私聊重新领取');

            return;
        }

        if (!busy) { render(); }

        if (!opened && !state) {
            try { await accept(await request('state')); } catch (error) {
                notify(error.message);

                if (error.definite) { return; }
            }

            if (socket !== ws) { return; }
        }

        if (state?.terminal || document.hidden) { return; }

        if (reconnects++ < 8) { retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** reconnects)); } else { notify('连接未恢复，请刷新页面'); }
    };
}

$('#enter').onclick = async () => {
    $('#enter').disabled = true;

    try {
        if (ticket) {
            proof ??= random();
            await request('redeem', { ticket, proof });
            ticket = null;
            proof = null;
        }

        connect();
    } catch (error) {
        notify(error.message);
        $('#enter').disabled = false;
    }
};

if (!ticket) { connect(); }

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        epoch++;
        seen = Math.max(0, seen - 1);
        busy = false;
        selection = null;
        battleEffects.clear();
        battleSound.stop();
        socket?.close();
        clearTimeout(retryTimer);
    } else if (state) { connect(); }
});
