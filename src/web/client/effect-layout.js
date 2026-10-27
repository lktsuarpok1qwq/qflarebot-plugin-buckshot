/* 共用动画只从这里读取桌面布局几何；触控布局返回原有定位。 */
const battleLayout = (() => {
    function wide() {
        return getComputedStyle(document.querySelector('.phone')).getPropertyValue('--wide-effects').trim() === '1';
    }

    function point(element) {
        const box = element.getBoundingClientRect(), root = document.querySelector('.phone').getBoundingClientRect();

        return { x: box.x - root.x + box.width / 2, y: box.y - root.y + box.height / 2 };
    }

    function anchor(card, fallback) {
        if (!wide()) { return fallback; }

        const box = card.getBoundingClientRect(), root = document.querySelector('.phone').getBoundingClientRect();
        const x = box.x - root.x, y = box.y - root.y, cx = x + box.width / 2, cy = y + box.height / 2;
        const gap = 60, radius = 50;
        const candidates = [
            { x: cx, y: y - gap }, { x: cx, y: y + box.height + gap },
            { x: x - gap, y: cy }, { x: x + box.width + gap, y: cy },
            { x: x - gap, y: y + radius }, { x: x + box.width + gap, y: y + radius },
            { x: x - gap, y: y + box.height - radius }, { x: x + box.width + gap, y: y + box.height - radius }
        ];
        const obstacles = [...document.querySelectorAll('.player,.table-gun,.table-meta')].map(el => el.getBoundingClientRect());
        const score = p => {
            let overlap = 0;

            for (const r of obstacles) {
                overlap += Math.max(0, Math.min(p.x + radius, r.right - root.x) - Math.max(p.x - radius, r.x - root.x))
                    * Math.max(0, Math.min(p.y + radius, r.bottom - root.y) - Math.max(p.y - radius, r.y - root.y));
            }

            return overlap * 10000 + Math.hypot(p.x - fallback.x, p.y - fallback.y);
        };

        return candidates.filter(p => p.x >= radius && p.x <= root.width - radius && p.y >= radius && p.y <= root.height - radius)
            .sort((a, b) => score(a) - score(b))[0] || fallback;
    }

    function inspectZoom(gun) {
        if (!wide()) { return 1.6; }

        const box = gun.getBoundingClientRect(), cy = box.y + box.height / 2;
        const top = document.querySelector('[data-seat=top]').getBoundingClientRect().bottom + 12;
        const bottom = document.querySelector('[data-seat=bottom]').getBoundingClientRect().top - 12;

        return Math.max(.5, Math.min(1.6, 2 * Math.min(cy - top, bottom - cy) / box.height));
    }

    function stealOrigin(owner, index) {
        if (!wide()) { return null; }

        const item = document.querySelector(`[data-owner="${owner}"][data-index="${index}"] .item-art`);

        return item ? point(item) : null;
    }

    function landing(key, gun, fallback) {
        if (!wide()) { return fallback; }

        if (key === 'saw') { return point(gun.querySelector('.cut-edge')); }

        if (key === 'glass') { return point(gun); }

        const stage = gun.closest('.battle-table').querySelector('.prop-stage');

        if (key === 'inverter') {
            const hidden = stage.hidden, visibility = stage.style.visibility;
            stage.hidden = false;
            stage.style.visibility = 'hidden';
            const target = point(stage);
            stage.hidden = hidden;
            stage.style.visibility = visibility;

            return target;
        }

        return fallback;
    }

    function turnPath(from, to, root, direction) {
        if (!wide()) { return `M${from.x} ${from.y} Q${root.width * (direction === 1 ? .85 : .15)} ${root.height / 2} ${to.x} ${to.y}`; }

        const cards = [...document.querySelectorAll('.player')].map(el => {
            const r = el.getBoundingClientRect();

            return {
                left: r.left - root.left - 6, right: r.right - root.left + 6,
                top: r.top - root.top - 6, bottom: r.bottom - root.top + 6
            };
        });
        const xs = [from.x, to.x, 8, root.width - 8, ...cards.flatMap(r => [r.left - 2, r.right + 2])];
        const ys = [from.y, to.y, 64, root.height - 8, ...cards.flatMap(r => [r.top - 2, r.bottom + 2])];
        const clear = (a, b) => !cards.some(r => a.x === b.x
            ? a.x > r.left && a.x < r.right && Math.min(a.y, b.y) < r.bottom && Math.max(a.y, b.y) > r.top
            : a.y > r.top && a.y < r.bottom && Math.min(a.x, b.x) < r.right && Math.max(a.x, b.x) > r.left);
        let best = null, distance = Infinity;

        for (const x of xs) {
            for (const y of ys) {
                if (x < 8 || x > root.width - 8 || y < 64 || y > root.height - 8) { continue; }

                const points = [from, { x, y: from.y }, { x, y }, { x: to.x, y }, to];

                if (!points.slice(1).every((p, i) => clear(points[i], p))) { continue; }

                const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

                if (length < distance) {
                    best = points;
                    distance = length;
                }
            }
        }

        return (best || [from, to]).map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    }

    return { wide, anchor, inspectZoom, stealOrigin, landing, turnPath };
})();
