import { replayDate, replayDay } from '../replay/list.js';

export const replayQueryScript = 'const replayValidDate = ' + replayDate.toString() + ';\nconst replayDay = ' + replayDay.toString() + ';\n' + String.raw`
function replayToday() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());

    return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-');
}

function replayRange() {
    const start = $('replayDate').value, end = $('replayEnd').value;

    if (!replayValidDate(start) || !replayValidDate(end) || start > end || Date.parse(end) - Date.parse(start) > 30 * 86400000) { throw Error('请选择有效日期范围，最多 31 天'); }

    return { start, end };
}

function replayRangeHint() {
    try {
        const range = replayRange();
        $('replayRangeError').textContent = '';
        $('replayRangeHint').textContent = '北京时间 ' + range.start + ' ～ ' + range.end + '（含首尾两天）';

        return true;
    } catch (error) {
        $('replayRangeError').textContent = error.message;
        $('replayRangeHint').textContent = '北京时间 · 最多 31 天';

        return false;
    }
}

// 仅当前页面保留最多四个范围、合计 4000 条元数据；正文不进入列表缓存。
const replayRangeCache = new Map();
let replayListCached = false;

function replayRangeKey() {
    const range = replayRange();

    return range.start + '/' + range.end;
}

function rememberReplayRange() {
    const key = replayRangeKey();
    replayRangeCache.delete(key);

    if (replayListItems.length > 4000) { return; }

    replayRangeCache.set(key, { items: replayListItems.slice(), complete: replayListComplete, next: replayNextCursor });
    let count = [...replayRangeCache.values()].reduce((sum, value) => sum + value.items.length, 0);

    while (replayRangeCache.size > 4 || count > 4000) {
        const first = replayRangeCache.keys().next().value;
        count -= replayRangeCache.get(first).items.length;
        replayRangeCache.delete(first);
    }
}

function forgetReplayItem(key) {
    for (const saved of replayRangeCache.values()) { saved.items = saved.items.filter(item => item.key !== key); }
}

function invalidateReplayList() {
    replayListEpoch++;
    clearAdminReplay();
    replayListItems = [];
    replayListLoaded = false;
    replayListCached = false;
    replayListComplete = true;
    replayNextCursor = null;
    replayPageIndex = 0;
    $('replayList').textContent = '查询';
    $('replayNotice').textContent = '时间范围已变化，请查询';

    if (replayRangeHint()) {
        const key = replayRangeKey(), saved = replayRangeCache.get(key);

        if (saved) {
            replayRangeCache.delete(key);
            replayRangeCache.set(key, saved);
            replayListItems = saved.items.slice();
            replayListLoaded = true;
            replayListCached = true;
            replayListComplete = saved.complete;
            replayNextCursor = saved.next;
            $('replayList').textContent = '重新查询';
        }
    }

    renderReplayList();
}

function chooseReplayRange() {
    const mode = $('replayRange').value, today = replayToday();
    $('replayCustom').hidden = mode !== 'custom';

    if (mode !== 'custom') {
        $('replayDate').value = replayDay(today, mode === 'week' ? -6 : mode === 'month' ? -29 : 0);
        $('replayEnd').value = today;
    }

    invalidateReplayList();
}

function filterReplayList() {
    if (replayBusy || replayDeleting) { return; }

    replayListEpoch++;
    clearAdminReplay(false);
    replayPageIndex = 0;
    renderReplayList();
}

function pageReplayList(change) {
    if (replayBusy || replayDeleting) { return; }

    replayListEpoch++;
    clearAdminReplay(false);
    replayPageIndex = Math.max(0, Math.min(replayPageTotal - 1, replayPageIndex + change));
    renderReplayList();
    $('replayRecords').scrollIntoView({ block: 'start' });
}

async function queryReplayList(more = false) {
    if (replayBusy || replayDeleting) { return; }

    if (!more && $('replayRange').value !== 'custom') { chooseReplayRange(); }

    if (!replayRangeHint()) { return; }

    const range = replayRange(), cursor = more ? replayNextCursor : null;

    if (more && !cursor) { return; }

    clearAdminReplay(false);
    const own = ++replayListEpoch;
    replayBusy = true;

    if (!more) {
        replayRangeCache.delete(replayRangeKey());
        replayListCached = false;
        replayListItems = [];
        replayListLoaded = false;
        replayListComplete = true;
        replayNextCursor = null;
        replayPageIndex = 0;
    }

    renderReplayList();
    $('replayNotice').textContent = more ? '正在加载更多记录' : '正在查询';
    const query = new URLSearchParams({ ...range, ...(cursor ? { cursor } : {}) });

    try {
        const r = await api('/api/replays?' + query);

        if (own !== replayListEpoch) { return; }

        if (r.start !== range.start || r.end !== range.end || r.timezone !== 'Asia/Shanghai' || !Array.isArray(r.items) || r.items.length > 1000 || typeof r.complete !== 'boolean' || (r.complete ? r.next !== null : typeof r.next !== 'string' || !r.next || r.next === cursor) || r.items.some(i => !i || typeof i.key !== 'string' || !i.key.startsWith('replays/bs1/') || i.key.includes('..') || !replayValidDate(i.date) || i.date < range.start || i.date > range.end || !i.key.includes('/' + i.date + '/') || typeof i.gameId !== 'string' || !Object.hasOwn(replayModes, i.mode) || !/^\d{2}:\d{2}:\d{2}$/.test(i.time) || !Number.isSafeInteger(i.size) || i.size < 0)) { throw Error('列表响应无效'); }

        const records = new Map(replayListItems.map(i => [i.key, i]));

        for (const item of r.items) { records.set(item.key, item); }

        replayListItems = [...records.values()];
        replayListLoaded = true;
        replayListComplete = r.complete;
        replayNextCursor = r.next;
        replayListCached = false;
        rememberReplayRange();
        $('replayList').textContent = '重新查询';
        renderReplayList();
    } catch (error) {
        if (own === replayListEpoch) {
            renderReplayList();
            $('replayNotice').textContent = more ? '续读失败，已有记录保留，可重试加载更多' : '查询失败，请重试';

            if (active === 'replay') { toast(error.message, 'error'); }
        }
    } finally {
        replayBusy = false;
        updateReplayControls();
    }
}

$('replayRange').onchange = chooseReplayRange;
$('replayDate').oninput = invalidateReplayList;
$('replayEnd').oninput = invalidateReplayList;
$('replayFilterMode').onchange = filterReplayList;
$('replayFilterId').oninput = filterReplayList;
$('replaySort').onchange = filterReplayList;
$('replayPagePrev').onclick = () => pageReplayList(-1);
$('replayPageNext').onclick = () => pageReplayList(1);
$('replayList').onclick = () => queryReplayList();
$('replayMore').onclick = () => queryReplayList(true);
chooseReplayRange();
$('replayNotice').textContent = '尚未查询';
`;
