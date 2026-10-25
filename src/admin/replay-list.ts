import { replayQueryScript } from './replay-query.js';
import { replayMenuStyle, replayMenuScript } from './replay-menu.js';

export const replayListStyle = replayMenuStyle + String.raw`
.replay-badge{display:inline-block;padding:2px 8px;border-radius:var(--qb-radius-full);background:var(--qb-surface-muted);color:var(--qb-fg);font-size:var(--qb-text-xs)}.replay-record{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px 12px;border:2px solid transparent;border-top-color:var(--qb-border);border-radius:var(--qb-radius)}.replay-record.replay-selected{border-color:var(--qb-accent)}.replay-record>div{min-width:0}.replay-record p{margin:4px 0;overflow-wrap:anywhere}.replay-record .actions{margin:0;align-items:center}.replay-link{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:7px 12px;border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius-full);color:var(--qb-fg);background:var(--qb-surface);text-decoration:none}.replay-link:hover{background:var(--qb-surface-muted)}.replay-primary{background:var(--qb-primary);color:var(--qb-on-primary)}.replay-primary:hover:not(:disabled){background:var(--qb-primary-hover)}.replay-danger{color:var(--qb-danger);background:var(--qb-danger-bg);border-color:var(--qb-danger)}#accept.destructive{color:var(--qb-on-danger,var(--qb-surface));background:var(--qb-danger);border-color:var(--qb-danger)}.replay-filters{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:16px 0}.replay-filters label{display:flex;align-items:center;gap:8px;min-width:0}.replay-filters input{min-width:0;max-width:100%}.replay-copy{display:block;width:100%;margin-top:10px}#confirmText{white-space:pre-line}.replay-query label{display:inline-flex;align-items:center;gap:8px;min-width:0}#replayCustom:not([hidden]){display:flex;flex-wrap:wrap;gap:12px;min-width:0}#replayCustom input{min-width:0;max-width:100%}.replay-pagination{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:16px}.replay-page-controls{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:nowrap}.replay-page-controls span{min-width:5ch;text-align:center;white-space:nowrap;line-height:1;font-variant-numeric:tabular-nums}@media(max-width:600px){.replay-record{align-items:stretch;flex-direction:column}.replay-record .actions>*{min-height:44px}.replay-filters label{width:100%}.replay-filters input{flex:1}}
`;
export const replayListMarkup = String.raw`
<div class="qb-card"><div class="actions replay-query"><label>时间 <select id="replayRange"><option value="today">今日</option><option value="week">近 7 天</option><option value="month">近 30 天</option><option value="custom">自定义</option></select></label><span id="replayCustom" hidden><label>开始 <input type="date" id="replayDate"></label><label>结束 <input type="date" id="replayEnd"></label></span><button id="replayList">查询</button></div><p id="replayRangeHint" class="hint"></p><p id="replayRangeError" class="danger" role="alert"></p><div class="replay-filters"><label>模式 <select id="replayFilterMode"><option value="">全部</option><option value="solo">单人</option><option value="duo">双人</option><option value="multi">多人</option></select></label><label>房间号 <input id="replayFilterId" type="search" placeholder="短号、#短号或完整 ID"></label><label>排序 <select id="replaySort"><option value="new">时间从晚到早</option><option value="old">时间从早到晚</option></select></label></div><p id="replayNotice" role="status">尚未查询</p><div id="replayRecords" aria-label="对局列表"></div><div class="replay-pagination"><div class="replay-page-controls" role="group" aria-label="回放分页"><button id="replayPagePrev" disabled>上一页</button><span id="replayPageCount" aria-live="polite">0 / 0</span><button id="replayPageNext" disabled>下一页</button></div><button id="replayMore" hidden>加载更多记录</button></div></div>
`;
export const replayListScript = replayMenuScript + String.raw`
replayLocalStart = () => { closeReplayMenu(); replayListEpoch++; clearAdminReplay(); };
replayLocalDone = () => { showAdminReplayStyle(replayData); showReplayDetail(null); };

function showAdminReplayStyle(data) {
    const styles = data.adminAI ?? [];
    $('replayAdminStyle').textContent = styles.length ? styles.map(([id, style]) => data.players.find(p => p.id === id).name + '：' + replayText('personality' + style)).join(' · ') : '本局未记录 AI 性格';
    $('replayAdminDetails').hidden = false;
}

let replayListEpoch = 0, replayListItems = [], replayListLoaded = false, replayListComplete = true, replayDeleting = false, replayLoadedKey = null, replayRaw = null, replayNextCursor = null, replayPageIndex = 0, replayPageTotal = 0, replaySelectedKey = null, replayReturnScroll = 0;

function showReplayDetail(key) {
    replaySelectedKey = key;
    replayReturnScroll = window.scrollY;
    $('replayBrowse').hidden = true;
    $('replayDetail').hidden = false;
    $('replayBack').focus({ preventScroll: true });
    $('replayDetail').scrollIntoView({ block: 'start' });
}

$('replayBack').onclick = () => {
    clearAdminReplay(false);
    renderReplayList();
    const row = [...$('replayRecords').children].find(r => r.dataset.key === replaySelectedKey);
    requestAnimationFrame(() => {
        if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('button').focus({ preventScroll: true }); }
        else { window.scrollTo(0, replayReturnScroll); }
    });
};

function clearAdminReplay(clearCache = true) {
    $('replayBrowse').hidden = false;
    $('replayDetail').hidden = true;
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
    for (const id of ['replayRange', 'replayDate', 'replayEnd']) { $(id).disabled = replayDeleting; }
    for (const id of ['replayFilterMode', 'replayFilterId', 'replaySort']) { $(id).disabled = replayBusy || replayDeleting; }
    $('replayMore').hidden = !replayListLoaded || !replayNextCursor;
    $('replayMore').disabled = replayBusy || replayDeleting;
    $('replayPagePrev').disabled = replayBusy || replayDeleting || replayPageIndex <= 0;
    $('replayPageNext').disabled = replayBusy || replayDeleting || replayPageIndex >= replayPageTotal - 1;
    $('replayRecords').querySelectorAll('button').forEach(b => b.disabled = replayBusy || replayDeleting);
}

function renderReplayList() {
    closeReplayMenu();
    const mode = $('replayFilterMode').value, filter = $('replayFilterId').value.trim().replace(/^#/, '').trim().toLowerCase();
    const items = replayListItems.filter(i => (!mode || i.mode === mode) && i.gameId.toLowerCase().includes(filter)).slice();
    items.sort((a, b) => {
        const order = (b.date + b.time).localeCompare(a.date + a.time) || a.key.localeCompare(b.key);

        return $('replaySort').value === 'old' ? -order : order;
    });
    replayPageTotal = Math.ceil(items.length / 10);
    replayPageIndex = Math.min(replayPageIndex, Math.max(0, replayPageTotal - 1));
    $('replayPageCount').textContent = (replayPageTotal ? replayPageIndex + 1 : 0) + ' / ' + replayPageTotal;
    const records = $('replayRecords');
    records.replaceChildren();

    if (replayListLoaded) {
        $('replayNotice').textContent = (replayListCached ? '上次查询 · ' : '') + (items.length ? '匹配 ' + items.length + ' / 已加载 ' + replayListItems.length + ' 场 · 每页 10 场' : replayListComplete ? '没有匹配的对局' : '已加载记录中没有匹配，更多记录尚未查询') + (replayListComplete ? '' : '；列表未加载完整');
    }

    for (const item of items.slice(replayPageIndex * 10, (replayPageIndex + 1) * 10)) {
        const row = document.createElement('article'), info = document.createElement('div'), title = document.createElement('strong'), id = document.createElement('p'), size = document.createElement('p'), actions = document.createElement('div');
        row.className = 'replay-record' + (item.key === replaySelectedKey ? ' replay-selected' : '');
        row.dataset.key = item.key;
        title.textContent = item.date + ' ' + item.time + ' · ' + replayModes[item.mode];
        if (item.daily) { const badge = document.createElement('span'); badge.className = 'replay-badge'; badge.textContent = '每日挑战'; title.append(' ', badge); }
        if (item.key === replaySelectedKey) { const mark = document.createElement('span'); mark.className = 'replay-badge'; mark.textContent = '上次查看'; title.append(' ', mark); }
        id.textContent = '🚪 房间 ' + item.gameId;
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
        showAdminReplayStyle(data);
        item.daily = !!data.game.challengeDate;
        showReplayDetail(item.key);
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
        if (!await confirmAction(item.time + ' · ' + replayModes[item.mode] + '\n🚪 房间 ' + item.gameId + '\n\n永久删除本局回放，旧链接将无法重新加载。\n不改变比赛结果、参赛历史和积分流水。', true)) { return; }

        if (own !== replayListEpoch) { return; }

        updateReplayControls();
        const result = await api('/api/replay-delete', { key: item.key, confirmed: true });

        if (result.deleted !== true || result.key !== item.key) { throw Error('删除结果不符，请重试同一回放'); }

        if (replayLoadedKey === item.key) { clearAdminReplay(); }

        if (own !== replayListEpoch) { return; }

        replayListItems = replayListItems.filter(i => i.key !== item.key);
        forgetReplayItem(item.key);

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

` + replayQueryScript;
