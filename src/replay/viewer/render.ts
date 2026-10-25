import { payout } from '../../config.js';
import { formatPoints } from '../../amounts.js';
import { createReplayCodec } from '../codec.js';
import { DEFAULT_REPLIES, formatHearts, formatRoomId } from '../../templates/replies.js';
import { REPLAY_ITEMS } from '../format.js';

const keys = ['dailyReward', 'dailyNoLoss', 'dailyLabel', 'dealerStyle', 'personalitybalanced', 'personalityaggressive', 'personalitycautious', 'personalitytricky', 'panel', 'humanName', 'activeName', 'eliminatedName', 'dealerName', 'member', 'player', 'inventoryItem', 'inventoryEmpty', 'inventorySeparator', 'playerSeparator', 'turn', 'waiting', 'free', 'panelPool', 'panelExpectedPool', 'panelReturn', 'ready', 'notReady', 'controlled', 'target', 'stolen', 'stolenTarget', 'load', 'shot', 'item', 'steal', 'skip', 'eject', 'eliminate', 'timeout', 'timeoutEliminate', 'finish', 'noWinner', 'matchCancelled', 'intel', 'noIntel', 'live', 'blank', ...REPLAY_ITEMS.map(i => 'item' + i)];
const texts = JSON.stringify(Object.fromEntries(keys.map(k => [k, DEFAULT_REPLIES[k]]))).replaceAll('<', '\\u003c');

