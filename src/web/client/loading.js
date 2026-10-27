/* 展示区的每一发弹药直接移入枪底装填口，不生成第二份弹药。 */
const battleLoading = (() => {
    async function run(readMs = 5000, elapsed = 0) {
        let skip = Math.max(0, elapsed);
        const wait = async ms => {
            const remaining = Math.max(0, ms - skip);
            skip = Math.max(0, skip - ms);

            return !remaining || battleEffects.hold(remaining);
        };
        const seek = (animation, ms) => {
            animation.currentTime = Math.min(ms, skip);
            skip = Math.max(0, skip - ms);

            return animation.finished.then(() => true, () => false);
        };
        const table = document.querySelector('.battle-table');
        const rack = document.querySelector('.loading-rack');
        const label = document.querySelector('.loading-label');

        if (!table || !rack || !label) { return false; }

        table.dataset.kind = 'loading';

        if (!await wait(readMs)) { return false; }

        const gun = table.querySelector('.table-gun');

        if (!await battleEffects.openUnderside(gun, false, Math.min(skip, 850))) { return false; }

        skip = Math.max(0, skip - 850);
        rack.classList.add('covered');
        const point = battleEffects.coordinate(gun.querySelector('.loading-port'));
        const overlay = battleEffects.layer();
        const rounds = [...rack.children];
        label.textContent = `装填中 · 0/${rounds.length}`;

        for (let i = 0; i < rounds.length; i++) {
            const shell = rounds[i], from = battleEffects.coordinate(shell);
            const bounds = shell.getBoundingClientRect();
            const slot = document.createElement('span');
            slot.className = 'rack-slot';
            shell.replaceWith(slot);
            const round = document.createElement('div');
            round.className = 'loading-cartridge';
            round.dataset.round = String(i + 1);
            round.dataset.shell = shell.classList.contains('live') ? 'live' : 'blank';
            round.style.cssText = `left:${from.x - bounds.width / 2}px;top:${from.y - bounds.height / 2}px;width:${bounds.width}px;height:${bounds.height}px`;
            round.append(shell);
            round.insertAdjacentHTML('beforeend', '<svg class="loader-hand" viewBox="0 0 70 65" aria-hidden="true"><path d="M14 54 8 37q-3-8 4-10l13 9-6-22q-1-8 7-7l9 25 3-4q7-4 11 1l10 14-4 18Z" fill="#566057" stroke="#252d28" stroke-width="2"/><path d="m26 14 8 22m4-4 9 15m1-12 9 14M15 37l12 9" stroke="#879184" fill="none" stroke-width="2"/></svg>');
            overlay.append(round);
            const dx = point.x - from.x, dy = point.y - from.y;
            const motion = battleEffects.move(round, [
                { transform: 'translate(0,0)', opacity: 1 },
                { transform: `translate(${dx - 28}px,${dy + 75}px) rotate(-15deg)`, opacity: 1, offset: .45 },
                { transform: `translate(${dx}px,${dy + 25}px)`, opacity: 1, offset: .75 },
                { transform: `translate(${dx}px,${dy}px) scale(.55)`, opacity: 0 }
            ], 900);

            if (!await seek(motion, 900)) { return false; }

            round.remove();
            slot.classList.add('loaded');
            label.textContent = `装填中 · ${i + 1}/${rounds.length}`;
        }

        if (!await battleEffects.closeUnderside(gun, Math.min(skip, 700))) { return false; }

        skip = Math.max(0, skip - 700);
        label.textContent = '上膛';
        const pump = table.querySelector('.gun-pump');
        const closed = battleEffects.move(pump, [{ transform: 'translateY(0)' }, { transform: 'translateY(21px)', offset: .45 }, { transform: 'translateY(0)' }], 650);

        return seek(closed, 650);
    }

    return { run };
})();
