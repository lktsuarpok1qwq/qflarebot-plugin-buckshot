export const replayImportMarkup = String.raw`<div id="replayDrop" class="qb-card"><div class="actions"><button id="replayOpenLocal">打开本地回放</button><input id="replayFile" type="file" accept=".bs,application/octet-stream" hidden></div><p class="hint replay-file-help">可拖入 .bs 回放文件，最大 2 MiB（解压后）</p><p id="replayLocalNotice" role="status"></p></div>`;

export const replayToolsScript = String.raw`
let replaySourceKey = null, replayLocalStart = invalidateReplay, replayLocalDone = () => { };

function replayStep(raw) {
    return typeof raw === 'string' && /^\d{1,10}$/.test(raw) ? Number(raw) : 0;
}

function replayStepUrl() {
    const url = new URL('/p/buckshot/replay/', location.href);
    url.hash = new URLSearchParams({ key: replaySourceKey, step: String(replayPosition) }).toString();

    return url.href;
}

function updateReplayLink() {
    $('replayShare').hidden = !replaySourceKey;
    $('replayShareFallback').hidden = true;
    $('replayShareNotice').textContent = '';
}

$('replayShare').onclick = async () => {
    if (!replayData || !replaySourceKey) { return; }

    const own = replayEpoch, position = replayPosition, url = replayStepUrl();
    const current = () => own === replayEpoch && position === replayPosition && replaySourceKey;
    $('replayShare').disabled = true;

    try {
        if (!navigator.clipboard?.writeText) { throw Error('请手动复制'); }

        await Promise.race([navigator.clipboard.writeText(url), new Promise((_, reject) => setTimeout(() => reject(Error('复制超时')), 2000))]);

        if (current()) { $('replayShareNotice').textContent = '定位链接已复制'; }
    } catch {
        if (current()) {
            $('replayShareFallback').value = url;
            $('replayShareFallback').hidden = false;
            $('replayShareNotice').textContent = '请复制下方定位链接';
        }
    } finally { $('replayShare').disabled = false; }
};

async function openLocalReplay(file) {
    if (!file) { return; }

    replayLocalStart();
    $('replayDrop').classList.add('expanded');
    const own = replayEpoch;
    $('replayLocalNotice').textContent = '正在读取本地文件';
    $('replayDrop').setAttribute('aria-busy', 'true');

    try {
        if (file.size > replayContainer.max + 4096) { throw Error('回放文件超过大小限制'); }

        const bytes = new Uint8Array(await file.arrayBuffer());

        if (own !== replayEpoch) { return; }

        const data = await decodeReplayFile(bytes);

        if (own !== replayEpoch) { return; }

        loadReplayData(data);
        replayLocalDone();
        $('replayLocalNotice').textContent = '本地文件：' + file.name + '；未上传';
    } catch (error) {
        if (own === replayEpoch) { $('replayLocalNotice').textContent = error.message; }
    } finally {
        if (own === replayEpoch) { $('replayDrop').setAttribute('aria-busy', 'false'); }
    }
}

$('replayOpenLocal').onclick = () => $('replayFile').click();
$('replayFile').onchange = () => {
    const file = $('replayFile').files[0];
    $('replayFile').value = '';
    void openLocalReplay(file);
};
$('replayDrop').ondragover = event => { event.preventDefault(); };
$('replayDrop').ondrop = event => {
    event.preventDefault();

    if (event.dataTransfer.files.length !== 1) {
        $('replayLocalNotice').textContent = '每次请选择一个 .bs 文件';

        return;
    }

    void openLocalReplay(event.dataTransfer.files[0]);
};
`;
