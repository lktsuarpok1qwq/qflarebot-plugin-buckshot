import { REPLY_FIELDS, REPLY_GROUPS, REPLY_VARIABLE_HELP, REPLY_FRAGMENTS, templateError, renderTemplate, escapeMarkdown } from '../../templates/replies.js';
import { DEFAULT_CONFIGURATION, MESSAGE_KEYS, BUTTON_ACTIONS, BUTTON_ACTION_HELP, DYNAMIC, REQUIRED, configurationError, safeHttpUrl } from '../../templates/reply-config.js';
import { renderQQMarkdown } from '../../templates/qq-markdown.js';
import { BUTTON_EDITOR_SCRIPT } from './buttons.js';
import { TEXT_EDITOR_SCRIPT } from './text.js';
import { PREVIEW_EDITOR_SCRIPT } from './preview.js';
import { IMAGE_EDITOR_SCRIPT } from './images.js';
import { createReplyPresentation } from '../../templates/presentation.js';

export const REPLY_EDITOR_HTML = String.raw`<section id="replies" role="tabpanel" class="qb-card" hidden>
<div class="reply-header"><h2>消息模板</h2><div class="actions"><span id="reply-status" class="hint" role="status" aria-live="polite">尚未加载</span><button id="reply-load" class="qb-btn">加载模板</button></div></div>
<p class="hint">使用 QQ Markdown 编辑正文，普通文字直接填写。预览使用示例数据，不发送消息；点击保存后生效。</p>
<div id="reply-controls" hidden><div class="grid"><label>模板分类<select id="reply-group" class="qb-input"></select></label><label id="reply-key-field">编辑分支<select id="reply-key" class="qb-input"></select></label></div>
<label id="reply-context-field" hidden>预览使用位置<select id="reply-context"></select></label><div id="reply-workspace" class="reply-workspace">
<div class="reply-source-tools"><h3><label id="reply-body-label" for="reply-body">模板正文</label></h3><p id="reply-uses" class="hint"></p><div id="reply-related" class="actions"></div><div id="reply-toolbar" class="actions" role="group" aria-label="Markdown 格式"></div><p id="reply-error" class="error" role="status" aria-live="polite" hidden></p></div>
<div class="reply-preview-tools"><h3 id="reply-preview-title">即时预览</h3><div class="actions" role="group" aria-label="预览模式"><button id="reply-sample" class="qb-btn" aria-pressed="true">情景预览</button><button id="reply-layout" class="qb-btn" aria-pressed="false">排版预览</button></div>
<label id="reply-scenario-field" hidden>情景<select id="reply-scenario" class="qb-input"></select></label></div>
<textarea id="reply-body" class="qb-input qb-mono" rows="10" spellcheck="false" aria-describedby="reply-uses reply-hint reply-error"></textarea>
<div id="reply-preview" class="reply-preview"><div class="reply-preview-scroll"><div id="reply-preview-text"></div><div id="reply-preview-buttons"></div></div></div>
<div class="reply-assistance"><div id="reply-separator-field" hidden><label for="reply-separator">玩家项目间隔</label><textarea id="reply-separator" class="qb-input qb-mono" rows="2" aria-describedby="reply-separator-hint reply-separator-error"></textarea><p id="reply-separator-hint" class="hint">支持空行和 Markdown 分隔线；留空表示直接连接所有项目。与完整房间面板及单个片段共用</p><p id="reply-separator-error" class="error" role="status" hidden></p></div><p id="reply-hint" class="hint"></p><h3>当前位置可用变量</h3><div id="reply-variables" class="actions" role="group" aria-label="插入变量" hidden></div></div></div>
<p id="reply-preview-notice" class="hint" role="status"></p>
<p class="hint">预览按 QQ 文档格式近似显示，实际效果以 QQ 为准。支持标题、文字样式、链接、图片、列表、引用和分割线；不执行 HTML。</p>
<section id="reply-buttons-section"><h3>消息按钮</h3><p class="hint">最多 5 行、每行 5 个按钮，文字最多 10 字，按固定文字显示，不替换模板变量。游戏操作、确认和翻页凭据由程序生成；按钮按当前状态显示。选择按钮允许 {{number}}，按合法操作自动展开。</p><div id="reply-buttons-editor"></div></section>
<div id="reply-actions" class="actions"><button id="reply-save" class="qb-btn qb-btn--primary">保存全部修改</button><button id="reply-default" class="qb-btn">恢复当前默认</button><button id="reply-discard" class="qb-btn">撤销全部修改</button></div><button id="reply-recover" hidden>核对保存结果</button><p class="hint">恢复默认先修改当前分支草稿。切换分支会保留草稿；离开宿主页面前请保存。</p></div></section>`;
export const REPLY_EDITOR_STYLE = String.raw`.reply-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.reply-header h2{margin:0}.reply-header .actions{align-items:center;justify-content:flex-end;margin:0}#replies .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#replies label{min-width:0}#replies .grid>label{display:flex;flex-direction:column}#replies select,#replies input,#replies textarea{min-width:0;max-width:100%}.reply-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"source-tools preview-tools" "source preview" "assistance assistance";gap:16px 24px;margin-top:20px}.reply-workspace>div{min-width:0}.reply-source-tools{grid-area:source-tools}.reply-preview-tools{grid-area:preview-tools}.reply-assistance{grid-area:assistance}.reply-workspace h3{margin:0 0 8px}.reply-workspace .actions{margin:8px 0}#reply-body{grid-area:source;width:100%;height:320px;min-height:280px;margin:0;box-sizing:border-box;resize:vertical;line-height:1.6}#reply-variables{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.reply-variable{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;align-self:start;gap:6px 8px;min-width:0}.reply-variable>button{justify-self:start;font-family:var(--qb-font-mono)}.reply-variable-composition{grid-column:1/-1;min-width:0}.reply-variable>.hint{margin:0;line-height:1.6;overflow-wrap:anywhere}.reply-preview{grid-area:preview;position:relative;min-width:0;min-height:0;background:var(--qb-surface-muted);border:1px solid var(--qb-border);border-radius:var(--qb-radius);box-sizing:border-box}.reply-preview-scroll{position:absolute;inset:0;overflow:auto;padding:16px}#reply-preview-text{overflow-wrap:anywhere;line-height:1.65}#reply-preview-text mark{background:var(--qb-warning-bg);color:inherit;outline:1px solid var(--qb-warning);border-radius:2px}#reply-preview-text .sample-highlight{background:var(--qb-warning-bg)}#reply-preview-text h1{font-size:22px}#reply-preview-text h2{font-size:18px}#reply-preview-text blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--qb-border-strong);color:var(--qb-fg-muted)}.reply-image{display:inline-block;max-width:100%;overflow-wrap:anywhere}.reply-image [data-image-content]{display:inline-block;max-width:100%}.reply-image img{display:block}.reply-variable dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px}.reply-variable dt{font-family:var(--qb-font-mono)}.reply-variable dd{margin:0}#reply-preview-text img{max-width:100%;height:auto}#reply-preview-text a{color:var(--qb-accent)}#reply-preview-buttons .actions{flex-wrap:nowrap;align-items:stretch}#reply-preview-buttons button{min-width:0;flex:1 1 0;height:auto;padding:8px;justify-content:center;line-height:1.5;overflow-wrap:anywhere;white-space:normal}#reply-body[aria-invalid=true]{border-color:var(--qb-danger)}#replies .qb-btn{border:1px solid var(--qb-border-strong)}#replies [aria-pressed=true]{background:var(--qb-primary);color:var(--qb-on-primary)}.reply-button-row{border-top:1px solid var(--qb-border);margin:16px 0;padding-top:8px}.reply-button-row>.actions{align-items:center}.reply-button-item{padding:12px;margin:8px 0;background:var(--qb-surface-muted);border-radius:var(--qb-radius)}@media(max-width:700px){.reply-workspace{grid-template-columns:minmax(0,1fr);grid-template-areas:"source-tools" "source" "preview-tools" "preview" "assistance";gap:12px}.reply-preview{height:var(--reply-editor-height,320px)}.reply-button-item .grid{grid-template-columns:minmax(0,1fr)}}@media(pointer:coarse){.reply-variable summary{min-height:var(--qb-touch-min);box-sizing:border-box;padding-block:12px;cursor:pointer}}`;

