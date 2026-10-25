export const replayMenuStyle = String.raw`
.replay-menu{position:fixed;inset:auto;margin:0;padding:6px;border:1px solid var(--qb-border);border-radius:var(--qb-radius);background:var(--qb-surface);color:var(--qb-fg);box-shadow:var(--qb-shadow);overflow:auto;box-sizing:border-box}.replay-menu:popover-open{display:flex;flex-direction:column;gap:4px}.replay-menu>button,.replay-menu>a{display:flex;align-items:center;justify-content:flex-start;flex-shrink:0;min-height:44px;width:100%;padding:8px 12px;border:0;border-radius:var(--qb-radius);background:transparent;color:inherit;font:inherit;text-decoration:none;white-space:nowrap}.replay-menu>button:hover,.replay-menu>a:hover{background:var(--qb-surface-muted)}.replay-menu>.replay-danger{color:var(--qb-danger)}.replay-menu::backdrop{background:transparent}.replay-more{white-space:nowrap}
`;

export const replayMenuScript = String.raw`
let replayMenuOpen = null, replayMenuRevision = 0;

function closeReplayMenu(focus = false) {
    replayMenuRevision++;
    const current = replayMenuOpen;
    replayMenuOpen = null;

    if (!current) { return; }

    const ownedFocus = current.menu.contains(document.activeElement);
    current.observer?.disconnect();
    current.button.setAttribute('aria-expanded', 'false');

    if (current.menu.matches(':popover-open')) { current.menu.hidePopover(); }

    if (focus && ownedFocus && current.button.isConnected && !current.button.disabled) { current.button.focus({ preventScroll: true }); }
}

async function openReplayMenu(button, menu) {
    const same = replayMenuOpen?.button === button;
    closeReplayMenu();

    if (same || replayBusy || replayDeleting) { return; }

    const own = replayMenuRevision, area = await visibleArea();

    if (own !== replayMenuRevision || !button.isConnected || button.disabled || active !== 'replay') { return; }

    const anchor = button.getBoundingClientRect(), gap = 6, edge = 8;
    const above = anchor.top - area.top - edge - gap, below = area.top + area.height - anchor.bottom - edge - gap;

    if (area.width < 80 || Math.max(above, below) < 44) { return; }

    menu.style.width = Math.min(200, area.width - edge * 2) + 'px';
    menu.style.maxHeight = Math.max(above, below) + 'px';
    menu.style.visibility = 'hidden';
    menu.showPopover();
    const size = menu.getBoundingClientRect(), down = below >= size.height || below >= above;
    menu.style.left = Math.max(area.left + edge, Math.min(anchor.right - size.width, area.left + area.width - edge - size.width)) + 'px';
    menu.style.top = (down ? anchor.bottom + gap : anchor.top - gap - size.height) + 'px';
    menu.style.visibility = '';
    button.setAttribute('aria-expanded', 'true');
    const observer = new IntersectionObserver(([entry]) => {
        if (replayMenuOpen?.menu === menu && entry.intersectionRatio < 0.99) { closeReplayMenu(true); }
    }, { threshold: [0, 0.99, 1] });
    replayMenuOpen = { menu, button, observer };
    observer.observe(menu);

    if (document.activeElement === button) { menu.querySelector('[role=menuitem]').focus({ preventScroll: true }); }
}

function wireReplayMenu(button, menu) {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', menu.id);
    menu.setAttribute('popover', 'auto');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '回放操作');

    for (const item of menu.children) {
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1;
    }

    button.onclick = () => void openReplayMenu(button, menu);
    button.onkeydown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            void openReplayMenu(button, menu);
        }
    };
    menu.addEventListener('toggle', () => {
        if (!menu.matches(':popover-open') && replayMenuOpen?.menu === menu) { closeReplayMenu(true); }
    });
    menu.onkeydown = event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') { event.preventDefault(); }

            closeReplayMenu(true);

            return;
        }

        const items = [...menu.querySelectorAll('[role=menuitem]')], index = items.indexOf(document.activeElement);
        let next;

        if (event.key === 'ArrowDown') { next = (index + 1) % items.length; }

        if (event.key === 'ArrowUp') { next = (index + items.length - 1) % items.length; }

        if (event.key === 'Home') { next = 0; }

        if (event.key === 'End') { next = items.length - 1; }

        if (next !== undefined) {
            event.preventDefault();
            items[next].focus({ preventScroll: true });
        }
    };
}

document.addEventListener('pointerdown', event => {
    const current = replayMenuOpen;

    if (current && !current.menu.contains(event.target) && !current.button.contains(event.target)) { closeReplayMenu(); }
}, true);
document.addEventListener('click', event => { if (event.target.closest('[data-tab]')) { closeReplayMenu(); } });
window.addEventListener('resize', () => closeReplayMenu(true));
window.addEventListener('blur', () => closeReplayMenu());
window.addEventListener('scroll', event => {
    if (replayMenuOpen && (!(event.target instanceof Node) || !replayMenuOpen.menu.contains(event.target))) { closeReplayMenu(true); }
}, true);
`;
