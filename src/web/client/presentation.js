const names = { glass: '放大镜', beer: '啤酒', cigarette: '香烟', saw: '手锯', cuffs: '手铐', jammer: '干扰器', phone: '电话', inverter: '逆转器', medicine: '过期药品', adrenaline: '肾上腺素', remote: '遥控器' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const failedAvatars = new Set();

function seat(id) { return (state.players.length === 2 ? ['bottom', 'top'] : state.players.length === 3 ? ['bottom', 'left', 'right'] : ['bottom', 'left', 'top', 'right'])[(state.players.findIndex(p => p.id === id) - state.players.findIndex(p => p.id === state.self) + state.players.length) % state.players.length]; }

function avatar(p) { return `<span class="player-avatar ${p.ai ? 'bot-avatar' : ''}" aria-hidden="true"><span>${p.life <= 0 ? '💀' : p.ai ? '🤖' : escape([...p.name][0] || '?')}</span>${p.life > 0 && p.avatar && !failedAvatars.has(p.avatar) ? `<img src="${escape(p.avatar)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`; }

function button(text, action, attr = '') { return `<button data-action="${action}" ${attr}>${text}</button>`; }

function candidates() { return selection?.moves ?? state?.moves ?? []; }

function canSelectPlayer(p) { return selection?.kind === 'target' && candidates().some(m => (m.stolenSlot === undefined ? m.target : m.stolenTarget) === p.id); }

function render(effect, load) {
    if (!state) { return; }

    const own = state.players.find(p => p.id === state.self);
    $('#roomName').textContent = '🚪 ' + state.gameId.replaceAll('-', '').slice(0, 8).toUpperCase() + ' · ' + (state.challengeDate ? '每日挑战' : ({ solo: '单人', duo: '双人', multi: '多人' }[state.mode]));
    $('#surrender').hidden = replayMode || state.status !== 'PLAYING' || own.life <= 0;
    $('#surrender').disabled = busy || pending || !!unresolved || !connected || !!selection;
    document.querySelector('.phone').classList.toggle('is-loading', !!load);
    document.querySelector('.phone').classList.toggle('selecting-item', !!selection);

    if (!state.current) {
        screen.innerHTML = `<div class="waitintro"><div class="orbit">${state.players.filter(p => !p.ai && p.ready).length}<span> / ${state.players.filter(p => !p.ai).length}</span></div><h2>${state.status === 'PREPARING' ? '正在冻结本金' : state.terminal ? '房间已关闭' : '等待网页入场'}</h2></div><div class="card">${state.players.map(p => `<div class="waitmember">${avatar(p)}<div class="who name" title="${escape(p.name)}">${escape(p.name)}</div><span>${p.ai ? '' : p.ready ? '✓ 已进入' : '等待进入'}</span></div>`).join('')}</div>${state.status === 'WEB_JOINING' ? '<p class="waiting-note">入场剩余 <span data-time></span></p>' : ''}${state.host && ['WEB_JOINING', 'PREPARING'].includes(state.status) ? button('关闭房间', 'close', 'class="danger full scene-action"') : ''}`;

        return;
    }

    if (!replayMode && state.finished && !effect && !load) {
        const winner = state.players.find(p => p.id === state.winner), stats = state.statistics;
        const money = state.money.length ? state.money.some(t => !['DONE', 'FAILED'].includes(t.state)) ? '积分处理中' : state.money.some(t => t.state === 'FAILED') ? '积分需核对' : '积分已确认' : '免费对局';
        screen.innerHTML = `<div class="winner"><div class="medal">🏆</div><h2>${escape(winner ? winner.name + ' 获胜' : '本局无胜者')}</h2></div><div class="card">${stats ? `<p>对局时间 ${Math.floor(stats.duration / 60000)}分${Math.floor(stats.duration / 1000) % 60}秒</p><div class="stats"><div class="stat"><strong>${stats.shots}</strong><span>开枪次数</span></div><div class="stat"><strong>${stats.items}</strong><span>使用道具</span></div><div class="stat"><strong>${stats.live} / ${stats.blank}</strong><span>实弹 / 空弹</span></div></div>` : ''}<p>${money}</p>${state.challengeDate ? `<p>挑战胜利奖励 ${(state.reward / 100).toFixed(2)} 积分 · 失败不扣分</p>` : ''}</div>${state.replay ? `<a class="primary full scene-action" href="${escape(state.replay)}" target="_blank" rel="noopener noreferrer">查看本局回放</a>` : '<p class="waiting-note">回放正在归档</p>'}`;

        return;
    }

    const enabled = connected && !busy && !pending && !unresolved && !load && !selection && state.moves.length > 0;
    const healthTarget = effect?.kind === 'live' ? effect.target : effect?.hpDelta ? effect.actor : null;
    screen.innerHTML = `<div class="battle-board" data-seats="${state.players.length}"><div class="players">${state.players.map(p => {
        const life = healthTarget === p.id ? effect.lifeBefore : p.life;
        const targetAllowed = selection ? canSelectPlayer(p) : enabled && state.moves.some(m => m.type === 'shoot' && m.target === p.id);

        return `<article data-seat="${seat(p.id)}" data-player="${p.id}" class="card player ${p.id === state.current ? 'active' : ''} ${life <= 0 ? 'dead' : ''} ${p.control && life > 0 ? 'controlled-card' : ''}">${button('', selection ? 'target' : 'shoot', `class="target-hit" data-target="${p.id}" aria-label="${selection ? '选择' : '射击'} ${escape(p.name)}" ${targetAllowed ? '' : 'disabled'}`)}${p.id === state.self && state.current === state.self && life > 0 && state.deadline && !load ? '<span class="card-timer" data-time role="timer"></span>' : ''}<div class="row nameline">${avatar({ ...p, life })}<span class="player-name name" title="${escape(p.name)}">${escape(p.name)}</span></div><div class="life-row"><div class="hearts" data-life="${life}" aria-label="生命 ${life}/4">${Array.from({ length: 4 }, (_, i) => `<span class="heart" data-heart="${i}" aria-hidden="true"><span class="heart-base">${i < life ? '❤️' : '🤍'}</span></span>`).join(' ')}</div>${p.control && life > 0 ? `<span class="control-badge">${itemArt(state.mode === 'solo' ? 'cuffs' : 'jammer')}<span>受控</span></span>` : ''}</div><div class="inventory ${p.id === state.self ? 'own-inventory' : ''}">${(effect?.inventories?.find(v => v.id === p.id)?.items ?? p.items).map((item, i) => {
            const art = itemArt(item) + `<span class="bag-name">${names[item]}</span>`;

            if (p.id === state.self) { return button(art, 'item', `class="inventory-use" data-slot="${i}" aria-label="使用${names[item]}" ${enabled && state.moves.some(m => m.type === 'item' && m.slot === i) ? '' : 'disabled'}`); }

            if (selection?.kind === 'steal' && !busy && selection.moves.some(m => m.target === p.id && m.stolenSlot === i)) { return button(art, 'steal', `class="bag-prop steal-choice" data-owner="${p.id}" data-index="${i}" aria-label="偷取 ${escape(p.name)}的${names[item]}"`); }

            return `<span class="bag-prop" title="${names[item]}">${art}</span>`;
        }).join('')}</div></article>`;
    }).join('')}</div>${battleEffects.table(state.saw)}</div>${load ? `<div class="loading-banner"><div class="loading-label visually-hidden"></div><div class="loading-rack">${Array.from({ length: load.live }, () => '<span class="rack-round live"></span>').join('')}${Array.from({ length: load.blank }, () => '<span class="rack-round blank"></span>').join('')}</div></div>` : ''}`;
    screen.querySelectorAll('[data-seat=left] .inventory,[data-seat=right] .inventory').forEach(el => el.classList.toggle('scrollable', el.scrollHeight > el.clientHeight + 1));
    updateClock();
}

function updateClock() {
    if (!state) { return; }

    const remaining = Math.max(0, Math.ceil((((state.joiningUntil && state.status === 'WEB_JOINING' ? state.joiningUntil : state.deadline) || 0) - (Date.now() + offset)) / 1000));
    document.querySelectorAll('[data-time]').forEach(el => el.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(Math.ceil(remaining) % 60).padStart(2, '0')}`);
}

setInterval(() => { if (!document.hidden) { updateClock(); } }, 250);
document.addEventListener('error', event => {
    const image = event.target;

    if (image instanceof HTMLImageElement) {
        failedAvatars.add(image.src);
        image.remove();
    }
}, true);

async function intel(message, expires, ownEpoch, began, player = state.self) {
    const box = document.createElement('div');
    box.className = 'intel';
    const text = document.createElement('strong');
    text.setAttribute('role', 'status');
    box.append(text);
    screen.append(box);
    const letters = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(message)].map(p => p.segment);
    const elapsed = replayMode ? 0 : Math.max(0, Date.now() + offset - began);
    let at = Math.min(letters.length, Math.floor(elapsed / 85));
    text.textContent = letters.slice(0, at).join('');
    const position = () => {
        const card = screen.querySelector(`[data-player="${player}"]`);

        if (card) { box.style.top = `${Math.max(0, card.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop - box.offsetHeight - 12)}px`; }
    };
    position();
    const delay = replayMode ? 0 : Math.max(0, began - Date.now() - offset);

    if (delay && !await battleEffects.hold(delay)) {
        box.remove();

        return;
    }

    while (at < letters.length && epoch === ownEpoch && (replayMode || Date.now() + offset < expires)) {
        text.textContent += letters[at++];
        position();

        if (!await battleEffects.hold(85)) {
            box.remove();

            return;
        }
    }

    if (epoch === ownEpoch) { await battleEffects.hold(replayMode ? 3000 : Math.max(0, expires - Date.now() - offset)); }

    box.remove();
}

function effectFor(f) {
    if (!f.move) { return null; }

    const target = f.move.stolenTarget || f.move.target || f.actor;
    const old = id => f.before.find(p => p.id === id)?.life, hp = id => state.players.find(p => p.id === id)?.life;
    const shot = f.events.find(e => e.type === 'shot'), eject = f.events.find(e => e.type === 'eject'), info = f.events.find(e => e.type === 'intel');
    const kind = f.move.type === 'shoot' && shot ? shot.shell ? 'live' : 'blank' : 'item';
    const item = f.stolenItem || f.item;

    if (kind === 'item' && !item) { return null; }

    return {
        kind, item, viewer: state.self, actor: f.actor, target: kind === 'item' && !['cuffs', 'jammer'].includes(item) ? undefined : target,
        inventories: f.events.some(e => e.type === 'load') ? f.before.map(p => ({ id: p.id, items: p.items.filter((_, i) => !(f.move.type === 'item' && (p.id === f.actor && i === f.move.slot || f.stolenItem && p.id === f.move.target && i === f.move.stolenSlot))) })) : undefined,
        lifeBefore: old(kind === 'item' ? f.actor : target), lifeAfter: hp(kind === 'item' ? f.actor : target), hpDelta: hp(f.actor) - old(f.actor),
        shell: eject ? eject.shell ? 'live' : 'blank' : info?.intel ? info.intel.shell ? 'live' : 'blank' : undefined,
        stolenFrom: f.stolenItem ? f.move.target : undefined, injected: !replayMode && f.stolenItem && f.actor === state.self, sawed: f.sawed,
        nextTarget: state.nextTarget, direction: state.direction, title: '', detail: ''
    };
}

async function accept(next) {
    if (state && state.gameId === next.gameId && next.version < state.version) { return; }

    const changed = !state || next.version !== state.version;
    state = next;
    offset = next.now - Date.now();

    if (next.error) { notify(next.error); }

    if (changed && selection) {
        selection = null;
        epoch++;
        battleEffects.clear();
        busy = false;
    }

    if (document.hidden && !replayMode) { return; }

    const f = next.frame;

    if (f && f.id > seen) {
        seen = f.id;
        const mine = ++epoch;
        busy = true;
        selection = null;
        const effect = effectFor(f), load = f.events.find(e => e.type === 'load');

        if (effect?.stolenFrom) { effect.stolenOrigin = battleLayout.stealOrigin(effect.stolenFrom, f.move.stolenSlot); }

        render(effect);
        const item = f.stolenItem || f.item;
        const actionMs = f.move?.type === 'shoot' || item === 'beer' ? battleTiming.shot : item === 'glass' ? battleTiming.glass : item === 'phone' ? battleTiming.phone : f.item ? battleTiming.item : 0;
        const elapsed = replayMode ? 0 : Math.max(0, Date.now() + offset - f.at);
        const effectMs = (item === 'phone' ? battleTiming.item : actionMs) + (f.stolenItem ? battleTiming.stolen : 0);

        if (effect && elapsed < effectMs) {
            await battleEffects.play(effect, elapsed);

            if (mine !== epoch) { return; }
        }

        const privateInfo = f.events.find(e => e.type === 'intel');

        if ((f.stolenItem || f.item) === 'phone' && privateInfo && (replayMode || Date.now() + offset < f.until)) {
            await intel(privateInfo.intel ? `第 ${privateInfo.intel.position} 发是${privateInfo.intel.shell ? '实弹' : '空弹'}` : '电话没有提供情报', privateInfo.expires, mine, f.at + battleTiming.item + (f.stolenItem ? battleTiming.stolen : 0), f.actor);

            if (mine !== epoch) { return; }
        }

        if (replayMode) { replayPhase('action'); }

        if (load) {
            render(null, load);
            await battleLoading.run(next.readSeconds * 1000, replayMode ? 0 : Math.max(0, Date.now() + offset - f.at - actionMs - (f.stolenItem ? battleTiming.stolen : 0)));

            if (mine !== epoch) { return; }
        }

        busy = false;

        render();

        return;
    }

    if (!busy && (changed || !document.querySelector('.intel'))) { render(); }
}
