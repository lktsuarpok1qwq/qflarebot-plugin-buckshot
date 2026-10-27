import { createReplayCodec } from '../codec.js';
import { DEFAULT_REPLIES, formatRoomId } from '../../templates/replies.js';
import { REPLAY_ITEMS } from '../format.js';

const keys = REPLAY_ITEMS.map(i => 'item' + i);
const texts = JSON.stringify(Object.fromEntries(keys.map(k => [k, DEFAULT_REPLIES[k]]))).replaceAll('<', '\\u003c');

// 静态展示规则仅打包一份；玩家 JSON 只包含操作事实。
export const replayRender = `const formatRoomId = (${formatRoomId.toString()}); const replayCodec = (${createReplayCodec.toString()})(); const replayTexts = ${texts}; const replayItems = ${JSON.stringify(REPLAY_ITEMS)};` + String.raw`
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

function replayActionLabel(action, actor) {
    const item = action.item === undefined ? '' : replayItem(action.item);

    return (actor ? replayName(actor) + ' · ' : '') + (action.type === 'item' ? item || '使用道具' : replayActions[action.type] || action.type) + (action.target ? ' → ' + replayName(action.target) : '');
}

function renderReplayAmmo(completed = false) {
    let ammo = [], cursor = 0, load = 0;

    for (const step of replayData.steps.slice(0, replayPosition + (completed ? 1 : 0))) {
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
        const round = document.createElement('span'), icon = document.createElement('b');
        round.className = 'replay-round' + (i < cursor ? ' used' : i === cursor ? ' current' : '');
        icon.setAttribute('aria-hidden', 'true');
        round.classList.toggle('blank', !shell);
        round.setAttribute('aria-label', '第 ' + (i + 1) + ' 发' + (shell ? '实弹' : '空弹') + (i < cursor ? '，已使用' : i === cursor ? '，当前' : ''));
        const info = !completed && replayData.steps[replayPosition].results?.find(r => r.k === 'intel' && ($('replayView').value === 'all' || $('replayView').value === r.to));
        round.classList.toggle('intel-round', !!info && i === cursor + Number(info.v.position) - 1);
        round.append(icon);
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
    renderReplayAmmo();
    replayScene(step);
    const view = $('replayView').value;
    const used = replayItems[step.action.item], stolen = (step.results || []).find(r => r.k === 'steal')?.v?.item;
    const missing = ['phone', 'glass'].includes(stolen || used) && !(step.results || []).some(r => ['intel', 'noIntel'].includes(r.k)) && (view === 'all' || view === step.actor);
    $('replayResults').textContent = missing ? '本次情报未记录' : '';
    $('replayResults').hidden = !missing;

    syncReplayHighlight();
    updateReplayLink();
}
`;