// 静态展示规则仅打包一份；玩家 JSON 只包含操作事实。
export const replayRender = `const formatRoomId = (${formatRoomId.toString()}); const replayPayout = (${payout.toString()}); const replayFormatPoints = (${formatPoints.toString()}); const formatHearts = (${formatHearts.toString()}); const replayCodec = (${createReplayCodec.toString()})(); const replayTexts = ${texts}; const replayItems = ${JSON.stringify(REPLAY_ITEMS)};` + String.raw`
const replayModes = { solo: '单人', duo: '双人', multi: '多人' };
const replayActions = { create: '创建房间', join: '加入', leave: '离开', ready: '准备', start: '开始对局', shoot: '射击', item: '使用道具', timeout: '操作超时', quit: '认输', removed: '移出对局', pause: '暂停', resume: '继续', cancel: '取消对局', abort: '结束对局' };
const replayStatuses = { WAITING: '等待加入', PREPARING: '准备中', PLAYING: '对局中', FINISHED: '已结束', SETTLING: '结算中', SETTLED: '已结算', CLOSED: '已关闭', CANCELLED: '已取消' };
const replayResultKeys = ['load', 'shot', 'item', 'steal', 'skip', 'eject', 'eliminate', 'timeout', 'timeoutEliminate', 'finish', 'noWinner', 'matchCancelled', 'intel', 'noIntel'];

function replayText(key, values = {}) {
    if (values.gameId !== undefined) { values = { ...values, gameId: formatRoomId(values.gameId) }; }

    return (replayTexts[key] || '').replace(/\{\{([^{}]+)\}\}/g, (_, name) => String(values[name] ?? ''));
}

function replayName(id) { return replayData.players.find(p => p.id === id)?.name || '系统'; }

function replayItem(code) { return replayText('item' + replayItems[code]); }

function replayDisplay(id, state) {
    const player = replayData.players.find(p => p.id === id), p = state.players.find(p => p.p === id);

    return replayText(p?.hp === 0 ? 'eliminatedName' : state.status === 'PLAYING' && state.current === id ? 'activeName' : player?.ai ? 'dealerName' : 'humanName', { name: replayName(id) });
}

function replayActionLabel(action, actor) {
    const item = action.item === undefined ? '' : replayItem(action.item);

    return (actor ? replayName(actor) + ' · ' : '') + (action.type === 'item' ? item || '使用道具' : replayActions[action.type] || action.type) + (action.target ? ' → ' + replayName(action.target) : '');
}

function replayStake(state) {
    const game = replayData.game;

    if (!game.stakeMinor) { return replayText('free'); }

    if (game.mode === 'solo') {
        return replayText('panelReturn', { amount: replayFormatPoints(replayPayout(game.stakeMinor, Math.round(replayData.config.multiplier * 1000))) });
    }

    const count = state.players.filter(p => !replayData.players.find(v => v.id === p.p)?.ai).length;

    return replayText(state.current ? 'panelPool' : 'panelExpectedPool', { amount: replayFormatPoints(game.stakeMinor * count) });
}

function replayPanel(step) {
    const s = step.state, rows = s.players.map(p => {
        const name = replayDisplay(p.p, s);

        return s.current ? replayText('player', { name, hearts: formatHearts(p.hp), control: p.hp > 0 && p.control === 'skip' ? replayText('controlled') : '', inventory: p.items.length ? p.items.map((item, n) => replayText('inventoryItem', { number: n + 1, item: replayItem(item) })).join(replayText('inventorySeparator')) : replayText('inventoryEmpty') }) : replayText('member', { name, ready: replayText(p.ready ? 'ready' : 'notReady') });
    });

    return replayText('panel', { status: replayStatuses[s.status], paused: s.paused ? ' · ⏸️ 暂停' : '', gameId: replayData.game.id, stake: replayData.game.challengeDate ? replayText('dailyLabel', { date: replayData.game.challengeDate }) + (replayData.game.dailyRewardMinor === undefined ? '' : '\n' + replayText('dailyReward', { amount: (replayData.game.dailyRewardMinor / 100).toFixed(2) })) + '\n' + replayText('dailyNoLoss') : replayStake(s), timer: '🎞️ 第 ' + replayPosition + ' 步', items: rows.join(replayText('playerSeparator')), turn: s.current ? replayText('turn', { name: replayName(s.current) }) : replayText('waiting') });
}

function replayResult(result) {
    const values = { gameId: replayData.game.id };

    for (const [key, value] of Object.entries(result.v || {})) { values[key] = Array.isArray(value) ? replayName(value[0]) : value; }

    if (result.k === 'load') {
        values.liveIcons = '🔴'.repeat(Number(values.live));
        values.blankIcons = '⚪'.repeat(Number(values.blank));
        values.seconds = replayData.config?.readSeconds ?? 5;
    }

    if (values.shell !== undefined) { values.shell = replayText(Number(values.shell) ? 'live' : 'blank'); }

    if (values.item !== undefined) { values.item = replayText('item' + values.item); }

    if (result.k === 'item') { values.target = values.target ? replayText('target', { name: values.target }) : ''; }

    return replayText(result.k, values);
}

function renderReplayAmmo() {
    let ammo = [], cursor = 0, load = 0;

    for (const step of replayData.steps.slice(0, replayPosition + 1)) {
        for (const result of step.results || []) {
            if (result.k === 'load') {
                ammo = result.ammo.slice();
                cursor = 0;
                load++;
            } else if (result.k === 'item' && result.v?.item === 'inverter' && cursor < ammo.length) { ammo[cursor] = ammo[cursor] ? 0 : 1; } else if (result.k === 'shot' || result.k === 'eject') {
                if (cursor < ammo.length) { ammo[cursor] = Number(result.v.shell); }

                cursor++;
            }
        }
    }

    const box = $('replayAmmo');
    box.replaceChildren();

    for (const [i, shell] of ammo.entries()) {
        const round = document.createElement('span'), icon = document.createElement('b'), label = document.createElement('span');
        round.className = 'replay-round' + (i < cursor ? ' used' : i === cursor ? ' current' : '');
        icon.textContent = shell ? '🔴' : '⚪';
        label.textContent = (i + 1) + '. ' + (shell ? '实弹' : '空弹');
        round.setAttribute('aria-label', '第 ' + (i + 1) + ' 发' + (shell ? '实弹' : '空弹') + (i < cursor ? '，已使用' : i === cursor ? '，当前' : ''));
        round.append(icon, label);
        box.append(round);
    }

    $('replayAmmoNote').textContent = ammo.length ? '第 ' + load + ' 次装填 · 剩余 ' + ammo.slice(cursor).filter(b => b === 1).length + ' 实弹、' + ammo.slice(cursor).filter(b => b === 0).length + ' 空弹' : '尚未装填';
}

function renderReplay() {
    if (!replayData) { return; }

    const step = replayData.steps[replayPosition], last = replayData.steps.length - 1;
    $('replayProgress').value = String(replayPosition);
    $('replayCount').textContent = '第 ' + replayPosition + ' / ' + last + ' 步' + (step.state.turn ? ' · 第 ' + step.state.turn + ' 回合 · ' + (step.state.direction === -1 ? '反向' : '正向') : '') + (step.state.saw ? ' · 🪚 手锯强化' : '');
    $('replayPrev').disabled = replayPosition === 0;
    $('replayNext').disabled = replayPosition === last;
    syncReplayTimeline();
    $('replayPanel').textContent = replayPanel(step);
    renderReplayAmmo();
    $('replayAction').textContent = replayActionLabel(step.action, step.actor);
    const view = $('replayView').value;
    const visible = (step.results || []).filter(r => view === 'all' || !r.to || r.to === view);
    $('replayResults').textContent = visible.map(r => (r.to ? '【私聊 · ' + replayName(r.to) + '】\n' : '') + replayResult(r)).join('\n') || '该操作没有额外结果';
    const previous = replayData.steps[replayPosition - 1]?.state;
    const health = step.state.players.flatMap(p => {
        const before = previous?.players.find(b => b.p === p.p);

        return before && before.hp !== p.hp ? ['❤️ ' + replayName(p.p) + '：' + before.hp + ' → ' + p.hp] : [];
    });

    if (health.length) { $('replayResults').textContent += '\n' + health.join('\n'); }

    syncReplayHighlight();
    updateReplayLink();
}
`;
