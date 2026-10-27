import { WEB_TIMING } from '../../web/timing.js';
import { assets } from '../../web/assets.js';

// Use the exact shipped scene assets. No admin bridge or live-game script enters this frame.
const sceneHTML = assets.files['index.html'].body
    .replace(/(src|href)="([^"/]+\.(?:js|css))"/g, '$1="/p/buckshot/play/$2"')
    .replace(/<script src="[^"]*\/play\.[^"]+\.js" defer><\/script>/, `<script src="/p/buckshot/play/${Object.keys(assets.files).find(k => /^replay\.[^.]+\.js$/.test(k))}" defer></script>`);

export const replayBattleScript = `const replayTiming = ${JSON.stringify(WEB_TIMING)}; const replaySceneHTML = ${JSON.stringify(sceneHTML).replaceAll('<', '\\u003c')};` + String.raw`
let sceneReady = false, sceneRequest = 0, scenePending, sceneDone = true;

function sceneSend(message) { $('replayBattle').contentWindow?.postMessage({ type: 'buckshot-replay', ...message }, '*'); }

function sceneTheme() { sceneSend({ action: 'theme', value: document.documentElement.dataset.theme }); }

new MutationObserver(sceneTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
window.addEventListener('message', event => {
    if (event.source !== $('replayBattle').contentWindow || event.data?.type !== 'buckshot-scene') { return; }

    const data = event.data;

    if (data.phase === 'ready') {
        sceneReady = true;
        sceneTheme();

        if (scenePending) { sceneSend(scenePending); }

        return;
    }

    if (data.id !== sceneRequest || !replayData) { return; }

    if (data.phase === 'action') { renderReplayAmmo(true); }

    if (data.phase === 'done' || data.phase === 'error') {
        sceneDone = true;

        if (data.phase === 'error') {
            $('replayResults').hidden = false;
            $('replayResults').textContent = '动画未能播放，可重新选择这一步。';
        }

        renderReplayAmmo(true);
        scheduleReplay();
    }
});

function replayScene(step) {
    const prior = replayData.steps[replayPosition - 1]?.state || step.state;
    const action = step.action, actor = step.actor, view = $('replayView').value;
    const players = step.state.players.map(p => ({ id: p.p, name: replayName(p.p), ai: !!replayData.players.find(h => h.id === p.p)?.ai, life: p.hp, items: p.items.map(i => replayItems[i]), control: p.control === 'skip', ready: true }));
    const before = prior.players.map(p => ({ id: p.p, life: p.hp, items: p.items.map(i => replayItems[i]) }));
    const item = action.type === 'item' ? replayItems[action.item] || before.find(p => p.id === actor)?.items[action.slot] : undefined;
    const stolenItem = item === 'adrenaline' ? before.find(p => p.id === action.target)?.items[action.stolenSlot] : undefined;
    const used = stolenItem || item;
    const actionMs = action.type === 'shoot' || used === 'beer' ? replayTiming.shot : used === 'glass' ? replayTiming.glass : used === 'phone' ? replayTiming.phone : item ? replayTiming.item : 0;
    const events = (step.results || []).flatMap(r => {
        if (r.k === 'load') { return [{ type: 'load', live: r.ammo.filter(b => b === 1).length, blank: r.ammo.filter(b => b === 0).length }]; }

        if (['shot', 'eject'].includes(r.k)) { return [{ type: r.k, shell: Number(r.v.shell) }]; }

        if (['intel', 'noIntel'].includes(r.k) && (view === 'all' || view === r.to)) {
            const info = r.k === 'intel' ? { position: Number(r.v.position), shell: Number(r.v.shell) } : null;
            const text = info ? '第 ' + info.position + ' 发是' + (info.shell ? '实弹' : '空弹') : '电话没有提供情报';

            return [{ type: 'intel', intel: info, expires: (stolenItem ? replayTiming.stolen : 0) + (used === 'phone' ? replayTiming.item + [...text].length * 85 + 3000 : replayTiming.glass) }];
        }

        return [];
    });
    const load = events.find(e => e.type === 'load'), readSeconds = replayData.config?.readSeconds ?? 5;
    const direction = step.state.direction || 1;
    const current = step.state.current || prior.current || players[0]?.id;
    const nextTarget = Array.from({ length: players.length - 1 }, (_, i) => players[(players.findIndex(p => p.id === actor) + direction * (i + 1) + players.length) % players.length]).find(p => p.life > 0)?.id;
    const snapshot = {
        gameId: replayData.game.id, version: 1, mode: replayData.game.mode, status: step.state.status,
        self: players.some(p => p.id === view) ? view : players.find(p => !p.ai)?.id || players[0]?.id,
        players, current, nextTarget, winner: replayData.game.winner, saw: !!step.state.saw, direction,
        moves: [], money: [], readSeconds, challengeDate: replayData.game.challengeDate,
        frame: {
            id: 1, at: 0, until: actionMs + (stolenItem ? replayTiming.stolen : 0) + (load ? readSeconds * 1000 + (load.live + load.blank) * replayTiming.cartridge + replayTiming.loading : 0),
            actor, move: ['shoot', 'item'].includes(action.type) ? action : undefined, item, stolenItem, sawed: !!prior.saw, before, events
        }
    };
    sceneDone = false;
    scenePending = { action: 'step', id: ++sceneRequest, state: snapshot };

    if (sceneReady) { sceneSend(scenePending); } else if (!$('replayBattle').hasAttribute('srcdoc')) { $('replayBattle').srcdoc = replaySceneHTML; }
}
`;
