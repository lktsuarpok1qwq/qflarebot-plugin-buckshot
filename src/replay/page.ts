import { REPLAY_FILE } from './access.js';
import { replayImportMarkup } from './viewer/tools.js';
import { replayStyle, replayViewerMarkup, replayPlayerScript } from './viewer/player.js';

// 独立页面不使用管理 Bridge，不读取面板凭据，不提供公开列表。
export const replayPage = String.raw`<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>恶魔轮盘 · 对局回放</title><link rel="stylesheet" href="/tokens.css"><style>
*{box-sizing:border-box}body{margin:0;color:var(--qb-fg);background:var(--qb-bg);font:16px/1.6 var(--qb-font-sans)}main{max-width:1600px;margin:auto;padding:20px}.qb-card{padding:18px;margin-bottom:16px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}button,select,input{font:inherit;color:var(--qb-fg);background:var(--qb-surface);border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius);padding:8px 12px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--qb-ring)}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:24px;margin:0}.replay-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px}#replayTheme{min-width:110px;min-height:44px;border-radius:var(--qb-radius-full)}.hint{color:var(--qb-fg-muted)}a{color:var(--qb-on-primary);text-decoration:underline}${replayStyle}
</style></head><body class="qb-page"><main id="replay"><header class="replay-heading"><h1>🎲 对局回放</h1><button id="replayTheme" type="button" aria-label="切换到白天模式">白天模式</button></header>${replayImportMarkup}<p id="notice" role="status"></p><button id="retryFailed" hidden>重试加载</button>${replayViewerMarkup}</main><script type="module">
const $ = id => document.getElementById(id);
$('replayTheme').onclick = () => {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    $('replayTheme').textContent = light ? '黑夜模式' : '白天模式';
    $('replayTheme').setAttribute('aria-label', light ? '切换到黑夜模式' : '切换到白天模式');
};
function toast(text) { $('notice').textContent = text; }
${replayPlayerScript}
replayLocalStart = () => {
    invalidateReplay();
    history.replaceState(null, '', location.pathname + location.search);
    $('retry').hidden = true;
    $('notice').textContent = '';
    $('retryFailed').hidden = true;
};
async function loadSharedReplay(force = false) {
    const params = new URLSearchParams(location.hash.slice(1)), key = params.get('key') || '', position = replayStep(params.get('step'));
    if (!force && key && replayData && replaySourceKey === key) { selectReplay(position); return; }
    invalidateReplay(); const own = replayEpoch;
    $('retry').hidden = !key;
    $('retryFailed').hidden = true;
    $('replayDrop').classList.toggle('expanded', !key);
    if (!key) { toast('可打开本地 .bs 文件，或通过对局链接查看回放'); return; }
    $('retry').disabled = true;
    toast('正在加载指定对局');
    try {
        const { data } = await replayReadWithin(async () => {
            const response = await fetch('/p/buckshot/api/replay-shared?key=' + encodeURIComponent(key), {credentials:'omit',cache:'no-store'});
            return readReplayFile(response);
        });
        if (own !== replayEpoch) { return; }
        const gameId = key.split('/').at(-1).match(${REPLAY_FILE})?.[5];
        if (data.game?.id !== gameId) { throw Error('回放场次不符'); }
        loadReplayData(data, key, position); toast('');
    } catch (error) { if (own === replayEpoch) { toast(error.message); $('retryFailed').hidden = false; } }
    finally { if (own === replayEpoch) { $('retry').disabled = false; } }
}
$('retry').onclick = $('retryFailed').onclick = () => loadSharedReplay(true);
window.addEventListener('hashchange', () => loadSharedReplay());
loadSharedReplay();
</script></body></html>`;
