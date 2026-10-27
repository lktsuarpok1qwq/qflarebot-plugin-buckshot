import { replayBattleScript } from './battle.js';
import { replayTimelineScript, replayTimelineStyle } from './timeline.js';
import { replayFileScript } from './file.js';
import { replayImportMarkup, replayToolsScript } from './tools.js';
import { replayRender } from './render.js';
import { replayInsightsMarkup, replayInsightsScript, replayInsightsStyle } from './insights.js';

export const replayStyle = replayInsightsStyle + replayTimelineStyle + String.raw`
#replayBattle{display:block;width:100%;height:720px;border:1px solid var(--qb-border);border-radius:var(--qb-radius-lg);background:var(--qb-bg)}.replay-round{min-width:0!important;padding:8px!important}.replay-round.intel-round{outline:2px dashed var(--qb-warning);outline-offset:2px}.replay-round b{display:block;width:16px;height:32px;border-radius:5px 5px 2px 2px;background:linear-gradient(90deg,#71332f,#c56a57,#793830);border-bottom:7px solid #b99a57}.replay-round.blank b{background:linear-gradient(90deg,#6f8b99,#ccdce0,#819ba5)}@media(max-width:600px){#replayBattle{height:740px}.replay-grid{gap:8px}#replayViewer{padding:10px}}.replay-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.replay-heading p{margin:0;min-width:0}.replay-heading button{flex-shrink:0}#replayDrop{padding:12px 16px}#replayDrop .actions{margin:0}#replayDrop .hint{margin:8px 0 0}.replay-file-help{display:none}#replayDrop.expanded .replay-file-help{display:block}@media(max-width:600px){.replay-heading{flex-wrap:wrap}.replay-heading button{margin-left:auto}}#replayShareFallback{width:100%;min-width:0}#replayDrop[aria-busy=true]{opacity:.7}.replay-round{display:inline-flex;flex-direction:column;align-items:center;gap:4px;border:2px solid var(--qb-border);border-radius:var(--qb-radius);padding:10px;margin:4px;min-width:68px}.replay-round.used{opacity:.5}.replay-round.current{border-color:var(--qb-on-primary)}.replay-round b{font-size:24px}.replay-grid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px}.replay-grid>*{min-width:0}#replayTimeline{width:100%}.replay-message{background:var(--qb-surface-muted);padding:14px;border-radius:var(--qb-radius);margin:12px 0;overflow-wrap:anywhere}.replay-message pre{max-height:520px;margin:8px 0;font:inherit;font-size:14px;line-height:1.6}#replaySelect{max-width:100%;min-width:0;flex:1}#replayProgress{display:block;box-sizing:border-box;width:100%;height:44px;min-height:44px;margin:0;padding:0;border:0;border-radius:0;background:transparent;accent-color:var(--qb-primary);cursor:pointer}#replaySummary{overflow-wrap:anywhere}#replay .actions{flex-wrap:wrap}@media(max-width:600px){.replay-grid{grid-template-columns:1fr}#replayTimeline{height:180px}}
`;
export const replayViewerMarkup = String.raw`<div id="replayViewer" class="qb-card" hidden><div class="replay-heading"><p id="replaySummary"></p><button id="retry" hidden>重新加载本局</button></div><!-- BUCKSHOT_REPLAY_INSIGHTS --><div class="actions"><button id="replayPrev">上一步</button><button id="replayPlay">播放</button><button id="replayNext">下一步</button><button id="replayShare" hidden>分享这一步</button><label>每步停留 <select id="replayInterval"><option value="500">0.5 秒</option><option value="1000" selected>1 秒</option><option value="2000">2 秒</option><option value="3000">3 秒</option></select></label></div><p id="replayShareNotice" role="status"></p><input id="replayShareFallback" aria-label="定位链接" readonly hidden><input id="replayProgress" type="range" min="0" max="1" step="1" value="0" aria-label="操作步骤"><p id="replayCount" class="hint"></p><label>视角 <select id="replayView"><option value="all">全部结果</option><option value="public">仅公开信息</option></select></label><div class="replay-grid"><nav id="replayTimeline" aria-label="操作步骤"></nav><div><article class="replay-message"><h3>弹仓</h3><div id="replayAmmo" aria-label="完整子弹类型"></div><p id="replayAmmoNote" class="hint"></p></article><iframe id="replayBattle" title="对局画面" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><p id="replayResults" class="hint" role="status" hidden></p></div></div><p class="hint">按操作播放实际结果。回放包含本局完整弹序和情报，视角仅筛选显示。</p></div>
`.replace('<!-- BUCKSHOT_REPLAY_INSIGHTS -->', () => replayInsightsMarkup);
export const replayPlayerScript = replayFileScript + replayRender + replayTimelineScript + replayBattleScript + String.raw`
let replayEpoch = 0, replayBusy = false, replayData = null, replayPosition = 0, replayTimer = null, replayPlaying = false;

function stopReplay() {
    if (replayTimer !== null) {
        clearTimeout(replayTimer);
        replayTimer = null;
    }

    replayPlaying = false;
    sceneSend({ action: 'pause', value: true });
    $('replayPlay').textContent = '播放';
}

function checkReplay(data) {
    if (!data || data.format !== 'buckshot-replay' || data.version !== 5 || !data.game || typeof data.game.id !== 'string' || !Object.hasOwn(replayModes, data.game.mode) || !Array.isArray(data.players) || data.players.length > 2000 || !Array.isArray(data.steps) || !data.steps.length || data.steps.length > 2000 || !data.integrity || typeof data.integrity.complete !== 'boolean') { throw Error('不支持或不完整的回放格式'); }

    if (new TextEncoder().encode(JSON.stringify(data)).length > 2097152) { throw Error('回放文件过大'); }

    if (typeof data.game.startedAt !== 'string' || !Number.isFinite(Date.parse(data.game.startedAt)) || !['group', 'c2c'].includes(data.game.scene)) { throw Error('回放场次信息无效'); }

    if (data.game.challengeDate !== undefined && (typeof data.game.challengeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.game.challengeDate))) { throw Error('回放挑战信息无效'); }

    if (data.game.dailyRewardMinor !== undefined && (!data.game.challengeDate || !Number.isSafeInteger(data.game.dailyRewardMinor) || data.game.dailyRewardMinor < 0 || data.game.dailyRewardMinor > 1e12)) { throw Error('回放奖励金额无效'); }

    if (data.game.stakeMinor !== undefined && (!Number.isSafeInteger(data.game.stakeMinor) || data.game.stakeMinor < 0 || data.game.stakeMinor > 250000000000)) { throw Error('回放下注金额无效'); }

    if (data.game.stakeMinor && data.game.mode === 'solo' && (!Number.isInteger(Math.round(data.config?.multiplier * 1000)) || data.config.multiplier < 1 || data.config.multiplier > 10)) { throw Error('回放倍率无效'); }

    const ids = new Set();

    for (const p of data.players) {
        if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || ids.has(p.id)) { throw Error('回放玩家无效'); }

        ids.add(p.id);
    }

    if (data.adminAI !== undefined && (!Array.isArray(data.adminAI) || data.adminAI.length > 4 || data.adminAI.some(p => !Array.isArray(p) || p.length !== 2 || !data.players.some(v => v.id === p[0] && v.ai) || !['balanced', 'aggressive', 'cautious', 'tricky'].includes(p[1])) || new Set(data.adminAI.map(p => p[0])).size !== data.adminAI.length)) { throw Error('AI 记录无效'); }

    if (data.game.winner !== undefined && !ids.has(data.game.winner)) { throw Error('回放胜者无效'); }

    const actionValid = a => a && Object.hasOwn(replayActions, a.type) && ['target', 'stolenTarget'].every(k => a[k] === undefined || ids.has(a[k])) && ['slot', 'stolenSlot'].every(k => a[k] === undefined || Number.isInteger(a[k]) && a[k] >= 0 && a[k] < 8) && (a.item === undefined || Number.isInteger(a.item) && a.item >= 0 && a.item < replayItems.length);

    const steps = data.steps.map(replayCodec.decodeStep);

    for (const step of steps) {
        const s = step?.state;

        if (!actionValid(step?.action) || step.actor !== undefined && !ids.has(step.actor) || !s || !Object.hasOwn(replayStatuses, s.status) || !Array.isArray(s.players) || s.players.length > 4 || s.current !== undefined && !ids.has(s.current) || s.players.some(p => !p || !ids.has(p.p) || !Number.isInteger(p.hp) || p.hp < 0 || p.hp > 4 || !Array.isArray(p.items) || p.items.length > 8 || p.items.some(i => !Number.isInteger(i) || i < 0 || i >= replayItems.length))) { throw Error('回放步骤无效'); }

        if ((step.results || []).some(r => (r.k === 'load' || r.ammo !== undefined) && (r.k !== 'load' || !Array.isArray(r.ammo) || r.ammo.length < 2 || r.ammo.length > 8 || r.ammo.some(b => b !== 0 && b !== 1)))) { throw Error('回放弹仓无效'); }

        const members = new Map(s.players.map(p => [p.p, p]));

        if (members.size !== s.players.length || s.current !== undefined && !members.has(s.current) || s.direction !== undefined && ![-1, 1].includes(s.direction) || ['saw', 'paused'].some(k => s[k] !== undefined && typeof s[k] !== 'boolean') || s.players.some(p => p.control !== undefined && !['skip', 'release'].includes(p.control) || p.ready !== undefined && typeof p.ready !== 'boolean')) { throw Error('回放席位无效'); }

        if (step.results !== undefined && (!Array.isArray(step.results) || step.results.length > 100 || step.results.some(r => !r || !replayResultKeys.includes(r.k) || r.to !== undefined && !ids.has(r.to) || r.v !== undefined && (!r.v || typeof r.v !== 'object' || Array.isArray(r.v) || Object.values(r.v).some(v => typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)) && !(Array.isArray(v) && v.length === 1 && ids.has(v[0]))))))) { throw Error('回放结果无效'); }
    }

    return { ...data, steps };
}

function loadReplayData(input, sourceKey = null, position = 0) {
    const data = checkReplay(input), checked = data;
    stopReplay();
    replayData = checked;
    replaySourceKey = sourceKey;
    replayPosition = Math.max(0, Math.min(data.steps.length - 1, Number.isSafeInteger(position) ? position : 0));
    $('replayProgress').max = String(data.steps.length - 1);
    $('replayView').replaceChildren(new Option('全部结果', 'all'), new Option('仅公开信息', 'public'));

    for (const p of data.players) { $('replayView').append(new Option(p.name, p.id)); }

    loadReplayInsights();
    const game = data.game;
    $('replaySummary').textContent = replayModes[game.mode] + (game.mode === 'solo' ? ' · ' + ['新手', '普通', '困难', '专家', '恶魔'][game.difficulty] : '') + ' · ' + formatRoomId(game.id) + ' · ' + (data.integrity.complete ? '记录完整' : '记录不完整：' + data.integrity.reason) + ' · 结果：' + replayInsightResult();
    buildReplayTimeline();
    $('replayViewer').hidden = false;
    renderReplay();
}

function invalidateReplay() {
    replayEpoch++;
    stopReplay();
    sceneRequest++;
    scenePending = null;
    sceneSend({ action: 'clear' });
    replayData = null;
    replaySourceKey = null;
    $('replayLocalNotice').textContent = '';
    $('replayDrop').setAttribute('aria-busy', 'false');
    updateReplayLink();
    replayAnalysis = null;
    replayVisibleHighlights = new Set();
    $('replayViewer').hidden = true;
}

function selectReplay(position) {
    if (!replayData) { return; }

    stopReplay();
    replayPosition = Math.max(0, Math.min(replayData.steps.length - 1, position));
    renderReplay();
}

$('replayProgress').onpointerdown = stopReplay;
$('replayProgress').onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { stopReplay(); }
};
$('replayProgress').oninput = () => selectReplay(Number($('replayProgress').value));

$('replayView').onchange = renderReplay;
$('replayPrev').onclick = () => selectReplay(replayPosition - 1);
$('replayNext').onclick = () => selectReplay(replayPosition + 1);

function scheduleReplay() {
    if (!replayPlaying || !sceneDone || replayTimer !== null) { return; }

    if (replayPosition === replayData.steps.length - 1) {
        stopReplay();

        return;
    }

    replayTimer = setTimeout(() => {
        replayTimer = null;
        replayPosition++;
        renderReplay();
    }, Number($('replayInterval').value));
}

$('replayInterval').onchange = () => {
    if (replayTimer !== null) {
        clearTimeout(replayTimer);
        replayTimer = null;
    }

    scheduleReplay();
};
$('replayPlay').onclick = () => {
    if (!replayData) { return; }

    if (replayPlaying) {
        stopReplay();

        return;
    }

    if (replayPosition === replayData.steps.length - 1 && sceneDone) {
        replayPosition = 0;
        renderReplay();
    }

    replayPlaying = true;
    sceneSend({ action: 'pause', value: false });
    $('replayPlay').textContent = '暂停';
    scheduleReplay();
};
window.addEventListener('pagehide', stopReplay);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopReplay(); } });
` + replayInsightsScript + replayToolsScript;