const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
export const REPLY_EDITOR_SCRIPT = [
    'const REPLY_VARIABLE_HELP=' + json(REPLY_VARIABLE_HELP) + ', REPLY_FRAGMENTS=' + json(REPLY_FRAGMENTS) + ', REPLY_FIELDS=' + json(REPLY_FIELDS) + ', replyGroups=' + json(REPLY_GROUPS) + ', DEFAULT_CONFIGURATION=' + json(DEFAULT_CONFIGURATION) + ', MESSAGE_KEYS=' + json(MESSAGE_KEYS) + ', BUTTON_ACTIONS=' + json(BUTTON_ACTIONS) + ', BUTTON_ACTION_HELP=' + json(BUTTON_ACTION_HELP) + ';',
    'const templateError=' + templateError.toString() + ';',
    'const renderTemplate=' + renderTemplate.toString() + ';',
    'const escapeMarkdown=' + escapeMarkdown.toString() + ';',
    'const createReplyPresentation=' + createReplyPresentation.toString() + ';const replyPresentation=createReplyPresentation(renderTemplate,escapeMarkdown,REPLY_FIELDS);',
    'const safeHttpUrl=' + safeHttpUrl.toString() + ';',
    'const configurationError=' + configurationError.toString() + ';',
    'const renderQQMarkdown=' + renderQQMarkdown.toString() + ';',
    'const DYNAMIC=' + JSON.stringify(DYNAMIC) + ';',
    'const REQUIRED=' + JSON.stringify(REQUIRED) + ';',
    BUTTON_EDITOR_SCRIPT,
    TEXT_EDITOR_SCRIPT,
    IMAGE_EDITOR_SCRIPT,
    PREVIEW_EDITOR_SCRIPT,
    String.raw`
function createReplyEditor() {
    const keys = Object.keys(REPLY_FIELDS), groups = [...new Set(Object.values(replyGroups))];
    let replyContext;
    let baseline, drafts, revision, pending, key = keys[0], mode = 'sample', busy = false, rendered = false;
    const positions = new Map(), branchesByGroup = new Map(), contextsByKey = new Map();
    const positionKey = () => replyGroups[key] + ':' + key + ':' + (replyContext ?? '');
    const clone = value => structuredClone(value);
    const applySettings = data => {
        const config = { replies: data?.replies, buttons: data?.buttons, ...(data?.historySeparator !== undefined ? { historySeparator: data.historySeparator } : {}) };

        if (!Number.isSafeInteger(data?.revision) || data.revision < 0 || configurationError(config)) {
            throw Error('模板响应不符合要求，草稿已保留，请重新加载或原样重试');
        }

        revision = data.revision;
        baseline = config;
        drafts = clone(config);
        $('reply-controls').hidden = false;
        edit(key);
    };
    const dirty = () => baseline && JSON.stringify(drafts) !== JSON.stringify(baseline);
    const status = () => {
        $('reply-status').textContent = busy ? '正在处理…' : !baseline ? '尚未加载' : pending ? '保存结果未知，请核对' : dirty() ? '有未保存的修改' : '暂无未保存修改';
        $('reply-load').textContent = baseline ? '重新加载' : '加载模板';
        $('reply-save').disabled = busy || !!pending || !dirty();
        $('reply-recover').hidden = !pending;
        $('reply-discard').disabled = busy || !!pending || !dirty();
    };
    const setBusy = value => {
        busy = value;
        $('replies').setAttribute('aria-busy', String(value));
        $('replies').querySelectorAll('button:not(#reply-preview-buttons button),input,select,textarea').forEach(control => { control.disabled = value || !!pending && control.id !== 'reply-recover' || control.dataset.inactive === 'true'; });
        restoreReplyImages();
        status();
    };
    const option = (parent, value, title) => {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = title;
        parent.append(item);
    };
    groups.forEach(group => option($('reply-group'), group, group));
    const buttonEditor = createButtonEditor(() => ({ config: drafts, key }), preview);

    const { insert, retainSelection } = createTextTools($('reply-body'), () => {
        drafts.replies[key] = $('reply-body').value;
        preview();
    });
    retainSelection($('reply-toolbar'));
    retainSelection($('reply-variables'));

    for (const [title, before, after, fallback] of [['一级标题', '# ', '', '标题'], ['二级标题', '## ', '', '标题'], ['加粗', '**', '**', '文字'], ['斜体', '*', '*', '文字'], ['粗斜体', '***', '***', '文字'], ['删除线', '~~', '~~', '文字'], ['引用', '> ', '', '引用内容'], ['无序列表', '- ', '', '列表项'], ['有序列表', '1. ', '', '列表项'], ['嵌套列表', '    - ', '', '列表项'], ['链接', '[', '](https://example.com)', '链接文字'], ['图片', '![', '](https://example.com/image.png)', '图片说明'], ['分割线', '\n***\n', '', '']]) {
        const button = document.createElement('button');
        button.textContent = title;
        button.className = 'qb-btn';
        button.onclick = () => insert(before, after, fallback, false, ['一级标题', '二级标题', '引用', '无序列表', '有序列表', '嵌套列表'].includes(title));
        $('reply-toolbar').append(button);
    }

    // 正文决定内容行高度；只在窄屏同步预览外框，不形成高度反馈循环。
    new ResizeObserver(() => {
        const height = $('reply-body').getBoundingClientRect().height;

        if (height > 0) { $('reply-workspace').style.setProperty('--reply-editor-height', height + 'px'); }
    }).observe($('reply-body'));

    function refreshScenarios() {
        let choices;

        try { choices = replyPresentation.scenarios(drafts, key, replyContext); } catch { choices = [['normal', '示例']]; }

        const select = $('reply-scenario'), previous = select.value || positions.get(positionKey())?.scenario;
        const current = [...select.options].map(item => [item.value, item.textContent]);

        if (JSON.stringify(current) !== JSON.stringify(choices)) {
            select.replaceChildren();
            choices.forEach(([value, title]) => option(select, value, title));
            select.value = choices.some(([value]) => value === previous) ? previous : choices[0][0];
        }

        $('reply-scenario-field').hidden = mode === 'layout' || choices.length === 1;
    }

    function preview() {
        refreshScenarios();
        const error = configurationError(drafts, key), field = REPLY_FIELDS[key];
        const current = error && (error.field === key || (field.parents ?? [field.parent]).includes(error.field)) ? error : null;
        $('reply-body').setAttribute('aria-invalid', String(current?.target === 'text'));
        const before = current ? drafts.replies[key].slice(0, current.start).split('\n') : [];
        $('reply-error').textContent = current ? (current.field !== key ? REPLY_FIELDS[current.field].title + '：' : '') + current.message + (current.target === 'text' ? '（第 ' + before.length + ' 行，第 ' + (before.at(-1).length + 1) + ' 列）' : '') : '';
        $('reply-error').hidden = !current || current.target !== 'text';
        buttonEditor.validate(current?.target === 'buttons' ? current : null);
        const separatorError = error?.target === 'historySeparator' ? error.message : '';
        $('reply-separator').setAttribute('aria-invalid', String(!!separatorError));
        $('reply-separator-error').textContent = separatorError;
        $('reply-separator-error').hidden = !separatorError;

        try { paintReplyPreview(drafts, key, mode, $('reply-scenario').value, replyContext); } catch (error) {
            $('reply-preview-text').textContent = error.message;
            $('reply-preview-buttons').replaceChildren();
        }

        $('reply-sample').setAttribute('aria-pressed', String(mode === 'sample'));
        $('reply-layout').setAttribute('aria-pressed', String(mode === 'layout'));
        $('reply-hint').textContent = (field.variables.length ? '{{变量名}} 是占位符，发送时会替换为对应内容；点击下方变量插入到光标处' : '此模板没有可用变量，直接填写文字或 Markdown') + (field.required ? '；必须保留：' + field.required.map(name => '{{' + name + '}}').join('、') : '') + (field.parent ? '；使用位置见上方说明，可切换完整消息预览' : '');
        $('reply-variables').hidden = !field.variables.length;
        status();
    }

    function rememberPosition() {
        if (!rendered) { return; }

        const body = $('reply-body'), previous = positions.get(positionKey());
        positions.set(positionKey(), {
            start: body.selectionStart, end: body.selectionEnd, direction: body.selectionDirection,
            scrollTop: body.getClientRects().length ? body.scrollTop : previous?.scrollTop || 0, scenario: $('reply-scenario').value
        });
    }

    function edit(name, context) {
        rememberPosition();
        key = name;
        branchesByGroup.set(replyGroups[key], key);
        $('reply-group').value = replyGroups[key];
        $('reply-key').replaceChildren();
        const branches = keys.filter(name => replyGroups[name] === replyGroups[key]);
        branches.forEach(name => option($('reply-key'), name, REPLY_FIELDS[name].title));
        $('reply-key-field').hidden = branches.length === 1;
        $('reply-body-label').textContent = '模板正文' + (branches.length === 1 ? ' · ' + REPLY_FIELDS[key].title : '');
        $('reply-key').value = key;
        $('reply-body').value = drafts.replies[key];
        const fragment = REPLY_FRAGMENTS[key];
        const contexts = REPLY_FIELDS[key].parents ?? (fragment ? [fragment.message] : []);
        replyContext = contexts.includes(context ?? contextsByKey.get(key)) ? (context ?? contextsByKey.get(key)) : contexts[0];
        contextsByKey.set(key, replyContext);
        $('reply-context').replaceChildren();
        contexts.forEach(k => option($('reply-context'), k, REPLY_FIELDS[k].title));
        $('reply-context').value = replyContext ?? '';
        $('reply-context-field').hidden = contexts.length < 2;
        $('reply-uses').textContent = fragment ? '共享片段 · 用于“' + contexts.map(k => REPLY_FIELDS[k].title).join('”“') + '”，保存后所有引用同步生效' : '用于“' + REPLY_FIELDS[key].title + '”消息';
        $('reply-related').replaceChildren();
        const related = fragment ? contexts : Object.keys(REPLY_FRAGMENTS).filter(k => (REPLY_FIELDS[k].parents ?? [REPLY_FRAGMENTS[k].message]).includes(key));

        for (const target of related) {
            const button = document.createElement('button');
            button.className = 'qb-btn';
            button.textContent = '编辑' + (target === 'panel' ? '完整房间面板' : REPLY_FIELDS[target].title);
            button.onclick = () => {
                edit(target, fragment ? undefined : key);
                $('reply-body').focus();
            };
            $('reply-related').append(button);
        }

        $('reply-related').hidden = !related.length;
        $('reply-separator-field').hidden = !['panel', 'member', 'player'].includes(key);
        $('reply-separator').value = drafts.historySeparator ?? replyPresentation.defaultSeparator;
        $('reply-scenario').replaceChildren();
        $('reply-buttons-section').hidden = !MESSAGE_KEYS.includes(key) || !!replyContext && replyContext !== key;
        $('reply-variables').replaceChildren();

        for (const name of REPLY_FIELDS[key].variables) {
            const button = document.createElement('button');
            button.className = 'qb-btn';
            button.textContent = '{{' + name + '}}';
            button.onclick = () => insert('{{' + name + '}}', '', '', true);
            const item = document.createElement('div'), description = document.createElement('span');
            item.className = 'reply-variable';
            description.className = 'hint';
            description.id = 'reply-variable-' + name;
            description.textContent = (['items', 'summary', 'inventory'].includes(name) ? '已渲染片段：' : '普通数据：') + (REPLY_FIELDS[key].variableHelp?.[name] || REPLY_VARIABLE_HELP[name]);
            button.setAttribute('aria-describedby', description.id);
            item.append(button, description);

            const composition = REPLY_FIELDS[key].compositions?.[name];

            if (composition) {
                const details = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('p');
                details.className = 'reply-variable-composition hint';
                summary.textContent = '查看组成';
                content.textContent = composition.description;
                const fields = document.createElement('dl');

                for (const child of [...new Set(composition.fields.flatMap(field => REPLY_FIELDS[field].variables))]) {
                    const term = document.createElement('dt'), meaning = document.createElement('dd');
                    term.textContent = '{{' + child + '}}';
                    meaning.textContent = REPLY_VARIABLE_HELP[child];
                    fields.append(term, meaning);
                }

                details.append(fields);
                details.prepend(summary, content);
                item.append(details);
            }

            $('reply-variables').append(item);
        }

        buttonEditor.draw();
        preview();
        rendered = true;
        const position = positions.get(positionKey()), body = $('reply-body');

        if (position) {
            body.setSelectionRange(Math.min(position.start, body.value.length), Math.min(position.end, body.value.length), position.direction);
            body.scrollTop = position.scrollTop;
        }
    }

    async function run(action) {
        if (busy) { return; }

        const focus = document.activeElement, view = epoch.replies;
        setBusy(true);

        try { await action(); } catch (error) {
            if (view === epoch.replies) { editorNotice(error.message || String(error), true); }
        } finally {
            setBusy(false);

            if (view === epoch.replies) { restoreFocus(focus, $('reply-body')); }
        }
    }

    $('reply-recover').onclick = () => run(async () => {
        if (!pending) { return; }

        const result = await api('/api/template-operation?id=' + encodeURIComponent(pending.operationId));

        if (result.status === 'DONE') {
            applySettings(result.result);
            pending = null;
        } else if (result.status === 'REJECTED') {
            pending = null;
            editorNotice(result.result.error, true);
        } else { editorNotice('尚无结果，保留草稿与原编号，稍后核对', true); }

        status();
    });
    $('reply-load').onclick = () => run(async () => {
        const view = epoch.replies;

        if (pending) { throw Error('请先核对未决保存'); }

        if (dirty() && !await confirmAction('重新加载会丢弃全部模板草稿，是否继续？')) { return; }

        if (view !== epoch.replies) { return; }

        const data = await api('/api/templates');
        const displayed = view === epoch.replies;

        if (displayed) { applySettings(data); }

        if (displayed) { editorNotice('模板已加载'); }
    });
    $('reply-body').addEventListener('select', rememberPosition);
    $('reply-body').addEventListener('scroll', rememberPosition);
    $('reply-group').onchange = () => edit(branchesByGroup.get($('reply-group').value) || keys.find(name => replyGroups[name] === $('reply-group').value));
    $('reply-key').onchange = () => edit($('reply-key').value);
    $('reply-body').oninput = () => {
        drafts.replies[key] = $('reply-body').value;
        preview();
    };
    $('reply-separator').oninput = () => {
        drafts.historySeparator = $('reply-separator').value;
        preview();
    };
    $('reply-scenario').onchange = preview;
    $('reply-context').onchange = () => {
        edit(key, $('reply-context').value);
    };
    $('reply-sample').onclick = () => {
        mode = 'sample';
        preview();
    };
    $('reply-layout').onclick = () => {
        mode = 'layout';
        preview();
    };
    $('reply-default').onclick = () => run(async () => {
        const current = key, view = epoch.replies, fragment = REPLY_FRAGMENTS[key];
        const impact = (fragment ? '；影响“' + (REPLY_FIELDS[key].parents ?? [fragment.message]).map(k => REPLY_FIELDS[k].title).join('”“') + '”的全部引用' : '；包含本分支的消息按钮') + (['panel', 'member', 'player'].includes(key) ? '及共用的玩家项目间隔' : '');

        if (!await confirmAction('恢复“' + REPLY_FIELDS[key].title + '”的默认草稿' + impact + '，保存后生效')) { return; }

        if (view !== epoch.replies || current !== key) { return; }

        drafts.replies[key] = DEFAULT_CONFIGURATION.replies[key];

        if (['panel', 'member', 'player'].includes(key)) { delete drafts.historySeparator; }

        if (MESSAGE_KEYS.includes(key)) {
            drafts.buttons[key] = clone(DEFAULT_CONFIGURATION.buttons[key]);
        }

        edit(key);
    });
    $('reply-discard').onclick = () => run(async () => {
        if (!dirty()) { return; }

        const view = epoch.replies;

        if (await confirmAction('撤销全部未保存的模板修改，是否继续？') && view === epoch.replies) {
            drafts = clone(baseline);
            edit(key);
        }
    });
    $('reply-save').onclick = () => {
        if (busy || !dirty()) { return; }

        refreshScenarios();
        const error = configurationError(drafts);

        if (error) {
            edit(error.field);
            const field = error.target === 'text' ? $('reply-body') : error.target === 'historySeparator' ? $('reply-separator') : buttonEditor.validate(error);

            if (field) {
                field.focus();

                if (error.target === 'text') { field.setSelectionRange(error.start, error.end); }
            }

            editorNotice(REPLY_FIELDS[error.field].title + '：' + error.message, true);

            return;
        }

        return run(async () => {
            const view = epoch.replies;
            const request = { operationId: crypto.randomUUID(), expectedRevision: revision, ...clone(drafts) };
            pending = request;
            status();

            try {
                const result = await api('/api/templates', request);

                if (result.operationId !== request.operationId) { throw Error('模板回执不符'); }

                applySettings(result);
                pending = null;
            } catch (error) {
                $('reply-recover').hidden = false;
                throw error;
            }

            if (view === epoch.replies) { editorNotice('消息模板已保存'); }
        });
    };
}

function editorNotice(text, error = false) { toast(text, error ? 'error' : 'success'); }

createReplyEditor();
`
].join('\n');
