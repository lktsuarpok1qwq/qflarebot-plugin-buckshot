import type { ReplayStep } from '../format.js';

// 场景从已加载的操作事实生成，只导航已有步骤，不重算游戏或发起请求。
export function createReplayScenes(steps: ReplayStep[]) {
    const groups = [
        ['弹药与情报', [['load', '首次装填'], ['reload', '再次装填'], ['glass', '放大镜情报'], ['phone', '电话情报'], ['noIntel', '电话无情报'], ['beer', '啤酒退弹'], ['inverter', '逆转器']]],
        ['伤害与恢复', [['saw', '手锯'], ['sawDamage', '手锯双倍伤害'], ['selfBlank', '自射空弹'], ['selfLive', '自射实弹'], ['cigarette', '香烟'], ['medicine', '过期药品'], ['medicineHeal', '药品回血'], ['medicineHurt', '药品扣血'], ['heal', '实际回血'], ['lowLife', '仅剩 1 血']]],
        ['偷取与控制', [['adrenaline', '肾上腺素'], ['stealTarget', '偷取并指定目标'], ['deadLoot', '从淘汰玩家偷取'], ['stolenNoIntel', '偷取电话无情报'], ['stolenMedicineHeal', '偷取药品回血'], ['stolenMedicineHurt', '偷取药品扣血'], ['cuffs', '手铐'], ['jammer', '干扰器'], ['control', '跳过受控玩家'], ['remote', '遥控器反向']]],
        ['对局流程', [['start', '开始对局'], ['pause', '暂停'], ['resume', '恢复'], ['timeout', '操作超时'], ['timeoutEliminate', '连续超时淘汰'], ['elimination', '玩家淘汰'], ['finish', '对局结束'], ['abort', '中止对局']]]
    ] as const;
    const marks = new Map<string, number>();
    const items = ['glass', 'beer', 'cigarette', 'saw', 'cuffs', 'jammer', 'phone', 'inverter', 'medicine', 'adrenaline', 'remote'];

    for (const [index, step] of steps.entries()) {
        const mark = (key: string) => { if (!marks.has(key)) { marks.set(key, index); } };
        const results = step.results ?? [], action = step.action, before = steps[index - 1]?.state;
        const has = (key: string) => results.some(r => r.k === key);
        const oldActor = before?.players.find(p => p.p === step.actor), actor = step.state.players.find(p => p.p === step.actor);
        const gain = actor && oldActor ? actor.hp - oldActor.hp : 0;

        if (has('load')) { mark(marks.has('load') ? 'reload' : 'load'); }

        if (['start', 'pause', 'resume', 'timeout'].includes(action.type)) { mark(action.type); }

        if (['cancel', 'abort'].includes(action.type)) { mark('abort'); }

        if (has('finish') || has('noWinner')) { mark('finish'); }

        if (has('skip')) { mark('control'); }

        if (has('timeoutEliminate')) { mark('timeoutEliminate'); }

        if (has('eliminate') || before && step.state.players.some(p => p.hp === 0 && (before.players.find(b => b.p === p.p)?.hp ?? 0) > 0)) { mark('elimination'); }

        if (before && step.state.players.some(p => p.hp === 1 && (before.players.find(b => b.p === p.p)?.hp ?? 0) > 1)) { mark('lowLife'); }

        if (action.type === 'item' && action.item !== undefined) {
            const item = items[action.item];

            if (item !== 'phone' && item !== 'glass' || has('intel')) { mark(item); }

            if (gain > 0) { mark('heal'); }

            if (item === 'phone' && has('noIntel')) { mark('noIntel'); }

            if (item === 'medicine' && gain !== 0) { mark(gain > 0 ? 'medicineHeal' : 'medicineHurt'); }

            if (item === 'adrenaline') {
                if (action.stolenTarget) { mark('stealTarget'); }

                if (before?.players.find(p => p.p === action.target)?.hp === 0) { mark('deadLoot'); }

                if (has('noIntel')) { mark('stolenNoIntel'); }

                if (results.some(r => r.k === 'steal' && r.v?.item === 'medicine') && gain !== 0) { mark(gain > 0 ? 'stolenMedicineHeal' : 'stolenMedicineHurt'); }
            }
        }

        const shot = results.find(r => r.k === 'shot');

        if (shot) {
            if (action.target === step.actor) { mark(Number(shot.v?.shell) === 1 ? 'selfLive' : 'selfBlank'); }

            if (before?.saw && Number(shot.v?.shell) === 1) { mark('sawDamage'); }
        }
    }

    return groups.map(([title, entries]) => ({ title, entries: entries.filter(([key]) => marks.has(key)).map(([key, label]) => ({ key, label, index: marks.get(key)! })) })).filter(group => group.entries.length);
}

export const replayScenesStyle = String.raw`
.replay-scenes{margin:16px 0}.replay-scenes summary{cursor:pointer;font-weight:600;padding:8px 0}.replay-scenes summary:focus-visible{outline:2px solid var(--qb-ring)}.replay-scenes h3{font-size:14px;margin:12px 0 4px}.replay-scenes .actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}.replay-scenes button{white-space:normal;overflow-wrap:anywhere}@media(pointer:coarse){.replay-scenes button,.replay-scenes summary{min-height:44px}}
`;
export const replayScenesMarkup = '<details id="replayScenes" class="replay-scenes"><summary>场景直达</summary><div id="replaySceneGroups"></div></details>';
export const replayScenesScript = 'const createReplayScenes = ' + createReplayScenes.toString() + ';\n' + String.raw`
function loadReplayScenes() {
    const data = replayData;
    $('replayScenes').open = false;
    $('replaySceneGroups').replaceChildren(...createReplayScenes(data.steps).map(group => {
        const section = document.createElement('section'), title = document.createElement('h3'), actions = document.createElement('div');
        title.textContent = group.title;
        actions.className = 'actions';

        for (const entry of group.entries) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.scene = entry.key;
            button.textContent = entry.label;
            button.onclick = () => { if (replayData === data) { selectReplay(entry.index); } };
            actions.append(button);
        }

        section.append(title, actions);

        return section;
    }));
}
`;
