/* 即时展示不参与游戏计时，所有结果由原型状态先确定。 */
const battleEffects = (() => {
    let animations = [], generation = 0;
    const prop = itemArt;

    function table(sawed = false) {
        return `<div class="battle-table" data-kind="idle"><div class="table-gun ${sawed ? 'sawed' : ''}" aria-hidden="true"><svg viewBox="0 0 100 320">
            <defs>
                <linearGradient id="mvp-steel"><stop stop-color="#151b20"/><stop offset=".25" stop-color="#65727a"/><stop offset=".42" stop-color="#a0acb1"/><stop offset=".56" stop-color="#465159"/><stop offset="1" stop-color="#151b20"/></linearGradient>
                <linearGradient id="mvp-receiver"><stop stop-color="#222b30"/><stop offset=".42" stop-color="#4e5d64"/><stop offset=".55" stop-color="#354248"/><stop offset="1" stop-color="#141b20"/></linearGradient>
                <linearGradient id="mvp-walnut"><stop stop-color="#342018"/><stop offset=".22" stop-color="#79513a"/><stop offset=".48" stop-color="#ad7a50"/><stop offset=".68" stop-color="#704730"/><stop offset="1" stop-color="#352018"/></linearGradient>
                <linearGradient id="mvp-roll-metal" x1="0" x2="1"><stop stop-color="#11191d"/><stop offset=".28" stop-color="#68767d"/><stop offset=".48" stop-color="#b6c1c4"/><stop offset=".68" stop-color="#44525b"/><stop offset="1" stop-color="#1b252b"/></linearGradient>
                <pattern id="mvp-checker" width="4" height="4" patternUnits="userSpaceOnUse"><path d="m0 0 4 4m-2-6 4 4m-6 0 4 4" stroke="#21140e" stroke-opacity=".5" stroke-width=".6"/></pattern>
            </defs>
            <g class="gun-profile">
                <path class="gun-wood" d="M43 216 62 218Q62 234 68 245L85 278Q88 284 85 293L80 307Q67 310 48 299L49 276Q52 257 48 245L40 231Z"/>
                <path class="gun-grain" d="M48 224q6 19 10 30t1 43m-5-69q5 19 10 28t7 41m-10-51q12 25 17 40M54 270l23 24"/>
                <path fill="url(#mvp-checker)" stroke="none" d="M48 229 59 230 67 250 54 258Z"/>
                <path class="gun-rubber" d="M48 296Q67 307 82 303L80 310Q66 313 46 302Z"/>
                <path class="gun-edge" d="M48 299q18 11 33 7"/>
                <rect class="gun-tube" x="44" y="108" width="13" height="94" rx="2"/>
                <rect class="gun-tube" x="60" y="108" width="9" height="83" rx="3"/>
                <path class="gun-rib" d="M40 109h3v81h-3Z"/>
                <path class="gun-highlight" d="M46 111v77m16-76v72"/>
                <g class="barrel-retained"><rect class="gun-tube" x="44" y="69" width="13" height="40"/>
                    <rect class="gun-tube" x="60" y="69" width="9" height="40"/>
                    <path class="gun-rib" d="M40 69h3v40h-3Z"/><path class="gun-highlight" d="M46 70v37"/>
                    <path class="gun-rib-vents" d="M40 79h3m-3 13h3"/>
                    <path class="gun-band" d="M56 78h13v5H56Z"/></g>
                <g class="barrel-tip">
                    <rect class="gun-tube" x="44" y="27" width="13" height="42" rx="1.5"/>
                    <path class="gun-rib" d="M40 29h3v40h-3Z"/>
                    <path class="gun-highlight" d="M46 30v37"/>
                    <path class="gun-rib-vents" d="M40 40h3m-3 13h3m-3 13h3"/>
                    <rect class="gun-band" x="43" y="28" width="15" height="4" rx="1"/>
                    <path class="gun-sight" d="M39 26v-5h3v5Z"/>
                    <rect class="gun-tube" x="60" y="54" width="9" height="15" rx="3"/>
                </g>
                <g class="gun-pump"><path class="gun-wood" d="M42 130q13-5 28 0l1 48q-12 7-30 1Z"/>
                <path class="gun-pump-ribs" d="M43 138q11 4 25 0m-25 7q11 4 25 0m-25 7q11 4 25 0m-25 7q11 4 25 0m-25 7q11 4 25 0m-25 7q11 4 25 0"/>
                <path class="gun-highlight" d="M44 133v43"/></g>
                <path class="gun-body" d="M40 183 65 183 70 197 68 224Q54 231 39 221Z"/>
                <path class="gun-edge" d="M42 186h20l5 11v23m-25 0h21"/>
                <rect class="gun-port" x="47" y="190" width="14" height="21" rx="2"/>
                <path class="gun-bolt" d="M50 192h9v16h-9Z"/>
                <path class="gun-highlight" d="M51 194v11"/>
                <circle class="gun-screw" cx="44" cy="216" r="2"/><path class="gun-screw-slot" d="m43 215 2 2"/>
                <circle class="gun-screw" cx="62" cy="218" r="2"/><path class="gun-screw-slot" d="m61 217 2 2"/>
                <path class="gun-trigger-guard" d="M68 204C87 203 90 227 70 231L68 227C82 226 83 210 68 209Z"/>
                <path class="gun-trigger" d="M69 210q9 1 7 10l-3 2q3-6-4-8Z"/>
                <circle class="trigger-axis" cx="50" cy="218" r="1" fill="none" stroke="none"/><circle class="trigger-reference" cx="78" cy="218" r="1" fill="none" stroke="none"/>
                <path class="cut-edge" d="M43 69h15m2 0h9"/>
                <g class="muzzle-position"><circle class="muzzle-tip" cx="50" cy="27" r="1" fill="none" stroke="none"/><path class="muzzle" d="m50 27-9-14 7 3 2-17 4 16 9-9-4 16 12-3-14 13Z"/></g>
            </g>
            <g class="gun-roll" aria-hidden="true">
                <path d="M37 226 59 222 70 250 77 301Q62 313 39 300L44 260Z" fill="url(#mvp-walnut)" stroke="#30231b"/>
                <path d="m59 226 11 29 7 46-8 6-8-55-9-24Z" fill="#39271c" opacity=".7"/>
                <path d="M39 297q19 12 38 3l-1 9q-20 10-38-4Z" class="gun-rubber"/>
                <path d="m45 233 6 24-5 39m7-61 9 58" class="gun-grain"/>
                <g class="roll-tip"><rect x="43" y="27" width="17" height="42" rx="5" fill="url(#mvp-roll-metal)" stroke="#253138"/><ellipse cx="51.5" cy="29" rx="8.5" ry="2.5" fill="#152027" stroke="#87949b"/></g>
                <rect x="43" y="69" width="17" height="120" rx="4" fill="url(#mvp-roll-metal)" stroke="#253138"/>
                <rect x="59" y="70" width="9" height="115" rx="4" fill="url(#mvp-roll-metal)"/>
                <path d="M37 132Q50 124 67 130l2 47q-17 9-34 2Z" fill="url(#mvp-walnut)" stroke="#3a281d"/>
                <path d="m39 138q12 4 26-2m-27 10q12 4 28-2m-28 10q12 4 28-2m-29 10q13 4 29-2m-29 10q13 4 30-2" class="gun-pump-ribs"/>
                <path d="M35 185 59 182 70 191 68 225 45 232 33 222Z" fill="url(#mvp-roll-metal)" stroke="#17252d"/>
                <path d="m59 185 8 8-1 29-8 5Z" fill="#15252e"/>
                <path d="m39 191 16-3v27l-15 6Z" fill="#122027" stroke="#9aa8af"/>
                <path d="m42 194 9-2v20l-9 4Z" fill="#53626b"/>
                <path d="m59 225 3 15q14 2 13-14l-7-9" fill="none" stroke="#697880" stroke-width="4"/>
                <path d="m38 187 19-3m-21 6v28m8 11 18-6" class="gun-edge"/>
            </g>
            <g class="gun-underside">
                <path class="gun-wood" d="M39 226h22l7 76q-18 11-36 0Z"/>
                <path class="gun-grain" d="m43 231-5 66m12-65v70m7-70 6 67"/>
                <path class="gun-rubber" d="M32 299q18 8 36 0v9q-18 8-36 0Z"/>
                <g class="underside-tip"><rect class="gun-tube" x="43" y="27" width="14" height="42" rx="2"/><path class="gun-highlight" d="M46 29v40"/></g>
                <rect class="gun-tube" x="43" y="69" width="14" height="118"/><path class="gun-highlight" d="M46 69v111"/>
                <rect class="gun-wood" x="34" y="130" width="32" height="51" rx="6"/>
                <path class="gun-pump-ribs" d="M36 138h28m-28 8h28m-28 8h28m-28 8h28m-28 8h28"/>
                <rect class="gun-body" x="33" y="183" width="34" height="47" rx="6"/>
                <path class="gun-edge" d="M36 187v35m28-35v35"/>
                <rect class="loading-port" x="40" y="189" width="20" height="31" rx="5" fill="#080d10" stroke="#879399" stroke-width="1.5"/>
                <g class="chamber-shell" aria-hidden="true"><rect x="43" y="191" width="14" height="25" rx="3" fill="var(--round-color)"/><path d="M45 194v15m4-15v15m4-15v15" stroke="#ffffff40"/><path d="M43 211h14v5H43z" fill="var(--shell-brass)"/><path class="chamber-cap" d="M43 191h14v4H43z" fill="var(--shell-cap)"/></g>
                <g class="loading-gate"><path d="M41 191q9-3 18 0v25q-9 5-18 0Z" fill="url(#mvp-steel)" stroke="#273238"/><path d="M45 194v18m10-18v18" stroke="#a1b0b5" stroke-width=".7"/></g>
                <circle class="gun-screw" cx="36" cy="224" r="1.5"/><circle class="gun-screw" cx="64" cy="224" r="1.5"/>
                <path d="M42 229v15q8 8 16 0v-15" fill="none" stroke="#76848a" stroke-width="4"/>
                <path d="M50 230v10" stroke="#b0b9bc" stroke-width="2"/>
            </g>
        </svg></div><div class="prop-stage" hidden></div><div class="table-caption" role="status" aria-live="polite"><strong></strong><span></span></div></div>`;
    }

    async function rollGun(gun, underside, zoom, duration) {
        const own = generation, start = Number(gun.dataset.viewZoom || 1);
        gun.classList.add('rolling-view');
        const profile = gun.querySelector('.gun-profile'), bottom = gun.querySelector('.gun-underside');
        // 用有厚度的斜侧面过渡，不再把整把枪压成薄片。
        move(underside ? profile : bottom, [{ opacity: 1 }, { opacity: 0, offset: .45 }, { opacity: 0 }], duration);
        move(gun.querySelector('.gun-roll'), [{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: 1, offset: .6 }, { opacity: 0 }], duration);
        move(underside ? bottom : profile, [{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], duration);
        const result = await move(gun, [
            { transform: `scale(${start}) rotate(0deg)` },
            { transform: `scale(${(start + zoom) / 2}) rotate(${underside ? -4 : 4}deg)`, offset: .5 },
            { transform: `scale(${zoom}) rotate(0deg)` }
        ], duration).finished.then(() => true, () => false);

        if (!result || own !== generation) { return false; }

        gun.classList.toggle('underside-view', underside);
        gun.classList.remove('rolling-view');
        gun.dataset.viewZoom = String(zoom);

        return true;
    }

    async function openUnderside(gun, inspect = false, elapsed = 0) {
        const skip = elapsed || seekOffset;
        gun.classList.toggle('inspecting', inspect);
        const zoom = inspect ? battleLayout.inspectZoom(gun) : 1;
        gun.dataset.inspectZoom = String(zoom);

        if (!await seeking(skip, () => rollGun(gun, true, zoom, 550))) { return false; }

        return seeking(Math.max(0, skip - 550), () => move(gun.querySelector('.loading-gate'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)' }], 300)).finished.then(() => true, () => false);
    }

    async function closeUnderside(gun, elapsed = 0) {
        const skip = elapsed || seekOffset;

        if (!await seeking(skip, () => move(gun.querySelector('.loading-gate'), [{ transform: 'scaleY(.08)' }, { transform: 'scaleY(1)' }], 250)).finished.then(() => true, () => false)) { return false; }

        if (!await seeking(Math.max(0, skip - 250), () => rollGun(gun, false, 1, 450))) { return false; }

        gun.classList.remove('inspecting');

        return true;
    }

    function shorten(gun) {
        gun.classList.remove('sawed');
        const tip = gun.querySelector('.barrel-tip');

        later(() => {
            move(tip, [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(27px,18px) rotate(20deg)', opacity: 1, offset: .5 }, { transform: 'translate(48px,62px) rotate(42deg)', opacity: 0 }], 550);
            gun.classList.add('sawed');
            tip.style.visibility = 'visible';
            later(() => { tip.style.visibility = ''; }, 560);
        }, 700);
    }

    let seekOffset = 0, paused = false;

    function seeking(value, fn) {
        const old = seekOffset;
        seekOffset = value;

        try { return fn(); } finally { seekOffset = old; }
    }

    function later(fn, ms) {
        const own = generation, offset = seekOffset;
        hold(ms).then(ok => { if (ok && own === generation) { seeking(Math.max(0, offset - ms), fn); } });
    }

    function clear() {
        generation++;
        animations.forEach(a => a.cancel());
        animations = [];
        battleSound.stop();
        document.querySelectorAll('.shell-feedback').forEach(el => el.remove());
        document.querySelector('.effect-layer')?.remove();
        document.querySelectorAll('.hit-card,.healed-card').forEach(el => el.classList.remove('hit-card', 'healed-card'));
    }

    function move(el, frames, duration = 650) {
        if (!el) { return; }

        const animation = el.animate(frames, { duration, easing: 'ease-out', fill: 'both' });
        animations.push(animation);

        if (seekOffset) { animation.currentTime = Math.min(duration, seekOffset); }

        if (document.hidden || paused) { animation.pause(); }

        return animation;
    }

    function layer() {
        let el = document.querySelector('.effect-layer');

        if (!el) {
            el = document.createElement('div');
            el.className = 'effect-layer';
            el.setAttribute('aria-hidden', 'true');
            document.querySelector('.phone').append(el);
        }

        return el;
    }

    function coordinate(el) {
        const r = el.getBoundingClientRect(), root = document.querySelector('.phone').getBoundingClientRect();

        return { x: r.left - root.left + r.width / 2, y: r.top - root.top + r.height / 2 };
    }

    function animateHealth(target, before, after) {
        const card = document.querySelector(`[data-player="${target}"]`), hearts = card?.querySelector('.hearts');

        if (!hearts || before === undefined || after === undefined) { return; }

        hearts.dataset.life = String(after);
        hearts.setAttribute('aria-label', `生命 ${after}/4`);
        hearts.querySelectorAll('.heart').forEach((slot, index) => {
            slot.querySelector('.heart-base').textContent = index < after ? '❤️' : '🤍';

            if (index >= after && index < before) {
                const fragment = document.createElement('span');
                fragment.className = 'heart-fragment';
                fragment.textContent = '💔';
                slot.append(fragment);
                move(fragment, [{ transform: 'scale(1.3)', opacity: 1 }, { transform: 'translateY(-4px) rotate(-12deg) scale(1.1)', opacity: 1, offset: .3 }, { transform: 'translateY(13px) rotate(18deg) scale(.65)', opacity: 0 }], 520).finished.then(() => fragment.remove(), () => fragment.remove());
            } else if (index >= before && index < after) {
                const base = slot.querySelector('.heart-base');
                base.textContent = '🤍';
                const fill = document.createElement('span');
                fill.className = 'heart-restored';
                fill.textContent = '❤️';
                const glow = document.createElement('i');
                glow.className = 'heart-glow';
                slot.append(glow, fill);
                move(glow, [{ transform: 'scale(.5)', opacity: .9 }, { transform: 'scale(1.7)', opacity: 0 }], 650).finished.then(() => glow.remove(), () => glow.remove());
                move(fill, [{ clipPath: 'inset(100% 0 0)', transform: 'scale(.75)', opacity: .3 }, { clipPath: 'inset(0)', transform: 'scale(1.25)', opacity: 1, offset: .55 }, { clipPath: 'inset(0)', transform: 'scale(1)', opacity: 1 }], 650).finished.then(() => {
                    base.textContent = '❤️';
                    fill.remove();
                }, () => fill.remove());
            }
        });

        if (after <= 0) {
            card.classList.add('dead');

            const avatar = card.querySelector('.player-avatar');
            if (avatar) { avatar.replaceChildren(Object.assign(document.createElement('span'), { textContent: '💀' })); }
        }
    }

    function mark(target, amount, self) {
        const card = document.querySelector(`[data-player="${target}"]`);

        if (!card) { return; }

        card.classList.add('hit-card');
        later(() => card.classList.remove('hit-card'), 1500);
        const pos = coordinate(card), overlay = layer();
        const number = document.createElement('div');
        number.className = 'impact-number';
        number.textContent = `−${amount}`;
        number.style.cssText = `left:${pos.x - 15}px;top:${pos.y - 5}px`;
        overlay.append(number);
        move(number, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(-12px)', offset: .3 }, { opacity: 0, transform: 'translateY(-40px)' }], 1100);
        move(card, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)', offset: .2 }, { transform: 'translateX(4px)', offset: .4 }, { transform: 'translateX(-2px)', offset: .6 }, { transform: 'translateX(0)' }], 380);

        if (self) {
            const wash = document.createElement('div');
            wash.className = 'hit-wash';
            overlay.append(wash);
            move(wash, [{ opacity: 0 }, { opacity: .8, offset: .25 }, { opacity: 0 }], 700);
        }
    }

    function eject(kind = 'blank') {
        const gun = document.querySelector('.table-gun');

        if (!gun) { return; }

        const shell = document.createElement('div');
        shell.className = `eject-shell shell-${kind}`;
        shell.dataset.shell = kind;
        shell.setAttribute('role', 'img');
        shell.setAttribute('aria-label', kind === 'live' ? '实弹弹壳' : '空弹弹壳');
        const pos = coordinate(gun.querySelector('.gun-port'));
        shell.style.cssText = `left:${pos.x}px;top:${pos.y}px`;
        layer().append(shell);
        move(shell, [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(30px,-25px) rotate(80deg)', opacity: 1, offset: .35 }, { transform: 'translate(48px,42px) rotate(150deg)', opacity: 1 }], 900);
    }

    async function pumpAndEject(gun, kind) {
        const own = generation, pump = gun.querySelector('.gun-pump');
        gun.dataset.pumpPhase = 'pull';
        const pulled = await move(pump, [{ transform: 'translateY(0)' }, { transform: 'translateY(23px)' }], 320).finished.then(() => true, () => false);

        if (!pulled || own !== generation) { return; }

        gun.dataset.pumpPhase = 'eject';
        eject(kind);

        if (!await hold(160) || own !== generation) { return; }

        gun.dataset.pumpPhase = 'push';
        const pushed = await move(pump, [{ transform: 'translateY(23px)' }, { transform: 'translateY(0)' }], 380).finished.then(() => true, () => false);

        if (pushed && own === generation) { gun.dataset.pumpPhase = 'done'; }
    }

    function itemAnchor(key, effect) {
        if (['saw', 'glass', 'inverter'].includes(key)) { return null; }

        const id = ['cuffs', 'jammer'].includes(key) ? effect.target : effect.actor || effect.viewer;

        return document.querySelector(`[data-player="${id}"]`);
    }

    function anchorPoint(card) {
        const box = card.getBoundingClientRect(), root = document.querySelector('.phone').getBoundingClientRect();
        const seat = card.dataset.seat;

        return battleLayout.anchor(card, {
            x: seat === 'left' ? box.right - root.left + 38 : seat === 'right' ? box.left - root.left - 38 : box.left - root.left + box.width / 2,
            y: seat === 'bottom' ? box.top - root.top - 40 : seat === 'top' ? box.bottom - root.top + 40 : box.top - root.top + box.height / 2
        });
    }

    function placeItem(key, stage, gun, effect) {
        const card = itemAnchor(key, effect);
        stage.classList.toggle('anchored-prop', !!card);

        if (card) {
            const point = anchorPoint(card);
            layer().append(stage);
            stage.style.left = `${point.x - 38}px`;
            stage.style.top = `${point.y - 38}px`;
            stage.dataset.interactionPlayer = card.dataset.player;
        } else {
            gun.closest('.battle-table').append(stage);
            stage.style.left = '';
            stage.style.top = '';
            delete stage.dataset.interactionPlayer;
        }
    }

    function flyFrom(id, symbol, effect) {
        const card = document.querySelector(`[data-player="${id}"]`), table = document.querySelector('.battle-table');

        if (!card || !table) { return; }

        const from = battleLayout.wide() && effect.stolenOrigin ? effect.stolenOrigin : coordinate(card.querySelector('.inventory')), target = itemAnchor(symbol, effect);
        const to = target ? anchorPoint(target) : battleLayout.landing(symbol, table.querySelector('.table-gun'), coordinate(table)), el = document.createElement('div');
        el.className = 'flying-prop';
        el.innerHTML = prop(symbol);
        el.style.cssText = `left:${from.x - 20}px;top:${from.y - 20}px`;
        layer().append(el);
        move(el, [{ transform: 'translate(0,0) scale(.6)', opacity: 1 }, { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(1.3)`, opacity: 1 }], 600);
        later(() => el.remove(), 650);
    }

    async function play(effect, elapsed = 0) {
        seekOffset = Math.max(0, elapsed);
        clear();
        const own = generation;
        const table = document.querySelector('.battle-table');

        if (!table || !effect) { return; }

        const gun = table.querySelector('.table-gun'), caption = table.querySelector('.table-caption');
        const shot = effect.kind === 'live' || effect.kind === 'blank';
        caption.querySelector('strong').textContent = shot || effect.item === 'glass' ? '' : effect.title;
        caption.querySelector('span').textContent = shot || effect.item === 'glass' ? '' : effect.detail;
        caption.hidden = shot || effect.item === 'glass' || (!effect.title && !effect.detail);
        table.dataset.kind = effect.kind;

        if (effect.item === 'saw') { gun.classList.remove('sawed'); }

        if (effect.kind === 'live' || effect.kind === 'blank') {
            const self = effect.target === effect.viewer;
            const targetSeat = document.querySelector(`[data-player="${effect.target}"]`)?.dataset.seat;
            const destination = coordinate(document.querySelector(`[data-player="${effect.target}"]`)), origin = coordinate(gun);
            const angle = Math.atan2(destination.x - origin.x, origin.y - destination.y) * 180 / Math.PI;
            gun.classList.toggle('sawed', !!effect.sawed);
            gun.dataset.aimAngle = String(angle);
            // 枪口向左时横向镜像枪械侧面，避免扳机随旋转翻到上方。
            gun.querySelector('.gun-profile').setAttribute('transform', angle < 0 ? 'translate(100 0) scale(-1 1)' : '');
            gun.style.transform = `rotate(${angle}deg)`;
            table.dataset.target = targetSeat;
            move(gun, [{ transform: 'rotate(0deg)' }, { transform: `rotate(${angle}deg)`, offset: .25 }, { transform: `rotate(${angle}deg) translateY(${effect.kind === 'live' ? 8 : 1}px)`, offset: .42 }, { transform: `rotate(${angle}deg)`, offset: .65 }, { transform: `rotate(${angle}deg)` }], 850);
            later(() => {
                if (elapsed < 270) { battleSound.play(effect.kind); }

                if (effect.kind === 'live') {
                    animateHealth(effect.target, effect.lifeBefore, effect.lifeAfter);
                    move(gun.querySelector('.muzzle'), [{ opacity: 0 }, { opacity: .9, offset: .18 }, { opacity: 0 }], 230);
                    mark(effect.target, effect.lifeBefore !== undefined ? effect.lifeBefore - effect.lifeAfter : effect.amount || 1, self);
                }
            }, 270);
            later(() => pumpAndEject(gun, effect.kind), 560);
        } else {
            const stage = table.querySelector('.prop-stage');
            stage.hidden = false;

            if (effect.stolenFrom) {
                const delay = battleTiming.stolen;

                if (!effect.injected) {
                    stage.innerHTML = prop('adrenaline');
                    animateItem('adrenaline', stage, gun, effect);
                } else { stage.hidden = true; }

                later(() => { stage.hidden = true; flyFrom(effect.stolenFrom, effect.item, effect); }, battleTiming.injection);
                later(() => {
                    stage.hidden = false;
                    stage.innerHTML = prop(effect.item);
                    animateItem(effect.item, stage, gun, effect);
                }, delay);
            } else {
                stage.innerHTML = prop(effect.item);
                animateItem(effect.item, stage, gun, effect);
            }
        }

        const duration = effect.item === 'glass' ? battleTiming.glass : shot || effect.item === 'beer' ? battleTiming.shot : battleTiming.item;
        const waiting = hold(duration + (effect.stolenFrom ? battleTiming.stolen : 0));
        seekOffset = 0;
        const completed = await waiting;

        if (!completed || own !== generation || !table.isConnected) { return false; }

        clear();
        table.dataset.kind = 'idle';
        caption.hidden = true;
        gun.style.opacity = '';
        gun.style.transform = '';
        gun.querySelector('.gun-profile').removeAttribute('transform');
        const remainingStage = table.querySelector('.prop-stage');

        if (remainingStage) { remainingStage.hidden = true; }

        caption.querySelector('strong').textContent = '';
        caption.querySelector('span').textContent = '';

        return true;
    }

    function hold(ms) {
        const element = document.querySelector('.battle-table');

        if (!element) { return Promise.resolve(false); }

        return move(element, [{ opacity: 1 }, { opacity: 1 }], ms).finished.then(() => true, () => false);
    }

    function pulse(stage, color = 'var(--qb-accent)', duration = 1100) {
        const ring = document.createElement('i');
        ring.className = 'prop-pulse';
        ring.style.borderColor = color;
        stage.append(ring);
        move(ring, [{ transform: 'scale(.4)', opacity: .9 }, { transform: 'scale(1.8)', opacity: 0 }], duration);
    }

    function lifeFeedback(stage, effect) {
        if (stage.dataset.healthApplied) { return; }

        stage.dataset.healthApplied = effect.hpDelta > 0 ? 'heal' : effect.hpDelta < 0 ? 'damage' : 'unchanged';
        const card = document.querySelector(`[data-player="${effect.actor || effect.viewer}"]`);
        animateHealth(effect.actor || effect.viewer, effect.lifeBefore, effect.lifeAfter);

        if (effect.hpDelta > 0) {
            card?.classList.add('healed-card');
            pulse(stage, 'var(--qb-accent)', 650);
        }

        if (effect.hpDelta < 0) { mark(effect.actor || effect.viewer, -effect.hpDelta, true); }
    }

    function turnFlow(effect) {
        const fromCard = document.querySelector(`[data-player="${effect.actor || effect.viewer}"]`);
        const toCard = document.querySelector(`[data-player="${effect.nextTarget}"]`);

        if (!fromCard || !toCard) { return; }

        const from = anchorPoint(fromCard), to = anchorPoint(toCard), root = document.querySelector('.phone').getBoundingClientRect();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('turn-flow');
        svg.dataset.target = effect.nextTarget;
        svg.setAttribute('viewBox', `0 0 ${root.width} ${root.height}`);
        svg.innerHTML = `<defs><marker id="mvp-turn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10Z" fill="currentColor" stroke="none"/></marker></defs><path marker-end="url(#mvp-turn-arrow)" d="${battleLayout.turnPath(from, to, root, effect.direction)}"/>`;
        layer().append(svg);
        const path = svg.querySelector('path[marker-end]'), length = path.getTotalLength();
        path.style.strokeDasharray = String(length);
        move(path, [{ strokeDashoffset: length, opacity: .3 }, { strokeDashoffset: 0, opacity: 1 }], 850);
    }

    function afterMotion(animation, callback) {
        const own = generation;
        animation.finished.then(() => { if (own === generation) { callback(); } }, () => { });
    }

    function animateItem(key, stage, gun, effect) {
        const part = name => stage.querySelector('.' + name);
        stage.dataset.item = key;
        delete stage.dataset.healthApplied;
        placeItem(key, stage, gun, effect);
        gun.closest('.battle-table').querySelector('.table-caption').hidden = true;
        stage.classList.toggle('saw-stage', key === 'saw');
        gun.style.opacity = '1';
        move(stage, [{ opacity: 0, transform: 'translateY(12px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], 240);

        switch (key) {
            case 'phone':
                move(part('phone-receiver'), [{ transform: 'translateY(0)' }, { transform: 'translate(-4px,-16px) rotate(-8deg)' }], 650);
                move(part('phone-dial'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(100deg)', offset: .45 }, { transform: 'rotate(0deg)' }], 1250);
                later(() => pulse(stage), 750);
                break;
            case 'saw': {
                const cut = gun.querySelector('.cut-edge').getBoundingClientRect(), table = gun.closest('.battle-table').getBoundingClientRect();
                stage.style.top = `${cut.y - table.y - stage.offsetHeight / 2}px`;
                stage.style.left = `${cut.x + cut.width / 2 - table.x - stage.offsetWidth / 2}px`;
                shorten(gun);
                move(stage, [{ transform: 'translateX(-14px)' }, { transform: 'translateX(14px)', offset: .2 }, { transform: 'translateX(-14px)', offset: .4 }, { transform: 'translateX(14px)', offset: .6 }, { transform: 'translateX(-10px)', offset: .8 }, { transform: 'translateX(0)' }], 850);
                break;
            }
            case 'beer':
                move(part('bottle-cap'), [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translate(16px,-24px) rotate(30deg)', opacity: 0 }], 450);
                move(stage, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-40deg)', offset: .5 }, { transform: 'rotate(0deg)' }], 1000);
                later(() => {
                    stage.hidden = true;
                    pumpAndEject(gun, effect.shell);
                }, 900);
                break;
            case 'adrenaline':
                move(part('syringe-plunger'), [{ transform: 'translateY(0)' }, { transform: 'translateY(12px)' }], 650);
                move(part('syringe-liquid'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)' }], 650);
                break;
            case 'inverter':
                move(part('inverter-switch'), [{ transform: 'translateX(0)' }, { transform: 'translateX(16px)' }], 450);
                move(part('inverter-arrows'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], 1100);
                later(() => pulse(stage, 'var(--qb-warning)'), 500);
                break;
            case 'cigarette':
                afterMotion(move(part('cigarette-ember'), [{ opacity: .25 }, { opacity: 1 }], 650), () => {
                    lifeFeedback(stage, effect);
                    move(part('cigarette-ember'), [{ opacity: 1 }, { opacity: .6 }], 850);
                });
                move(part('cigarette-smoke'), [{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'translateY(-8px)', opacity: .7, offset: .45 }, { transform: 'translateY(-25px)', opacity: 0 }], 1600);
                break;
            case 'jammer':
                move(part('jammer-wave'), [{ opacity: .2 }, { opacity: 1, offset: .3 }, { opacity: .3, offset: .6 }, { opacity: 1 }], 1300);
                pulse(stage);
                break;
            case 'glass':
                if (!['live', 'blank'].includes(effect.shell)) {
                    pulse(stage);
                    break;
                }

                stage.hidden = true;
                gun.dataset.inspectedShell = effect.shell;
                openUnderside(gun, true);
                later(() => closeUnderside(gun), 3000);
                break;
            case 'cuffs':
                move(part('cuff-right'), [{ transform: 'rotate(-35deg) translateX(10px)' }, { transform: 'rotate(0deg) translateX(0)' }], 750);
                later(() => pulse(stage), 650);
                break;
            case 'medicine':
                move(part('medicine-pack'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-12deg)', offset: .4 }, { transform: 'rotate(0deg)' }], 800);
                afterMotion(move(part('medicine-pill'), [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translate(0,26px) scale(.6)', opacity: 0 }], 1200), () => lifeFeedback(stage, effect));
                break;
            case 'remote':
                move(part('remote-button'), [{ transform: 'scale(1)' }, { transform: 'scale(.8)', offset: .4 }, { transform: 'scale(1)' }], 500);
                later(() => {
                    pulse(stage);
                    turnFlow(effect);
                }, 400);
                break;
        }

        if (effect.target) {
            const target = document.querySelector(`[data-player="${effect.target}"]`);
            move(target, [{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--qb-accent)', offset: .5 }, { boxShadow: '0 0 0 0 transparent' }], 1400);
        }
    }

    function pause(value) {
        paused = value;
        for (const animation of animations) { if (value) { animation.pause(); } else if (animation.playState === 'paused') { animation.play(); } }
    }

    document.addEventListener('visibilitychange', () => {
        for (const animation of animations) {
            if (document.hidden && animation.playState === 'running') { animation.pause(); } else if (!document.hidden && !paused && animation.playState === 'paused') { animation.play(); }
        }
    });

    return { table, play, clear, pause, move, hold, prop, coordinate, layer, openUnderside, closeUnderside };
})();
