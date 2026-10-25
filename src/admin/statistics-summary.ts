export const overallSummaryScript = String.raw`
function statisticsDuration(ms) {
    const seconds = Math.round(ms / 1000);

    return Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒';
}

function statisticsDailyRate(t) { return t.started ? (100 * t.humanWins / t.started).toFixed(1) + '%' : '—'; }

function statisticsSummary(rows, total) {
    const lines = [], known = sumStatistics(rows.filter(r => r.kind !== 'unknown'));
    const old = sumStatistics(rows.filter(r => r.kind === 'unknown'));
    const selection = $('statisticsKind').value;

    if (!total.games && !total.cancelled && !total.unconfirmed) {
        lines.push('所选范围暂无对局');
    } else {
        lines.push('共完成 ' + total.games + ' 局' + (known.timedGames ? '；其中 ' + known.timedGames + ' 局平均用时 ' + statisticsDuration(known.completedDurationMs / known.timedGames) : '') + '。');
        const groups = Object.keys(statisticsKinds).filter(k => k !== 'unknown').map(kind => ({ kind, games: sumStatistics(rows.filter(r => r.kind === kind)).games }));
        const top = Math.max(0, ...groups.map(g => g.games)), popular = groups.filter(g => g.games === top && top > 0);

        if (!selection && popular.length && popular.length <= 2) {
            lines.push('已分类对局中，' + popular.map(g => statisticsKinds[g.kind]).join('、') + (popular.length > 1 ? '并列最多，各 ' : '最多，') + top + ' 局，占比 ' + (100 * top / known.games).toFixed(1) + '%。');
        }

        if (known.games) {
            lines.push('可统计的已完成对局：每局开枪 ' + (known.completedShots / known.games).toFixed(1) + ' 次、使用道具 ' + (known.completedItems / known.games).toFixed(1) + ' 次，每百局超时 ' + (100 * known.completedTimeouts / known.games).toFixed(1) + ' 次。');
        }

        const daily = sumStatistics(rows.filter(r => r.kind === 'daily'));

        if ((!selection || selection === 'daily') && daily.started) {
            lines.push('每日挑战 ' + daily.started + ' 次，成功 ' + daily.humanWins + ' 次，成功率 ' + statisticsDailyRate(daily) + '。');
        } else if (selection === 'solo' || selection === 'multiAI') {
            const t = sumStatistics(rows.filter(r => r.kind === selection));
            lines.push((selection === 'solo' ? '玩家' : '真人') + '获胜 ' + t.humanWins + ' 局，胜率 ' + statisticsRate(t) + '（不含取消或无胜者）。');
        }

        if (total.stake || total.reward || total.burn || total.refund || total.transfer) {
            const net = total.reward - total.burn;
            lines.push('已发奖励 ' + statisticsAmount(total.reward) + ' 积分，人机赢走 ' + statisticsAmount(total.burn) + ' 积分，' + (net < 0n ? '净收回 ' : '净支出 ') + statisticsAmount(net < 0n ? -net : net) + ' 积分。');
        }

        const notes = [];

        if (total.draws) { notes.push('无胜者 ' + total.draws + ' 局'); }

        if (total.unconfirmed) { notes.push(total.unconfirmed + ' 场积分结果待确认，未计入金额'); }

        if (known.unopened) { notes.push('未开局关闭 ' + known.unopened + ' 间'); }

        if (known.cancelled > known.unopened) { notes.push('中途取消 ' + (known.cancelled - known.unopened) + ' 场'); }

        if (old.games || old.cancelled) { notes.push('旧记录未分类，不参与玩法比较和均值'); }

        if (notes.length) { lines.push(notes.join('；') + '。'); }
    }

    $('statisticsSummary').replaceChildren(...lines.slice(0, 6).map(text => {
        const li = document.createElement('li');
        li.textContent = text;

        return li;
    }));
}
`;
