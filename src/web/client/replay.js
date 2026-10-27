'use strict';
// Read-only scene: no game API, cookie, WebSocket or replay fetch in this frame.
const replayMode = true;
const $ = selector => document.querySelector(selector), screen = $('#screen');
let state, selection, pending = false, unresolved, connected = false, busy = false;
let epoch = 0, seen = 0, offset = 0, requestId = 0, pausedAt = 0, manualPause = false;
const notify = text => { $('#connection').textContent = text; };
const replayPhase = phase => parent.postMessage({ type: 'buckshot-scene', phase, id: requestId }, '*');

function pauseScene(value) {
    if (value && !pausedAt) { pausedAt = Date.now(); }

    if (!value && pausedAt) {
        offset -= Date.now() - pausedAt;
        pausedAt = 0;
    }

    battleEffects.pause(value);
}

window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.type !== 'buckshot-replay') { return; }

    const data = event.data;

    if (data.action === 'pause') {
        manualPause = !!data.value;
        pauseScene(manualPause || document.hidden);

        return;
    }

    if (data.action === 'theme') {
        document.documentElement.dataset.theme = data.value === 'light' ? 'light' : 'dark';

        return;
    }

    if (data.action === 'clear') {
        epoch++;
        battleEffects.clear();
        state = null;
        screen.replaceChildren();

        return;
    }

    if (data.action !== 'step' || !data.state) { return; }

    epoch++;
    battleEffects.clear();
    manualPause = false;
    pauseScene(document.hidden);
    requestId = data.id;
    const own = requestId;
    seen = 0;
    state = null;
    busy = false;
    // Wall time is only a local playback clock; the recording is operation based.
    const next = data.state, now = Date.now();
    next.now = now;

    if (next.frame) {
        next.frame.at = now;
        next.frame.until += now;

        for (const e of next.frame.events) { if (e.expires !== undefined) { e.expires += now; } }
    }

    try {
        await accept(next);

        if (requestId === own) { replayPhase('done'); }
    } catch (error) {
        if (requestId === own) {
            notify('动画未能播放');
            replayPhase('error');
        }
    }
});
document.addEventListener('visibilitychange', () => pauseScene(manualPause || document.hidden));
$('#theme').hidden = true;
$('#connection').textContent = '回放';
parent.postMessage({ type: 'buckshot-scene', phase: 'ready' }, '*');
