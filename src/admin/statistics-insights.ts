import { overallSummaryScript } from './statistics-summary.js';

export const insightsStyle = String.raw`
.statistics-insights{margin:24px 0}.statistics-summary{padding-left:20px;margin:8px 0 20px;line-height:1.8}.statistics-plot{width:100%;min-width:0;height:240px;color:var(--qb-fg-muted)}.statistics-plot svg{display:block;width:100%;height:100%;overflow:visible;font:12px var(--qb-font-sans)}.statistics-series-0{color:var(--qb-accent)}.statistics-series-1{color:var(--qb-warning)}.statistics-series-2{color:var(--qb-fg)}.statistics-legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}.statistics-legend span{display:inline-flex;align-items:center;gap:6px}.statistics-legend i{width:18px;border-top:3px solid currentColor}.statistics-legend .statistics-series-1{border-top-style:dashed}.statistics-legend .statistics-series-2{border-top-style:dotted}.statistics-day{display:flex;gap:12px;align-items:center}.statistics-day input{padding:0;min-width:0;flex:1;appearance:none;background:transparent;border:0;min-height:32px}.statistics-day input::-webkit-slider-runnable-track{height:6px;border-radius:var(--qb-radius-full);background:var(--qb-border-strong)}.statistics-day input::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-5px;border:2px solid var(--qb-surface);border-radius:50%;background:var(--qb-accent)}.statistics-day input::-moz-range-track{height:6px;border-radius:var(--qb-radius-full);background:var(--qb-border-strong)}.statistics-day input::-moz-range-thumb{width:12px;height:12px;border:2px solid var(--qb-surface);border-radius:50%;background:var(--qb-accent)}.statistics-reading{font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-height:24px}.statistics-details{margin:16px 0}.statistics-details summary{cursor:pointer;padding:8px 0;font-weight:600}.statistics-details summary:focus-visible{outline:2px solid var(--qb-ring);outline-offset:2px}
@media(pointer:coarse){.statistics-insights select,.statistics-day input{min-height:44px}}
`;

export const insightsMarkup = String.raw`
<div class="statistics-insights"><div class="actions"><label>趋势 <select id="statisticsTrendKind"><option value="games">对局趋势</option><option value="points">积分趋势</option></select></label><label id="statisticsTrendPeriodLabel" hidden>显示 <select id="statisticsTrendPeriod"><option value="daily">每日收支</option><option value="total">累计收支</option></select></label></div><div id="statisticsTrendLegend" class="statistics-legend"></div><div id="statisticsTrendPlot" class="statistics-plot"></div><div class="statistics-day"><label for="statisticsTrendDay">查看日期</label><input id="statisticsTrendDay" type="range" min="0" max="0" value="0"></div><p id="statisticsTrendReading" class="statistics-reading" aria-live="polite"></p></div>
<details id="statisticsChallenge" class="statistics-details"><summary>每日挑战详情</summary><div id="statisticsChallengeTiles" class="statistics-grid"></div><p class="hint">挑战次数含开局后失败、认输、超时和取消；只统计已安全关闭的对局。奖励只计已确认到账。</p></details>
<details id="statisticsAI" class="statistics-details"><summary>AI 难度对比</summary><p class="hint">普通人机与每日挑战分别统计；多人混合难度不计入。对局少时不要据此判断难度高低。</p><div class="statistics-scroll"><table class="statistics-table"><thead><tr><th>玩法／难度</th><th>开局次数</th><th>获胜次数</th><th>玩家胜率／挑战成功率</th><th>净支出</th></tr></thead><tbody id="statisticsAILevels"></tbody></table></div></details>
`;

