// 完整消息使用当前草稿和固定样例；来源标记只存在于浏览器，不保存、不发送。
export const PREVIEW_EDITOR_SCRIPT = String.raw`
function paintReplyPreview(config, key, mode, scenario, context) {
    const fragment = REPLY_FRAGMENTS[key], full = mode === 'sample' && fragment;
    const token = '\uE000' + crypto.randomUUID();
    const markers = { start: token + 'S\uE001', end: token + 'E\uE001' };
    const sample = replyPresentation.sample(config, key, scenario, full ? { key, ...markers } : undefined, context);
    const text = mode === 'layout' ? config.replies[key] : sample.text;
    const output = $('reply-preview-text');
    output.innerHTML = renderQQMarkdown(text, full ? markers : undefined);
    const marked = !!output.querySelector('mark,.sample-highlight');
    restoreReplyImages();
    $('reply-preview-notice').textContent = mode === 'layout' ? '变量保持原样 · 当前正文' : full
        ? !config.replies[key].trim() ? '当前片段为空' : marked ? '虚构数据 · 高亮部分为当前编辑片段' : text.includes(markers.start) ? '当前片段没有可显示的内容' : '当前情景没有使用此片段，或父消息草稿未引用其组成变量'
        : '虚构数据 · 使用当前正文与消息按钮草稿，不发送消息';
    $('reply-preview-title').textContent = '即时预览 · ' + (MESSAGE_KEYS.includes(key) || full ? '完整消息' : '当前片段');
    $('reply-preview-buttons').replaceChildren();

    for (const row of mode === 'layout' && !MESSAGE_KEYS.includes(key) ? [] : sample.buttons) {
        const line = document.createElement('div');
        line.className = 'actions';

        for (const item of row) {
            const button = document.createElement('button');
            button.className = 'qb-btn';
            button.textContent = item.label;
            button.disabled = true;
            line.append(button);
        }

        if (line.children.length) { $('reply-preview-buttons').append(line); }
    }
}
`;
