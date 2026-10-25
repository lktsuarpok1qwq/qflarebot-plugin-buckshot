import type { ReplayHeader, ReplayStep } from '../format.js';

// 仅计算已加载的动作和公开状态；不推算积分，不读取记录之外的信息。
export function createReplayInsights(data: ReplayHeader & { steps: ReplayStep[] }) {
    const people = new Map<string, { id: string; shots: number; live: number; blank: number; items: number; damage: number; healing: number }>();
    const highlights: { index: number; kinds: string[]; eliminated: string[] }[] = [];
    const lowLife = new Set<string>();
    let shots = 0, live = 0, blank = 0, loads = 0, ejected = 0, items = 0;
    let started = false, cancelled = false, noWinner = false;
    let previous = new Map<string, number>();

    for (const [index, step] of data.steps.entries()) {
        const state = step.state, kinds: string[] = [], eliminated: string[] = [];

        if (state.current !== undefined) {
            started = true;

            for (const p of state.players) { if (!people.has(p.p)) { people.set(p.p, { id: p.p, shots: 0, live: 0, blank: 0, items: 0, damage: 0, healing: 0 }); } }
        }

        const actor = step.actor ? people.get(step.actor) : undefined;

        for (const result of step.results ?? []) {
            if (result.k === 'load') {
                loads++;
                kinds.push('load');
            }

            if (result.k === 'eject') { ejected++; }

            if (result.k === 'shot') {
                shots++;

                if (actor) { actor.shots++; }

                if (Number(result.v?.shell) === 1) {
                    live++;

                    if (actor) { actor.live++; }
                } else if (Number(result.v?.shell) === 0) {
                    blank++;

                    if (actor) { actor.blank++; }
                }
            }

            if (result.k === 'noWinner') { noWinner = true; }

            if (result.k === 'finish' || result.k === 'noWinner') { kinds.push('finish'); }
        }

        if (step.action.type === 'item') {
            items++;

            if (actor) { actor.items++; }

            kinds.push('item');
        }

        if (step.action.type === 'cancel' || step.action.type === 'abort') {
            cancelled = true;
            kinds.push('finish');
        }

        if (step.action.type === 'shoot' && actor && step.action.target) {
            const target = state.players.find(p => p.p === step.action.target), before = previous.get(step.action.target);

            if (target && before !== undefined) { actor.damage += Math.max(0, before - target.hp); }
        }

        for (const p of state.players) {
            const before = previous.get(p.p);

            if (started && before !== undefined && before > 0 && p.hp === 0) {
                eliminated.push(p.p);
                kinds.push('eliminate');
            }

            if (state.status === 'PLAYING' && p.hp === 1 && state.players.some(other => other.p !== p.p && other.hp > 0)) {
                lowLife.add(p.p);

                if (before !== undefined && before > 1) { kinds.push('danger'); }
            }

            if (step.action.type === 'item' && p.p === step.actor && actor && before !== undefined) { actor.healing += Math.max(0, p.hp - before); }
        }

        if (kinds.length) { highlights.push({ index, kinds: [...new Set(kinds)], eliminated }); }

        previous = new Map(state.players.map(p => [p.p, p.hp]));
    }

    const players = [...people.values()];
    const leaders = (key: 'shots' | 'items' | 'damage') => {
        const count = Math.max(0, ...players.map(p => p[key]));

        return { count, ids: count ? players.filter(p => p[key] === count).map(p => p.id) : [] };
    };
    const winner = data.game.winner;
    const result = winner ? 'winner' : cancelled || !started ? 'cancelled' : noWinner ? 'draw' : 'unknown';

    return { complete: data.integrity.complete, started, result, winner, winnerLowLife: !!winner && lowLife.has(winner), totals: { shots, live, blank, loads, ejected, items }, players, highlights, leaders: { shots: leaders('shots'), items: leaders('items'), damage: leaders('damage') } };
}

