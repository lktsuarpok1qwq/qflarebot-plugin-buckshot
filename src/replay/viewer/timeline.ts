export const replayTimelineStyle = String.raw`
#replayTimeline{height:420px;overflow:auto;scrollbar-gutter:stable;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--qb-border-strong) transparent;padding:4px;box-sizing:border-box}
#replayTimeline button{display:block;width:100%;min-width:0;min-height:56px;margin:0 0 6px;padding:8px 10px;text-align:left;border:1px solid transparent;border-radius:var(--qb-radius);background:var(--qb-surface-muted);color:var(--qb-fg);font:inherit;cursor:pointer}
#replayTimeline button[aria-current=step]{border-color:var(--qb-primary);background:var(--qb-primary-hover)}
#replayTimeline button:focus-visible{outline:2px solid var(--qb-ring);outline-offset:-2px}
#replayTimeline strong{display:block;font-size:14px;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
.replay-actors{display:flex;min-width:0;margin-top:4px;color:var(--qb-fg-muted);font-size:12px;line-height:1.5}
.replay-actors span{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.replay-actors i{flex:none;font-style:normal;white-space:pre}
@media(max-width:600px){#replayTimeline{height:180px}}
`;

export const replayTimelineScript = String.raw`
let replayTimelineSelected = null, replayTimelineManualUntil = 0;

function buildReplayTimeline() {
    replayTimelineSelected = null;
    replayTimelineManualUntil = 0;
    $('replayTimeline').replaceChildren(...replayData.steps.map((step, index) => {
        const button = document.createElement('button'), action = document.createElement('strong'), actors = document.createElement('div');
        button.type = 'button';
        button.dataset.step = String(index);
        button.tabIndex = -1;
        action.textContent = index + ' · ' + replayActionLabel({ ...step.action, target: undefined }, null);
        actors.className = 'replay-actors';
        const source = document.createElement('span');
        source.textContent = replayName(step.actor);
        actors.append(source);

        if (step.action.target) {
            const arrow = document.createElement('i'), target = document.createElement('span');
            arrow.textContent = ' → ';
            target.textContent = replayName(step.action.target);
            actors.append(arrow, target);
        }

        button.title = action.textContent + '\n' + actors.textContent;
        button.setAttribute('aria-label', button.title);
        button.append(action, actors);

        return button;
    }));
}

function syncReplayTimeline() {
    const list = $('replayTimeline'), selected = list.children[replayPosition];
    list.dataset.position = String(replayPosition);

    if (replayTimelineSelected !== selected) {
        if (replayTimelineSelected) {
            replayTimelineSelected.removeAttribute('aria-current');
            replayTimelineSelected.tabIndex = -1;
        }

        selected.setAttribute('aria-current', 'step');
        selected.tabIndex = 0;
        replayTimelineSelected = selected;
    }

    if (Date.now() < replayTimelineManualUntil) { return; }

    const bounds = list.getBoundingClientRect(), item = selected.getBoundingClientRect();

    if (item.top < bounds.top) { list.scrollTop += item.top - bounds.top; } else if (item.bottom > bounds.bottom) { list.scrollTop += item.bottom - bounds.bottom; }
}

$('replayTimeline').onclick = event => {
    const button = event.target.closest('button[data-step]');

    if (button) {
        replayTimelineManualUntil = 0;
        selectReplay(Number(button.dataset.step));
    }
};
$('replayTimeline').onkeydown = event => {
    const button = event.target.closest('button[data-step]');

    if (!button || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }

    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? replayData.steps.length - 1 : Math.max(0, Math.min(replayData.steps.length - 1, Number(button.dataset.step) + (event.key === 'ArrowDown' ? 1 : -1)));
    replayTimelineManualUntil = 0;
    selectReplay(index);
    $('replayTimeline').children[index].focus({ preventScroll: true });
};

for (const name of ['wheel', 'touchstart', 'pointerdown']) {
    $('replayTimeline').addEventListener(name, () => { replayTimelineManualUntil = Date.now() + 5000; }, { passive: true });
}
`;
