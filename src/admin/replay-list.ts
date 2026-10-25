import { replayMenuStyle, replayMenuScript } from './replay-menu.js';

export const replayListStyle = replayMenuStyle + String.raw`
.replay-record{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-top:1px solid var(--qb-border)}.replay-record>div{min-width:0}.replay-record p{margin:4px 0;overflow-wrap:anywhere}.replay-record .actions{margin:0;align-items:center}.replay-link{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:7px 12px;border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius-full);color:var(--qb-fg);background:var(--qb-surface);text-decoration:none}.replay-link:hover{background:var(--qb-surface-muted)}.replay-primary{background:var(--qb-primary);color:var(--qb-on-primary)}.replay-primary:hover:not(:disabled){background:var(--qb-primary-hover)}.replay-danger{color:var(--qb-danger);background:var(--qb-danger-bg);border-color:var(--qb-danger)}#accept.destructive{color:var(--qb-on-danger,var(--qb-surface));background:var(--qb-danger);border-color:var(--qb-danger)}.replay-filters{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:16px 0}.replay-filters label{display:flex;align-items:center;gap:8px;min-width:0}.replay-filters input{min-width:0;max-width:100%}.replay-copy{display:block;width:100%;margin-top:10px}#confirmText{white-space:pre-line}@media(max-width:600px){.replay-record{align-items:stretch;flex-direction:column}.replay-record .actions>*{min-height:44px}.replay-filters label{width:100%}.replay-filters input{flex:1}}
`;
export const replayListMarkup = String.raw`
<div class="qb-card"><div class="actions"><label>日期 <input type="date" id="replayDate"></label><button id="replayList">加载列表</button></div><p class="hint">按北京时间选择日期</p><div class="replay-filters"><label>模式 <select id="replayFilterMode"><option value="">全部</option><option value="solo">单人</option><option value="duo">双人</option><option value="multi">多人</option></select></label><label>房间 ID <input id="replayFilterId" type="search" placeholder="在已加载列表中筛选"></label><label>排序 <select id="replaySort"><option value="new">时间从晚到早</option><option value="old">时间从早到晚</option></select></label></div><p id="replayNotice" role="status">尚未加载</p><div id="replayRecords" aria-label="日期对局列表"></div></div><details id="replayAdminDetails" class="qb-card" hidden><summary>管理员对局详情</summary><p id="replayAdminStyle"></p></details>
`;
export const replayListScript = replayMenuScript + String.raw`
replayLocalStart = () => { closeReplayMenu(); replayListEpoch++; clearAdminReplay(); };
let replayListEpoch = 0, replayListItems = [], replayListLoaded = false, replayListComplete = true, replayDeleting = false, replayLoadedKey = null, replayRaw = null;

function clearAdminReplay(clearCache = true) {
    replayLoadedKey = null;

    if (clearCache) { replayRaw = null; }

    $('replayAdminDetails').hidden = true;
    invalidateReplay();
}

function replayUrl(key) { return new URL('/p/buckshot/replay/#key=' + encodeURIComponent(key), location.href).href; }

function updateReplayControls() {
    if (replayBusy || replayDeleting) { closeReplayMenu(true); }

    $('replayList').disabled = replayBusy || replayDeleting;
    $('replayRecords').setAttribute('aria-busy', String(replayBusy || replayDeleting));
    $('replayDate').disabled = replayDeleting;
    $('replayRecords').querySelectorAll('button').forEach(b => b.disabled = replayBusy || replayDeleting);
}

function renderReplayList() {
    closeReplayMenu();
    const mode = $('replayFilterMode').value, filter = $('replayFilterId').value.trim().toLowerCase();
    const items = replayListItems.filter(i => (!mode || i.mode === mode) && i.gameId.toLowerCase().includes(filter)).slice();
    items.sort((a, b) => $('replaySort').value === 'old' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
    const records = $('replayRecords');
    records.replaceChildren();

    if (replayListLoaded) { $('replayNotice').textContent = !replayListItems.length ? '当天暂无已保存回放' : '显示 ' + items.length + ' / ' + replayListItems.length + ' 场' + (replayListComplete ? '' : '；仅加载当天最新 1000 场，列表未列全'); }

    for (const item of items) {
        const row = document.createElement('article'), info = document.createElement('div'), title = document.createElement('strong'), id = document.createElement('p'), size = document.createElement('p'), actions = document.createElement('div');
        row.className = 'replay-record';
        row.dataset.key = item.key;
        title.textContent = item.time + ' · ' + replayModes[item.mode];
        id.textContent = '房间 ' + item.gameId;
        size.className = 'hint';
        size.textContent = item.size < 1024 ? item.size + ' B' : (item.size / 1024).toFixed(1) + ' KiB';
        info.append(title, id, size);
        actions.className = 'actions';
        const view = document.createElement('button'), link = document.createElement('a'), copy = document.createElement('button'), remove = document.createElement('button'), download = document.createElement('button');
        view.textContent = '查看回放';
        view.className = 'replay-primary';
        view.onclick = () => loadAdminReplay(item);
        link.textContent = '打开链接';
        link.className = 'replay-link';
        link.href = replayUrl(item.key);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        copy.textContent = '复制链接';
        copy.onclick = async () => {
            await copyReplayLink(item, row, copy);

            if (replayMenuOpen?.menu === extra) { closeReplayMenu(true); }
        };
        remove.textContent = '删除回放';
        remove.className = 'replay-danger';
        remove.onclick = () => { closeReplayMenu(true); void removeAdminReplay(item, more); };
        download.textContent = '下载';
        download.onclick = () => downloadAdminReplay(item);
        const more = document.createElement('button'), extra = document.createElement('div');
        more.className = 'replay-more'; more.textContent = '更多'; extra.className = 'replay-menu';
        extra.id = 'replay-menu-' + records.children.length;
        extra.append(link, copy, remove);
        link.onclick = () => closeReplayMenu(true);
        wireReplayMenu(more, extra);
        actions.append(view, download, more, extra);
        row.append(info, actions);
        records.append(row);
    }

    updateReplayControls();
}

function copyReplayFallback(url, button) {
    if (document.activeElement !== button) { return false; }

    const input = document.createElement('textarea');
    input.value = url;
    input.readOnly = true;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(input);

    try {
        input.focus({ preventScroll: true });
        input.select();

        return document.execCommand('copy');
    } catch { return false; } finally {
        input.remove();
        restoreFocus(button);
    }
}

function replayCopied(button) {
    button.textContent = '已复制';

    if (active === 'replay') { toast('链接已复制'); }
    setTimeout(() => { if (button.isConnected) { button.textContent = '复制链接'; } }, 2000);
}

async function copyReplayLink(item, row, button) {
    const own = replayListEpoch, url = replayUrl(item.key);
    button.disabled = true;

    try {
        if (!navigator.clipboard?.writeText) { throw Error('clipboard unavailable'); }

        await Promise.race([navigator.clipboard.writeText(url), new Promise((_, reject) => setTimeout(() => reject(Error('clipboard timeout')), 3000))]);

        if (own !== replayListEpoch || !button.isConnected) { return; }

        replayCopied(button);
    } catch {
        if (own !== replayListEpoch || !row.isConnected) { return; }

        if (copyReplayFallback(url, button)) {
            replayCopied(button);

            return;
        }

        let input = row.querySelector('.replay-copy');

        if (!input) {
            input = document.createElement('input');
            input.className = 'replay-copy';
            input.readOnly = true;
            input.setAttribute('aria-label', '请手动复制本局链接');
            row.append(input);
        }

        input.value = url;

        // 仅在原复制入口仍持有焦点时定位，避免异步失败抢走用户的新焦点。
        if (document.activeElement === button) {
            input.focus({ preventScroll: true });
            input.select();
        }

        if (active === 'replay') { toast('浏览器未允许复制，请手动复制下方链接', 'warning'); }
    } finally {
        if (button.isConnected) {
            button.disabled = replayBusy || replayDeleting;

            if (document.hasFocus()) { restoreFocus(button); }
        }
    }
}

// 只缓存一份已验签原始文件；下载保持归档字节，不重新编码或请求对象。
async function readAdminReplay(item) {
    if (replayRaw?.key === item.key) { return replayRaw; }

    const { bytes, data } = await replayReadWithin(async () => {
        const response = await bridge.fetch('/api/replay?key=' + encodeURIComponent(item.key));

        return readReplayFile(response);
    });

    if (data.game.id !== item.gameId) { throw Error('回放场次不符'); }

    return { key: item.key, bytes, data };
}

async function downloadAdminReplay(item) {
    if (replayBusy || replayDeleting) { return; }

    const own = replayListEpoch;
    replayBusy = true;
    updateReplayControls();

    try {
        const raw = await readAdminReplay(item);

        if (own !== replayListEpoch) { return; }

        replayRaw = raw;
        const blobUrl = URL.createObjectURL(new Blob([raw.bytes], { type: 'application/octet-stream' })), link = document.createElement('a');
        link.href = blobUrl;
        link.download = item.key.split('/')[3] + '_' + item.time.replaceAll(':', '-') + '_' + item.mode + '_' + item.gameId + '.bs';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) { if (own === replayListEpoch && active === 'replay') { toast(e.message, 'error'); } } finally {
        replayBusy = false;
        updateReplayControls();
    }
}

async function loadAdminReplay(item) {
    if (replayBusy || replayDeleting) { return; }

    clearAdminReplay(false);
    const own = replayEpoch;
    replayBusy = true;
    updateReplayControls();

    try {
        const raw = await readAdminReplay(item), data = raw.data;

        if (own !== replayEpoch) { return; }

        if (data?.game?.id !== item.gameId) { throw Error('回放场次不符'); }

        loadReplayData(data, item.key);
        replayRaw = raw;
        replayLoadedKey = item.key;
        $('replayAdminStyle').textContent = data.game.personality ? '庄家性格：' + replayText('personality' + data.game.personality) : '本局未记录庄家性格';
        $('replayAdminDetails').hidden = false;
    } catch (e) { if (own === replayEpoch && active === 'replay') { toast(e.message, 'error'); } } finally {
        replayBusy = false;
        updateReplayControls();
    }
}

async function removeAdminReplay(item, button) {
    if (replayBusy || replayDeleting) { return; }

    const own = replayListEpoch;
    let deleted = false;
    // 模态确认期间只锁处理器，保留触发按钮焦点；确认后再禁用控件。
    replayDeleting = true;

    try {
        if (!await confirmAction(item.time + ' · ' + replayModes[item.mode] + '\n房间 ' + item.gameId + '\n\n永久删除本局回放，旧链接将无法重新加载。\n不改变比赛结果、参赛历史和积分流水。', true)) { return; }

        if (own !== replayListEpoch) { return; }

        updateReplayControls();
        const result = await api('/api/replay-delete', { key: item.key, confirmed: true });

        if (result.deleted !== true || result.key !== item.key) { throw Error('删除结果不符，请重试同一回放'); }

        if (replayLoadedKey === item.key) { clearAdminReplay(); }

        if (own !== replayListEpoch) { return; }

        replayListItems = replayListItems.filter(i => i.key !== item.key);

        if (replayRaw?.key === item.key) { replayRaw = null; }

        deleted = true;
        renderReplayList();

        if (active === 'replay') {
            toast('回放已删除');
        }
    } catch (e) { if (own === replayListEpoch && active === 'replay') { toast(e.message, 'error'); } } finally {
        replayDeleting = false;
        updateReplayControls();

        if (active === 'replay') { restoreFocus(deleted ? $('replayList') : button); }
    }
}

const replayDateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
$('replayDate').value = ['year', 'month', 'day'].map(k => replayDateParts.find(p => p.type === k).value).join('-');
$('replayDate').oninput = () => {
    replayListEpoch++;
    clearAdminReplay();
    replayListItems = [];
    replayListLoaded = false;
    $('replayList').textContent = '加载列表';
    $('replayNotice').textContent = '日期已变化，请加载列表';
    renderReplayList();
};
$('replayFilterMode').onchange = renderReplayList;
$('replayFilterId').oninput = renderReplayList;
$('replaySort').onchange = renderReplayList;
$('replayList').onclick = async () => {
    if (replayBusy || replayDeleting) { return; }

    const date = $('replayDate').value;

    if (!date) {
        toast('请选择日期', 'error');

        return;
    }

    clearAdminReplay();
    const own = ++replayListEpoch;
    replayBusy = true;
    replayListItems = [];
    replayListLoaded = false;
    renderReplayList();
    $('replayNotice').textContent = '正在加载';

    try {
        const r = await api('/api/replays?date=' + encodeURIComponent(date));

        if (own !== replayListEpoch) { return; }

        if (r.date !== date || !Array.isArray(r.items) || r.items.length > 1000 || typeof r.complete !== 'boolean' || r.items.some(i => !i || typeof i.key !== 'string' || !i.key.startsWith('replays/bs1/') || i.key.includes('..') || typeof i.gameId !== 'string' || !Object.hasOwn(replayModes, i.mode) || !/^\d{2}:\d{2}:\d{2}$/.test(i.time) || !Number.isSafeInteger(i.size) || i.size < 0)) { throw Error('列表响应无效'); }

        replayListItems = r.items;
        replayListLoaded = true;
        replayListComplete = r.complete;
        $('replayList').textContent = '重新加载列表';
        renderReplayList();
    } catch (e) {
        if (own === replayListEpoch) {
            $('replayNotice').textContent = e.message;

            if (active === 'replay') { toast(e.message, 'error'); }
        }
    } finally {
        replayBusy = false;
        updateReplayControls();
    }
};
`;
