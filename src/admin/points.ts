export const pointsScript = String.raw`
let pointsBusy = false, ownerBusy = false, ownerEpoch = 0;
$('userId').oninput = () => {
    ownerEpoch++;
    $('ownerResult').textContent = '尚未查询';
};

async function points(action) {
    if (pointsBusy) { return; }

    pointsBusy = true;
    const own = epoch.points, focus = document.activeElement;

    try {
        if (action === 'register' && !await confirmAction('登记 Buckshot 积分来源；登记不会自动获得授权')) { return; }

        for (const id of ['pointsQuery', 'pointsRegister']) { $(id).disabled = true; }

        $('pointsResult').setAttribute('aria-busy', 'true');
        const r = await api('/api/points', { action });

        if (r.ok !== true) { throw new Error(r.message || '积分服务未完成请求'); }

        if (own === epoch.points) {
            $('pointsResult').textContent = JSON.stringify(r, null, 2);
            toast('请求完成');
        }
    } catch (e) { if (own === epoch.points) { toast(e.message, 'error'); } } finally {
        pointsBusy = false;

        for (const id of ['pointsQuery', 'pointsRegister']) { $(id).disabled = false; }

        $('pointsResult').setAttribute('aria-busy', 'false');

        if (own === epoch.points) { restoreFocus(focus); }
    }
}

$('pointsQuery').onclick = () => points('query');
$('pointsRegister').onclick = () => points('register');

async function occupancy(release) {
    if (ownerBusy) { return; }

    const userId = $('userId').value.trim();

    if (!userId) {
        toast('请填写玩家 OpenID', 'error');

        return;
    }

    ownerBusy = true;
    const own = ownerEpoch, feedback = epoch.points, focus = document.activeElement;

    try {
        if (release && !await confirmAction('仅释放已安全关闭房间的残留占用')) { return; }

        for (const id of ['ownerQuery', 'ownerRepair']) { $(id).disabled = true; }

        $('ownerResult').setAttribute('aria-busy', 'true');
        const r = await api('/api/occupancy', { userId, release });

        if (r.userId !== userId || !('owner' in r)) { throw new Error('占用响应无效'); }

        if (own === ownerEpoch) {
            $('ownerResult').textContent = JSON.stringify(r, null, 2);

            if (feedback === epoch.points) { toast('占用已核对'); }
        }
    } catch (e) { if (own === ownerEpoch && feedback === epoch.points) { toast(e.message, 'error'); } } finally {
        ownerBusy = false;

        for (const id of ['ownerQuery', 'ownerRepair']) { $(id).disabled = false; }

        $('ownerResult').setAttribute('aria-busy', 'false');

        if (own === ownerEpoch && feedback === epoch.points) { restoreFocus(focus); }
    }
}

$('ownerQuery').onclick = () => occupancy(false);
$('ownerRepair').onclick = () => occupancy(true);
`;