export const replayInsightsStyle = String.raw`
.replay-insights{margin:16px 0}.replay-insights summary{cursor:pointer;font-weight:600;padding:8px 0}.replay-insights summary:focus-visible{outline:2px solid var(--qb-ring);outline-offset:2px}.replay-insights ul{padding-left:20px;line-height:1.8;overflow-wrap:anywhere}.replay-insights .actions{margin:10px 0}.replay-insights select{min-width:0;max-width:100%;font:inherit;padding:8px;color:var(--qb-fg);background:var(--qb-input);border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius)}#replayHighlight{flex:1;min-width:160px}.replay-performance{max-width:100%;overflow:auto}.replay-performance table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.replay-performance th,.replay-performance td{padding:10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--qb-border)}.replay-performance th:first-child,.replay-performance td:first-child{text-align:left;white-space:normal;min-width:100px;overflow-wrap:anywhere}@media(pointer:coarse){.replay-insights select,.replay-insights summary{min-height:44px}}
`;
export const replayInsightsMarkup = String.raw`
<div class="replay-insights"><p id="replayInsightsCoverage" class="hint" hidden>记录不完整，以下仅统计已记录的步骤。</p><details><summary>本局小结</summary><ul id="replayInsightsSummary"></ul></details><details><summary>关键操作</summary><div class="actions"><label>筛选 <select id="replayHighlightKind"><option value="">全部</option><option value="load">换弹</option><option value="item">使用道具</option><option value="eliminate">淘汰</option><option value="danger">仅剩 1 血</option><option value="finish">终局</option></select></label><select id="replayHighlight" aria-label="关键操作"></select><button id="replayHighlightJump" disabled>跳转</button></div><p id="replayHighlightNotice" class="hint" role="status"></p></details><details><summary>个人表现</summary><div class="replay-performance"><table><thead><tr><th>玩家</th><th>开枪（实／空）</th><th>道具</th><th>射击伤害</th><th>回血</th></tr></thead><tbody id="replayPerformance"></tbody></table></div><p class="hint">伤害含自伤；回血按实际增加计算，肾上腺素算一次道具操作。</p></details></div>
`;
export const replayInsightsScript = 'const createReplayInsights = ' + createReplayInsights.toString() + ';\n' + String.raw`
let replayAnalysis = null, replayVisibleHighlights = new Set();
const replayHighlightNames = { load: '换弹', item: '使用道具', eliminate: '淘汰', danger: '仅剩 1 血', finish: '终局' };

function replayInsightName(id) {
    const name = replayName(id);

    return replayData.players.filter(p => p.name === name).length > 1 ? name + '（' + id + '）' : name;
}

function replayInsightResult() {
    return replayAnalysis.result === 'winner' ? replayInsightName(replayAnalysis.winner) + ' 获胜' : replayAnalysis.result === 'cancelled' ? '对局已取消' : replayAnalysis.result === 'draw' ? '无胜者' : '结果未记录';
}

function loadReplayInsights() {
    replayAnalysis = createReplayInsights(replayData);
    $('replayInsightsCoverage').hidden = replayAnalysis.complete;
    const t = replayAnalysis.totals, lines = ['结果：' + replayInsightResult()];

    if (replayAnalysis.started) {
        lines.push('开枪 ' + t.shots + ' 发（实弹 ' + t.live + '／空弹 ' + t.blank + '），退弹 ' + t.ejected + ' 发，装填 ' + t.loads + ' 次。');

        for (const [key, title, unit] of [['shots', '开枪最多', '发'], ['items', '道具用得最多', '次'], ['damage', '射击伤害最多', '点']]) {
            const leader = replayAnalysis.leaders[key];

            if (leader.count) { lines.push(title + '：' + leader.ids.map(replayInsightName).join('、') + '（' + (leader.ids.length > 1 ? '各 ' : '') + leader.count + ' ' + unit + '）。'); }
        }

        if (replayAnalysis.winnerLowLife) { lines.push('胜者在对局中曾仅剩 1 血。'); }
    } else { lines.push('本局未开始，没有参赛表现记录。'); }

    $('replayInsightsSummary').replaceChildren(...lines.map(text => {
        const li = document.createElement('li');
        li.textContent = text;

        return li;
    }));
    $('replayPerformance').replaceChildren(...replayAnalysis.players.map(p => {
        const row = document.createElement('tr');

        for (const text of [replayInsightName(p.id), p.shots + '（' + p.live + '／' + p.blank + '）', p.items, p.damage, p.healing]) {
            const td = document.createElement('td');
            td.textContent = String(text);
            row.append(td);
        }

        return row;
    }));
    $('replayHighlightKind').value = '';
    renderReplayHighlights();
}

function renderReplayHighlights() {
    if (!replayAnalysis) { return; }

    const kind = $('replayHighlightKind').value, highlights = replayAnalysis.highlights.filter(h => !kind || h.kinds.includes(kind));
    replayVisibleHighlights = new Set(highlights.map(h => h.index));
    $('replayHighlight').replaceChildren(new Option(highlights.length ? '选择关键操作' : '没有匹配的操作', ''), ...highlights.map(h => {
        const step = replayData.steps[h.index], actor = step.actor ? replayInsightName(step.actor) + ' · ' : '';
        const label = h.kinds.map(k => k === 'eliminate' ? '淘汰 ' + h.eliminated.map(replayInsightName).join('、') : k === 'item' ? replayItem(step.action.item) || '使用道具' : replayHighlightNames[k]).join(' · ');

        return new Option('第 ' + h.index + ' 步 · ' + actor + label, String(h.index));
    }));
    syncReplayHighlight();
}

function syncReplayHighlight() {
    if (!replayAnalysis) { return; }

    $('replayHighlight').value = replayVisibleHighlights.has(replayPosition) ? String(replayPosition) : '';
    $('replayHighlightJump').disabled = $('replayHighlight').value === '';
    $('replayHighlightNotice').textContent = replayVisibleHighlights.size ? '只跳转记录，不执行游戏操作' : '没有匹配的操作';
}

$('replayHighlightKind').onchange = renderReplayHighlights;
$('replayHighlight').onchange = () => { $('replayHighlightJump').disabled = $('replayHighlight').value === ''; };
$('replayHighlightJump').onclick = () => {
    const value = $('replayHighlight').value;

    if (value !== '' && replayVisibleHighlights.has(Number(value))) { selectReplay(Number(value)); }
};
`;