export const insightsScript = overallSummaryScript + String.raw`
let statisticsTrendData = [], statisticsTrendSelected = 0;
const statisticsSVG = 'http://www.w3.org/2000/svg';

function statisticsDates() {
    const dates = [], end = Date.parse($('statisticsTo').value + 'T00:00:00Z');

    for (let time = Date.parse($('statisticsFrom').value + 'T00:00:00Z'); time <= end; time += 86400000) { dates.push(new Date(time).toISOString().slice(0, 10)); }

    return dates;
}

function renderStatisticsInsights(rows, total) {
    const kinds = ['solo', 'daily'].filter(kind => rows.some(r => r.kind === kind));
    $('statisticsAI').hidden = !kinds.length;
    const levels = kinds.flatMap(kind => statisticsLevels.map((_, level) => ({ ...sumStatistics(rows.filter(r => r.kind === kind && r.difficulty === level)), kind, level })));
    statisticsTable('statisticsAILevels', levels.map(t => [statisticsKinds[t.kind] + ' · ' + statisticsLevels[t.level], t.started, t.humanWins, t.kind === 'daily' ? statisticsDailyRate(t) : statisticsRate(t), statisticsAmount(t.reward - t.burn, true)]));
    statisticsSummary(rows, total);
    let reward = 0n, burn = 0n;
    statisticsTrendData = statisticsDates().map(day => {
        const today = rows.filter(r => r.day === day), sum = sumStatistics(today);
        reward += sum.reward;
        burn += sum.burn;

        return { day, free: BigInt(sumStatistics(today.filter(r => !r.paid)).games), paid: BigInt(sumStatistics(today.filter(r => r.paid)).games), reward: sum.reward, burn: sum.burn, net: sum.reward - sum.burn, totalReward: reward, totalBurn: burn, totalNet: reward - burn };
    });
    statisticsTrendSelected = Math.min(statisticsTrendSelected, statisticsTrendData.length - 1);
    $('statisticsTrendDay').max = String(Math.max(0, statisticsTrendData.length - 1));
    $('statisticsTrendDay').disabled = statisticsTrendData.length < 2;
    renderStatisticsTrend();
}

function statisticsTrendSeries() {
    if ($('statisticsTrendKind').value === 'games') { return [['免费', 'free'], ['积分', 'paid']]; }

    return $('statisticsTrendPeriod').value === 'total' ? [['累计奖励', 'totalReward'], ['累计 AI 收走', 'totalBurn'], ['累计净支出', 'totalNet']] : [['发出奖励', 'reward'], ['AI 收走', 'burn'], ['净支出', 'net']];
}

function statisticsTick(value, money) {
    const sign = value < 0n ? '-' : '', n = value < 0n ? -value : value, unit = money ? 100n : 1n;

    for (const [base, label] of [[1000000000000n, '万亿'], [100000000n, '亿'], [10000n, '万']]) {
        const scale = base * unit;

        if (n >= scale) { return sign + n / scale + '.' + n % scale * 10n / scale + label; }
    }

    return money ? statisticsAmount(value) : String(value);
}

function statisticsNode(tag, attributes = {}, text) {
    const node = document.createElementNS(statisticsSVG, tag);

    for (const [key, value] of Object.entries(attributes)) { node.setAttribute(key, String(value)); }

    if (text !== undefined) { node.textContent = text; }

    return node;
}

function selectStatisticsTrend(index) {
    if (!statisticsTrendData.length) { return; }

    statisticsTrendSelected = index;
    $('statisticsTrendDay').value = String(index);
    const day = statisticsTrendData[index], money = $('statisticsTrendKind').value === 'points', series = statisticsTrendSeries();
    $('statisticsTrendDay').setAttribute('aria-valuetext', day.day);
    $('statisticsTrendReading').textContent = day.day + ' · ' + series.map(([name, key]) => name + ' ' + (money ? statisticsAmount(day[key], key.endsWith('Net') || key === 'net') : day[key] + ' 局')).join(' · ');
    const marker = $('statisticsTrendPlot').querySelector('[data-selected]');

    if (marker) {
        const x = Number(marker.dataset.left) + Number(marker.dataset.step) * index;
        marker.setAttribute('x1', String(x));
        marker.setAttribute('x2', String(x));
    }
}

function renderStatisticsTrend() {
    const box = $('statisticsTrendPlot'), width = box.clientWidth, money = $('statisticsTrendKind').value === 'points';
    $('statisticsTrendPeriodLabel').hidden = !money;
    const series = statisticsTrendSeries();
    $('statisticsTrendLegend').replaceChildren(...series.map(([name], i) => {
        const span = document.createElement('span'), swatch = document.createElement('i');
        swatch.className = 'statistics-series-' + i;
        span.append(swatch, document.createTextNode(name));

        return span;
    }));
    selectStatisticsTrend(statisticsTrendSelected);

    if (!width || !statisticsTrendData.length) { return; }

    let low = 0n, high = 0n;

    for (const day of statisticsTrendData) {
        for (const [, key] of series) {
            low = day[key] < low ? day[key] : low;
            high = day[key] > high ? day[key] : high;
        }
    }

    if (low === high) { high = money ? 100n : 1n; }

    const left = 70, right = width - 14, top = 14, bottom = 204, range = high - low;
    const step = statisticsTrendData.length > 1 ? (right - left) / (statisticsTrendData.length - 1) : 0;
    const x = i => statisticsTrendData.length > 1 ? left + i * step : (left + right) / 2;
    const y = n => bottom - Number((n - low) * 100000n / range) / 100000 * (bottom - top);
    const svg = statisticsNode('svg', { viewBox: '0 0 ' + width + ' 240', role: 'img', 'aria-label': money ? '积分收支趋势，精确金额见下方日期明细' : '免费与积分对局趋势，数量见下方日期明细' });
    const ticks = [high, ...(low < 0n && high > 0n && y(0n) - top > 20 && bottom - y(0n) > 20 ? [0n] : []), low];

    for (const value of ticks) {
        svg.append(statisticsNode('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: 'var(--qb-border)', 'stroke-dasharray': value ? '3 3' : 'none' }));
        svg.append(statisticsNode('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', fill: 'currentColor' }, statisticsTick(value, money)));
    }

    series.forEach(([, key], color) => {
        svg.append(statisticsNode('polyline', { points: statisticsTrendData.map((d, i) => x(i) + ',' + y(d[key])).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-dasharray': color === 1 ? '6 4' : color === 2 ? '2 3' : 'none', class: 'statistics-series-' + color }));
        statisticsTrendData.forEach((d, i) => svg.append(statisticsNode('circle', { cx: x(i), cy: y(d[key]), r: 3, fill: 'currentColor', class: 'statistics-series-' + color })));
    });
    svg.append(statisticsNode('line', { x1: x(statisticsTrendSelected), x2: x(statisticsTrendSelected), y1: top, y2: bottom, stroke: 'var(--qb-fg-muted)', 'stroke-dasharray': '4 4', 'data-selected': '', 'data-left': x(0), 'data-step': step }));
    const labelIndices = statisticsTrendData.length <= 1 ? [0] : [0, ...(width > 500 && statisticsTrendData.length > 2 ? [Math.floor((statisticsTrendData.length - 1) / 2)] : []), statisticsTrendData.length - 1];

    for (const i of labelIndices) { svg.append(statisticsNode('text', { x: x(i), y: 230, 'text-anchor': i === 0 ? 'start' : 'end', fill: 'currentColor' }, statisticsTrendData[i].day.slice(5))); }

    statisticsTrendData.forEach((d, i) => {
        const hit = statisticsNode('rect', { x: statisticsTrendData.length === 1 ? left : Math.max(left, x(i) - step / 2), y: top, width: statisticsTrendData.length === 1 ? right - left : Math.min(right, x(i) + step / 2) - Math.max(left, x(i) - step / 2), height: bottom - top, fill: 'transparent', 'aria-hidden': 'true' });
        hit.addEventListener('pointerenter', () => selectStatisticsTrend(i));
        hit.addEventListener('click', () => selectStatisticsTrend(i));
        svg.append(hit);
    });
    box.replaceChildren(svg);
}

$('statisticsTrendKind').onchange = renderStatisticsTrend;
$('statisticsTrendPeriod').onchange = renderStatisticsTrend;
$('statisticsTrendDay').oninput = () => selectStatisticsTrend(Number($('statisticsTrendDay').value));
new ResizeObserver(() => { if (statisticsRows && !$('statisticsResult').hidden) { renderStatisticsTrend(); } }).observe($('statisticsTrendPlot'));
`;
