/* 浏览器本地合成音效，不加载外部音频；首次主动操作后启用。 */
const battleSound = (() => {
    let context, enabled = true;
    const sources = new Set(), buffers = new Map();
    const button = document.querySelector('#sound');

    function stop() {
        for (const source of sources) {
            try { source.stop(); } catch { /* 已结束的音源无需再次停止 */ }
        }

        sources.clear();
    }

    async function unlock(event) {
        if (!event.isTrusted || !enabled) { return; }

        const Audio = window.AudioContext || window.webkitAudioContext;

        if (!Audio) { return; }

        try {
            context ??= new Audio();

            if (context.state === 'suspended') { await context.resume(); }
        } catch { /* 声音不可用时，视觉反馈与操作照常进行 */ }
    }

    function buffer(kind) {
        if (buffers.has(kind)) { return buffers.get(kind); }

        const live = kind === 'live', duration = live ? .48 : .085;
        const value = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
        const samples = value.getChannelData(0);
        let noise = 0, random = 19870413;

        for (let i = 0; i < samples.length; i++) {
            const t = i / context.sampleRate;
            random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
            const white = random / 2147483648 - 1;
            noise = noise * .72 + white * .28;
            samples[i] = live
                ? .6 * white * Math.exp(-t * 45) + .42 * noise * Math.exp(-t * 9)
                + .26 * Math.sin(2 * Math.PI * 75 * t) * Math.exp(-t * 13)
                : .2 * white * Math.exp(-t * 220)
                + .14 * Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t * 100);
        }

        buffers.set(kind, value);

        return value;
    }

    function play(kind) {
        if (!enabled || !context || context.state !== 'running') { return; }

        try {
            const source = context.createBufferSource(), gain = context.createGain();
            source.buffer = buffer(kind);
            gain.gain.value = .42;
            source.connect(gain).connect(context.destination);
            source.onended = () => {
                sources.delete(source);
                source.disconnect();
                gain.disconnect();
            };
            sources.add(source);
            source.start();
        } catch { /* 合成音效失败不影响游戏结果 */ }
    }

    function sync() {
        const label = enabled ? '关闭音效' : '开启音效';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(enabled));
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/>${enabled ? '<path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>' : '<path d="m16 9 6 6m0-6-6 6"/>'}</svg>`;
    }

    button.onclick = () => {
        enabled = !enabled;

        if (!enabled) { stop(); }

        sync();
    };
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); } });
    window.addEventListener('pagehide', stop);
    sync();

    return { play, stop };
})();
