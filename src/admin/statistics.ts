import { insightsMarkup, insightsScript, insightsStyle } from './statistics-insights.js';

export const statisticsStyle = String.raw`
.statistics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:16px 0}.statistics-tile{padding:16px;background:var(--qb-surface-muted);border-radius:var(--qb-radius-lg)}.statistics-tile span{display:block;color:var(--qb-fg-muted);font-size:var(--qb-text-sm)}.statistics-tile strong{display:block;font-size:var(--qb-text-xl);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;margin-top:8px}.statistics-tile-wide{grid-column:1/-1;display:flex;align-items:baseline;gap:12px;overflow-x:auto;white-space:nowrap}.statistics-tile-wide span,.statistics-tile-wide strong{flex:none;white-space:nowrap;overflow-wrap:normal}.statistics-tile-wide strong{margin-top:0;font-size:var(--qb-text-lg)}.statistics-scroll{max-width:100%;overflow:auto}.statistics-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.statistics-table td,.statistics-table th{padding:10px;text-align:right;border-bottom:1px solid var(--qb-border);white-space:nowrap}.statistics-table td:first-child,.statistics-table th:first-child{text-align:left}#statisticsResult pre{font:inherit;line-height:1.7}.statistics-error{color:var(--qb-danger)}
` + insightsStyle;
export const statisticsMarkup = String.raw`
<section id="statistics" role="tabpanel" hidden><div class="qb-card"><div class="actions"><label>开始日期 <input id="statisticsFrom" type="date" aria-describedby="statisticsNotice"></label><label>结束日期 <input id="statisticsTo" type="date" aria-describedby="statisticsNotice"></label><button id="statisticsQuery">查询概览</button></div><p class="hint">按结束日期统计，北京时间，最多 31 天；不含启用前的旧对局。</p><div class="actions"><label>模式 <select id="statisticsMode"><option value="">全部</option><option value="solo">单人</option><option value="duo">双人</option><option value="multi">多人</option></select></label><label>玩法 <select id="statisticsKind"><option value="">全部</option><option value="solo">普通人机</option><option value="daily">每日挑战</option><option value="duo">双人真人</option><option value="multi">多人纯真人</option><option value="multiAI">多人 AI 补位</option><option value="unknown">未分类旧记录</option></select></label><label>类型 <select id="statisticsPaid"><option value="">全部</option><option value="0">免费</option><option value="1">积分</option></select></label></div><p id="statisticsNotice" role="status">尚未查询</p><div id="statisticsLoading" class="skeleton" aria-label="正在查询概览" hidden></div><div id="statisticsResult" hidden><h2>整体小结</h2><ul id="statisticsSummary" class="statistics-summary"></ul><div id="statisticsGames" class="statistics-grid"></div><p class="hint">均值只统计有完整分类的已完成对局；未开局关房不计入比赛胜率。旧记录保留金额和计数，不猜测玩法。</p><section id="statisticsMoneySection"><h2>积分收支</h2><div id="statisticsMoney" class="statistics-grid"></div><p class="hint">净支出＝发出奖励－人机赢走，真人之间的下注转移不算支出。只统计已确认结果，纠错以 Points 流水为准。</p></section><!-- BUCKSHOT_INSIGHTS --><details class="statistics-details"><summary>每日明细</summary><div class="statistics-scroll"><table class="statistics-table"><thead><tr><th>北京时间日期</th><th>完成对局</th><th>免费</th><th>积分</th><th>开枪</th><th>道具操作</th><th>发出奖励</th><th>AI 收走</th><th>净支出</th></tr></thead><tbody id="statisticsDays"></tbody></table></div></details><details class="statistics-details"><summary>玩法明细</summary><div class="statistics-scroll"><table class="statistics-table"><thead><tr><th>玩法／难度</th><th>完成对局</th><th>取消</th><th>获胜率／成功率</th><th>发出奖励</th><th>净支出</th></tr></thead><tbody id="statisticsModes"></tbody></table></div></details></div></div><div class="qb-card"><div class="actions"><label>玩家 OpenID <input id="statisticsUser" autocomplete="off" aria-describedby="statisticsPlayerNotice"></label><button id="statisticsPlayerQuery">查询个人战绩</button></div><p id="statisticsPlayerNotice" role="status">尚未查询</p><div id="statisticsPlayerLoading" class="skeleton" aria-label="正在查询战绩" hidden></div><pre id="statisticsPlayerResult" hidden></pre></div></section>
`.replace('<!-- BUCKSHOT_INSIGHTS -->', () => insightsMarkup);
export const statisticsScript = String.raw`
let statisticsRows = null, statisticsEpoch = 0, statisticsBusy = false, playerStatisticsEpoch = 0, playerStatisticsBusy = false;
const statisticsCounts = ['games', 'cancelled', 'draws', 'players', 'humanWins', 'shots', 'live', 'blank', 'ejected', 'loads', 'items', 'damage', 'healing', 'timeouts', 'durationMs', 'unconfirmed', 'started', 'unopened', 'timedGames', 'completedDurationMs', 'completedShots', 'completedItems', 'completedTimeouts'];
const statisticsMoney = ['stake', 'principal', 'transfer', 'refund', 'reward', 'burn'];
const statisticsKinds = { solo: '普通人机', daily: '每日挑战', duo: '双人真人', multi: '多人纯真人', multiAI: '多人 AI 补位', unknown: '未分类旧记录' };
const statisticsModes = { solo: '单人', duo: '双人', multi: '多人' }, statisticsLevels = ['新手', '普通', '困难', '专家', '恶魔'];

function statisticsAmount(value, signed = false) {
    const n = BigInt(value), a = n < 0n ? -n : n;

    return (n < 0n ? '-' : signed && n > 0n ? '+' : '') + a / 100n + '.' + String(a % 100n).padStart(2, '0');
}

function sumStatistics(rows) {
    const t = Object.fromEntries(statisticsCounts.map(k => [k, 0]));

    for (const k of statisticsMoney) { t[k] = 0n; }

    for (const r of rows) {
        for (const k of statisticsCounts) { t[k] += r[k]; }

        for (const k of statisticsMoney) { t[k] += BigInt(r[k]); }
    }

    return t;
}

function statisticsTiles(id, entries) {
    $(id).replaceChildren(...entries.map(([label, value, wide]) => {
        const e = document.createElement('div'), name = document.createElement('span'), n = document.createElement('strong');
        e.className = 'statistics-tile' + (wide ? ' statistics-tile-wide' : '');
        name.textContent = label;
        n.textContent = String(value);
        e.append(name, n);

        return e;
    }));
}

function statisticsTable(id, rows) {
    $(id).replaceChildren(...rows.map(values => {
        const row = document.createElement('tr');

        for (const value of values) {
            const td = document.createElement('td');
            td.textContent = String(value);
            row.append(td);
        }

        return row;
    }));
}

function statisticsRate(t) { return t.games - t.draws > 0 ? (t.humanWins * 100 / (t.games - t.draws)).toFixed(1) + '%' : '—'; }

function renderStatistics() {
    if (!statisticsRows) { return; }

    const rows = statisticsRows.filter(r => (!$('statisticsMode').value || r.mode === $('statisticsMode').value) && (!$('statisticsPaid').value || String(r.paid) === $('statisticsPaid').value) && (!$('statisticsKind').value || r.kind === $('statisticsKind').value)), t = sumStatistics(rows);
    const known = sumStatistics(rows.filter(r => r.kind !== 'unknown')), unknown = sumStatistics(rows.filter(r => r.kind === 'unknown'));
    const daily = sumStatistics(rows.filter(r => r.kind === 'daily')), normal = sumStatistics(rows.filter(r => r.kind === 'solo'));
    const otherReward = t.reward - daily.reward - normal.reward;
    statisticsTiles('statisticsGames', [['完成对局', t.games], ['参赛人次', t.players], ['未开局关闭', known.unopened], ['中途取消', known.cancelled - known.unopened], ...(unknown.cancelled ? [['旧记录取消', unknown.cancelled]] : []), ['开枪（实弹／空弹）', t.shots + '（' + t.live + '／' + t.blank + '）', true], ['使用道具', t.items], ['超时', t.timeouts], ...(t.unconfirmed ? [['积分待确认', t.unconfirmed]] : [])]);
    $('statisticsMoneySection').hidden = !(t.stake || t.reward || t.burn || t.refund || t.transfer || t.unconfirmed);
    statisticsTiles('statisticsMoney', [['挑战奖励', statisticsAmount(daily.reward)], ['人机对战奖励', statisticsAmount(normal.reward)], ...(otherReward ? [['其他／未分类奖励', statisticsAmount(otherReward)]] : []), ['人机赢走', statisticsAmount(t.burn)], ['退回本金', statisticsAmount(t.refund)], ['积分净支出', statisticsAmount(t.reward - t.burn, true)]]);
    $('statisticsChallenge').hidden = !(daily.started || daily.unopened || daily.unconfirmed);
    statisticsTiles('statisticsChallengeTiles', [['挑战次数', daily.started], ['成功次数', daily.humanWins], ['成功率', statisticsDailyRate(daily)], ['已发奖励', statisticsAmount(daily.reward)], ['奖励待确认', daily.unconfirmed]]);
    const days = statisticsDates();
    statisticsTable('statisticsDays', days.map(day => {
        const x = sumStatistics(rows.filter(r => r.day === day));

        return [day, x.games, sumStatistics(rows.filter(r => r.day === day && !r.paid)).games, sumStatistics(rows.filter(r => r.day === day && r.paid)).games, x.shots, x.items, statisticsAmount(x.reward), statisticsAmount(x.burn), statisticsAmount(x.reward - x.burn, true)];
    }));
    const modes = [...new Set(rows.map(r => r.kind + ':' + r.difficulty))].sort();
    statisticsTable('statisticsModes', modes.map(key => {
        const list = rows.filter(r => r.kind + ':' + r.difficulty === key), x = sumStatistics(list), r = list[0];
        const rate = r.kind === 'daily' ? statisticsDailyRate(x) : ['solo', 'multiAI'].includes(r.kind) ? statisticsRate(x) : '—';

        return [statisticsKinds[r.kind] + (r.difficulty >= 0 && r.kind !== 'unknown' ? ' · ' + statisticsLevels[r.difficulty] : ''), x.games, x.cancelled, rate, statisticsAmount(x.reward), statisticsAmount(x.reward - x.burn, true)];
    }));
    renderStatisticsInsights(rows, t);
    $('statisticsResult').hidden = false;
}

function statisticsControls() {
    const from = $('statisticsFrom').value, to = $('statisticsTo').value, days = (Date.parse(to) - Date.parse(from)) / 86400000;
    $('statisticsQuery').disabled = statisticsBusy || !from || !to || !Number.isFinite(days) || days < 0 || days > 30;
    const user = $('statisticsUser').value.trim();
    $('statisticsPlayerQuery').disabled = playerStatisticsBusy || !user || user.length > 256;
}

const statisticsDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
$('statisticsTo').value = ['year', 'month', 'day'].map(k => statisticsDate.find(p => p.type === k).value).join('-');
$('statisticsFrom').value = new Date(Date.parse($('statisticsTo').value + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);

for (const id of ['statisticsFrom', 'statisticsTo']) {
    $(id).oninput = () => {
        statisticsEpoch++;
        statisticsRows = null;
        $('statisticsResult').hidden = true;
        $('statisticsNotice').textContent = '日期已变化，请重新查询';
        statisticsControls();
    };
}

$('statisticsMode').onchange = renderStatistics;
$('statisticsPaid').onchange = renderStatistics;
$('statisticsKind').onchange = renderStatistics;
$('statisticsQuery').onclick = async () => {
    if (statisticsBusy) { return; }

    const from = $('statisticsFrom').value, to = $('statisticsTo').value, days = (Date.parse(to) - Date.parse(from)) / 86400000;

    if (!from || !to || !Number.isFinite(days) || days < 0 || days > 30) {
        $('statisticsNotice').textContent = '请选择有效日期，范围最多 31 天';

        return;
    }

    const own = ++statisticsEpoch, feedback = epoch.statistics;
    statisticsBusy = true;
    statisticsRows = null;
    $('statisticsResult').hidden = true;
    $('statisticsQuery').disabled = true;
    $('statisticsQuery').setAttribute('aria-busy', 'true');
    $('statisticsNotice').textContent = '正在查询';
    $('statisticsLoading').hidden = false;

    try {
        const r = await api('/api/statistics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));

        if (own !== statisticsEpoch || feedback !== epoch.statistics) { return; }

        if (r.from !== from || r.to !== to || r.timezone !== 'Asia/Shanghai' || !Number.isFinite(r.observedAt) || !Array.isArray(r.rows) || r.rows.length > 3000 || r.rows.some(row => !row || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || row.day < from || row.day > to || !Object.hasOwn(statisticsModes, row.mode) || !Object.hasOwn(statisticsKinds, row.kind) || ![0, 1].includes(row.paid) || !(row.mode === 'solo' ? Number.isInteger(row.difficulty) && row.difficulty >= 0 && row.difficulty <= 4 : row.difficulty === -1) || statisticsCounts.some(k => !Number.isSafeInteger(row[k]) || row[k] < 0) || statisticsMoney.some(k => typeof row[k] !== 'string' || !/^\d+$/.test(row[k])))) { throw Error('统计响应无效'); }

        statisticsRows = r.rows;
        renderStatistics();
        $('statisticsNotice').textContent = '已查询 · 北京时间 ' + new Date(r.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + (r.rows.length ? '' : ' · 范围内暂无已汇总记录');
    } catch (e) {
        if (own === statisticsEpoch && feedback === epoch.statistics) {
            statisticsRows = null;
            $('statisticsResult').hidden = true;
            $('statisticsNotice').textContent = e.message;
        }
    } finally {
        statisticsBusy = false;
        $('statisticsLoading').hidden = true;
        statisticsControls();
        $('statisticsQuery').setAttribute('aria-busy', 'false');

        if (own === statisticsEpoch && feedback !== epoch.statistics) { $('statisticsNotice').textContent = '查询已结束，请重新查询'; }
    }
};
$('statisticsUser').oninput = () => {
    playerStatisticsEpoch++;
    $('statisticsPlayerResult').hidden = true;
    $('statisticsPlayerNotice').textContent = '玩家已变化，请重新查询';
    statisticsControls();
};
$('statisticsPlayerQuery').onclick = async () => {
    if (playerStatisticsBusy) { return; }

    const user = $('statisticsUser').value.trim();

    if (!user || user.length > 256) {
        $('statisticsPlayerNotice').textContent = '请填写有效玩家 OpenID';

        return;
    }

    const own = ++playerStatisticsEpoch, feedback = epoch.statistics;
    playerStatisticsBusy = true;
    $('statisticsPlayerResult').hidden = true;
    $('statisticsPlayerQuery').disabled = true;
    $('statisticsPlayerQuery').setAttribute('aria-busy', 'true');
    $('statisticsPlayerNotice').textContent = '正在查询';
    $('statisticsPlayerLoading').hidden = false;

    try {
        const r = await api('/api/player-statistics?user=' + encodeURIComponent(user));

        if (own !== playerStatisticsEpoch || feedback !== epoch.statistics) { return; }

        if (!r.totals || r.totals.version !== 1 || !Array.isArray(r.recent) || r.recent.length > 10 || typeof r.text !== 'string') { throw Error('个人战绩响应无效'); }

        $('statisticsPlayerResult').textContent = r.text;
        $('statisticsPlayerResult').hidden = false;
        $('statisticsPlayerNotice').textContent = '已查询 · 只含已安全结束的参赛记录';
    } catch (e) { if (own === playerStatisticsEpoch && feedback === epoch.statistics) { $('statisticsPlayerNotice').textContent = e.message; } } finally {
        playerStatisticsBusy = false;
        $('statisticsPlayerLoading').hidden = true;
        statisticsControls();
        $('statisticsPlayerQuery').setAttribute('aria-busy', 'false');

        if (own === playerStatisticsEpoch && feedback !== epoch.statistics) { $('statisticsPlayerNotice').textContent = '查询已结束，请重新查询'; }
    }
};
statisticsControls();
` + insightsScript;
