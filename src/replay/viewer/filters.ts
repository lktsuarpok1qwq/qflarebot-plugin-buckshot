import type { ReplayStep } from '../format.js';

// 筛选从已加载的操作事实生成，只导航已有步骤，不重算游戏或发起请求。
export function createReplayFilters(steps: ReplayStep[]) {
    const groups = [
        ['射击与弹药', [['shot', '全部射击'], ['liveShot', '实弹射击'], ['blankShot', '空弹射击'], ['load', '首次装填'], ['reload', '再次装填'], ['beer', '啤酒退弹'], ['inverter', '逆转器']]],
        ['道具与情报', [['item', '全部道具'], ['glass', '放大镜情报'], ['phone', '电话情报'], ['noIntel', '电话无情报']]],
        ['伤害与恢复', [['saw', '手锯'], ['sawDamage', '手锯双倍伤害'], ['selfBlank', '自射空弹'], ['selfLive', '自射实弹'], ['cigarette', '香烟'], ['medicine', '过期药品'], ['medicineHeal', '药品回血'], ['medicineHurt', '药品扣血'], ['heal', '实际回血'], ['lowLife', '仅剩 1 血']]],
        ['偷取与控制', [['adrenaline', '肾上腺素'], ['stealTarget', '偷取并指定目标'], ['deadLoot', '从淘汰玩家偷取'], ['stolenNoIntel', '偷取电话无情报'], ['stolenMedicineHeal', '偷取药品回血'], ['stolenMedicineHurt', '偷取药品扣血'], ['cuffs', '手铐'], ['jammer', '干扰器'], ['control', '跳过受控玩家'], ['remote', '遥控器反向']]],
        ['对局流程', [['start', '开始对局'], ['pause', '暂停'], ['resume', '恢复'], ['timeout', '操作超时'], ['timeoutEliminate', '连续超时淘汰'], ['elimination', '玩家淘汰'], ['finish', '对局结束'], ['abort', '中止对局'], ['quit', '认输'], ['removed', '移出对局']]]
    ] as const;
    const marks = new Map<string, number[]>();
    const items = ['glass', 'beer', 'cigarette', 'saw', 'cuffs', 'jammer', 'phone', 'inverter', 'medicine', 'adrenaline', 'remote'];

    for (const [index, step] of steps.entries()) {
        const mark = (key: string) => {
            const indices = marks.get(key) ?? [];

            if (indices.at(-1) !== index) { indices.push(index); }

            marks.set(key, indices);
        };
        const results = step.results ?? [], action = step.action, before = steps[index - 1]?.state;
        const has = (key: string) => results.some(r => r.k === key);
        const oldActor = before?.players.find(p => p.p === step.actor), actor = step.state.players.find(p => p.p === step.actor);
        const gain = actor && oldActor ? actor.hp - oldActor.hp : 0;

        if (has('load')) { mark(marks.has('load') ? 'reload' : 'load'); }

        if (['start', 'pause', 'resume', 'timeout', 'quit', 'removed'].includes(action.type)) { mark(action.type); }

        if (['cancel', 'abort'].includes(action.type)) { mark('abort'); }

        if (has('finish') || has('noWinner')) { mark('finish'); }

        if (has('skip')) { mark('control'); }

        if (has('timeoutEliminate')) { mark('timeoutEliminate'); }

        if (has('eliminate') || before && step.state.players.some(p => p.hp === 0 && (before.players.find(b => b.p === p.p)?.hp ?? 0) > 0)) { mark('elimination'); }

        if (before && step.state.players.some(p => p.hp === 1 && (before.players.find(b => b.p === p.p)?.hp ?? 0) > 1)) { mark('lowLife'); }

        if (action.type === 'item' && action.item !== undefined) {
            mark('item');
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
            mark('shot');
            mark(Number(shot.v?.shell) === 1 ? 'liveShot' : 'blankShot');

            if (action.target === step.actor) { mark(Number(shot.v?.shell) === 1 ? 'selfLive' : 'selfBlank'); }

            if (before?.saw && Number(shot.v?.shell) === 1) { mark('sawDamage'); }
        }
    }

    return groups.map(([title, entries]) => ({ title, entries: entries.filter(([key]) => marks.has(key)).map(([key, label]) => ({ key, label, indices: marks.get(key)! })) })).filter(group => group.entries.length);
}
