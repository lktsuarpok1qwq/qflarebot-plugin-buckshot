export const feedbackScript = String.raw`import { createBridge } from '/bridge.js';

const bridge = await createBridge(), $ = id => document.getElementById(id);
bridge.setTitle('恶魔轮盘');
new ResizeObserver(() => bridge.resize(Math.ceil($('content').getBoundingClientRect().height))).observe($('content'));
const embedded = window.parent !== window;

if (!embedded) {
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', e => document.documentElement.dataset.theme = e.matches ? 'dark' : 'light');
}

function toast(text, level = 'success') {
    if (embedded) {
        bridge.toast(text, level);

        return;
    }

    const e = document.createElement('div');
    e.className = 'toast';
    e.textContent = text;
    e.onclick = () => e.remove();
    $('toasts').append(e);

    while ($('toasts').children.length > 3) { $('toasts').firstChild.remove(); }

    setTimeout(() => e.remove(), 4500);
}

async function api(path, body) {
    const response = await bridge.fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();

    if (!response.ok) { throw new Error(value.error || '请求未完成'); }

    return value;
}

function restoreFocus(control) {
    if (document.activeElement !== document.body || !control?.isConnected || control.disabled || !control.getClientRects().length) { return; }

    control.focus({ preventScroll: true });
}

let confirmation = false;

async function visibleArea() {
    const probe = document.createElement('div');
    probe.className = 'viewport-probe';
    document.body.append(probe);

    return new Promise(resolve => {
        const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            probe.remove();
            const rect = entry.intersectionRect, viewport = window.visualViewport;
            const left = Math.max(rect.left, viewport?.offsetLeft || 0), top = Math.max(rect.top, viewport?.offsetTop || 0);
            const right = Math.min(rect.right, viewport ? viewport.offsetLeft + viewport.width : innerWidth);
            const bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight);
            resolve({ left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
        });
        observer.observe(probe);
    });
}

async function confirmAction(text, destructive = false) {
    if (confirmation) { return false; }

    confirmation = true;
    const focus = document.activeElement, dialog = $('confirm');
    let timer, revision = 0;
    const position = area => {
        dialog.style.setProperty('--dialog-top', area.top + area.height / 2 + 'px');
        dialog.style.setProperty('--dialog-left', area.left + area.width / 2 + 'px');
        dialog.style.setProperty('--dialog-height', area.height + 'px');
        dialog.style.setProperty('--dialog-width', area.width + 'px');
    };

    try {
        const area = await visibleArea();

        if (!area.width || !area.height) { return false; }

        position(area);
        $('confirmText').textContent = text;
        $('confirmTitle').textContent = destructive ? '删除回放' : '确认操作';
        $('accept').textContent = destructive ? '永久删除' : '确认';
        $('accept').classList.toggle('destructive', destructive);
        dialog.showModal();
        $('cancel').focus({ preventScroll: true });
        // 仅在确认框打开时测量父页裁切；不发业务请求。
        timer = setInterval(async () => {
            const own = ++revision, area = await visibleArea();

            if (dialog.open && own === revision) { position(area); }
        }, 100);

        return await new Promise(resolve => {
            function close(result) {
                dialog.close();
                dialog.oncancel = null;
                dialog.onkeydown = null;
                dialog.onclick = null;
                $('cancel').onclick = null;
                $('accept').onclick = null;

                if (focus?.isConnected && !focus.disabled && focus.getClientRects().length) { focus.focus({ preventScroll: true }); }

                resolve(result);
            }

            dialog.onkeydown = e => {
                if (e.key !== 'Tab') { return; }

                const first = $('cancel'), last = $('accept');

                if (e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    (e.shiftKey ? last : first).focus({ preventScroll: true });
                }
            };
            $('cancel').onclick = () => close(false);
            $('accept').onclick = () => close(true);
            dialog.oncancel = e => {
                e.preventDefault();
                close(false);
            };
            dialog.onclick = e => {
                const rect = dialog.getBoundingClientRect();

                if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) { close(false); }
            };
        });
    } finally {
        revision++;
        clearInterval(timer);
        confirmation = false;
    }
}

`;
