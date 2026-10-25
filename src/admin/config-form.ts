import { parseMultiplier } from './multipliers.js';
import { parsePoints, formatPoints } from '../amounts.js';

export const configForm = 'const parseMultiplier = ' + parseMultiplier.toString() + ';\nconst parsePoints = ' + parsePoints.toString() + ';\nconst formatPoints = ' + formatPoints.toString() + ';\n' + String.raw`
const fields = [['showAIStyle', '显示庄家性格', 'boolean'], ['freeEnabled', '免费模式', 'boolean'], ['stakesEnabled', '积分下注', 'boolean'], ['turnSeconds', '操作时间（秒）', 'number'], ['recallSeconds', '自动撤回等待（秒，1～20）', 'number'], ['aiReadSeconds', 'AI 先手装填阅读时间（秒，0～10）', 'number'], ['aiDelaySeconds', 'AI 中断恢复延迟（秒）', 'number'], ['aiBudgetMs', 'AI 搜索预算（毫秒）', 'number'], ['minStake', '最小下注（积分，最多 2 位小数）', 'money'], ['maxStake', '最大下注（积分，最多 2 位小数）', 'money'], ['rewardLimit', '奖励上限（积分，最多 2 位小数）', 'money'], ['multipliers', '五档倍率（1～10 倍，最多 3 位小数）', 'multipliers']];
let configEpoch = 0, configBusy = false, loaded = null, baseline = '', pending = null;
let savedDraft = null;

function validateValues(value) {
    if (!value || typeof value !== 'object') { throw new Error('配置响应无效'); }

    for (const key of ['freeEnabled', 'stakesEnabled', 'showAIStyle']) {
        if (typeof value[key] !== 'boolean') { throw new Error('开关格式无效'); }
    }

    for (const [key, min, max] of [['turnSeconds', 20, 300], ['recallSeconds', 1, 20], ['aiReadSeconds', 0, 10], ['aiDelaySeconds', 1, 3], ['aiBudgetMs', 1, 8], ['minStake', 1, 1e12], ['maxStake', 1, 2.5e11], ['rewardLimit', 0, 1e12]]) {
        if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) {
            const error = new Error(fields.find(field => field[0] === key)[1] + '须为 ' + (['minStake', 'maxStake', 'rewardLimit'].includes(key) ? formatPoints(min) + '～' + formatPoints(max) + '，最多 2 位小数' : min + '～' + max + ' 的整数'));
            error.field = key;
            throw error;
        }
    }

    if (value.minStake > value.maxStake) { throw new Error('下注范围无效'); }

    if (!Array.isArray(value.multipliers) || value.multipliers.length !== 5 || value.multipliers.some(n => !Number.isSafeInteger(n) || n < 1000 || n > 10000)) { throw new Error('配置响应中的五档倍率无效'); }
}

function canonical(value) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }

function draft() {
    const value = {};

    for (const [key, , type] of fields) {
        const e = $('cfg-' + key);

        value[key] = type === 'boolean' ? e.checked : type === 'number' ? (e.value.trim() ? Number(e.value) : NaN) : type === 'money' ? e.value.trim() : [...e.querySelectorAll('input')].map(input => input.value);
    }

    return value;
}

function internal(value) {
    if (!Object.keys(value).length) { return value; }

    const amounts = {};

    for (const key of ['minStake', 'maxStake', 'rewardLimit']) {
        if (!Object.hasOwn(value, key)) { continue; }

        try { amounts[key] = parsePoints(value[key], key === 'rewardLimit'); } catch (error) {
            error.field = key;
            throw error;
        }
    }

    return {
        ...value, ...amounts, ...(value.multipliers ? {
            multipliers: value.multipliers.map((text, index) => {
                try { return parseMultiplier(text); } catch (error) {
                    error.field = 'multiplier-' + index;
                    throw error;
                }
            })
        } : {})
    };
}

function display(value) {
    const result = { ...value };

    for (const key of ['minStake', 'maxStake', 'rewardLimit']) { if (Object.hasOwn(value, key)) { result[key] = formatPoints(value[key]); } }

    if (value.multipliers) { result.multipliers = value.multipliers.map(n => String(n / 1000)); }

    return result;
}

function dirty() {
    if (!loaded) { return false; }

    try { return canonical(internal(draft())) !== canonical(internal(JSON.parse(baseline))); } catch { return true; }
}

function buttons() {
    $('configForm').setAttribute('aria-busy', String(configBusy));
    const changed = dirty();
    $('saveConfig').disabled = !changed || configBusy || !!pending;
    $('undoConfig').disabled = !changed || configBusy || !!pending;
    $('configStatus').textContent = pending ? '保存结果未知，请核对或重试原请求' : !loaded ? '尚未加载' : changed ? '有未保存修改' : '统一配置' + ' · 版本 ' + loaded.version;
    $('checkConfig').hidden = !pending;
    $('checkConfig').disabled = configBusy;
    $('loadConfig').disabled = configBusy || !!pending;

    for (const input of $('configForm').querySelectorAll('input')) { input.disabled = configBusy || !!pending; }
}

function fill(value) {
    const effective = value;

    for (const [key, , type] of fields) {
        const e = $('cfg-' + key);

        if (type === 'boolean') { e.checked = effective[key]; } else if (type === 'multipliers') { [...e.querySelectorAll('input')].forEach((input, i) => input.value = effective[key][i]); } else { e.value = effective[key]; }
    }
}

function loadForm(result) {
    loaded = result;
    $('configErrors').textContent = '';
    $('configForm').replaceChildren();

    const groups = [
        ['常用设置', ['freeEnabled', 'showAIStyle', 'turnSeconds', 'aiReadSeconds', 'recallSeconds'], '阅读时间默认 5 秒，0 表示不等待；仅装填后 AI 先手时生效，不占用玩家操作倒计时。装填公告至少保留到阅读结束；最新操作面板保留，旧面板成功替换后按撤回时间清理。'],
        ['积分与返还', ['stakesEnabled', 'minStake', 'maxStake', 'rewardLimit', 'multipliers'], '金额以积分填写，最多 2 位小数；输入 10 表示 10.00 积分。倍率包含本金，最多 3 位小数。'],
        ['高级设置', ['aiDelaySeconds', 'aiBudgetMs'], 'AI 中断恢复延迟仅用于后台接手未完成行动，默认 2 秒，可设 1～3 秒；正常请求直接推进。搜索预算默认 4 毫秒，可设 1～8 毫秒；无需调大，复杂局面同时受节点上限约束。每日挑战按固定节点计算。']
    ];
    const sections = new Map();

    for (const [title, keys, hint] of groups) {
        const folded = title !== '常用设置', section = document.createElement(folded ? 'details' : 'fieldset'), legend = document.createElement(folded ? 'summary' : 'legend'), help = document.createElement('p');
        section.className = 'config-section';
        legend.textContent = title;
        help.className = 'hint';
        help.textContent = hint;
        section.append(legend, help);
        $('configForm').append(section);

        for (const key of keys) { sections.set(key, section); }
    }

    const ordered = groups.flatMap(([, keys]) => keys).map(key => fields.find(field => field[0] === key));

    for (const [key, label, type] of ordered) {
        const row = document.createElement('div');
        row.className = 'row';
        const name = document.createElement('span');
        name.textContent = label;
        const e = document.createElement(type === 'multipliers' ? 'span' : 'input');
        e.id = 'cfg-' + key;
        e.setAttribute('aria-label', label);

        if (type === 'multipliers') {
            for (const difficulty of ['新手', '普通', '困难', '专家', '恶魔']) {
                const input = document.createElement('input');
                input.type = 'number';
                input.min = '1';
                input.max = '10';
                input.step = '0.001';
                input.inputMode = 'decimal';
                input.id = 'cfg-multiplier-' + e.children.length;
                input.setAttribute('aria-describedby', 'configErrors');
                input.oninput = () => input.removeAttribute('aria-invalid');
                input.setAttribute('aria-label', difficulty + '倍率');
                const label = document.createElement('label');
                label.textContent = difficulty;
                label.append(input);
                e.append(label);
            }
        } else { e.type = type === 'boolean' ? 'checkbox' : 'number'; }

        if (type === 'money') {
            e.min = key === 'rewardLimit' ? '0' : '0.01';
            e.max = key === 'maxStake' ? '2500000000' : '10000000000';
            e.step = '0.01';
            e.inputMode = 'decimal';
        }

        if (key === 'recallSeconds' || key === 'aiReadSeconds') {
            e.min = key === 'aiReadSeconds' ? '0' : '1';
            e.max = key === 'aiReadSeconds' ? '10' : '20';
            e.step = '1';
        }

        e.setAttribute('aria-describedby', 'configErrors');
        e.oninput = () => {
            $('configErrors').textContent = '';
            e.removeAttribute('aria-invalid');
            buttons();
        };
        const controls = document.createElement('div');
        controls.className = 'config-controls';

        controls.append(e);
        row.append(name, controls);
        sections.get(key).append(row);
    }

    fill(display(result.value));
    baseline = JSON.stringify(draft());
    $('configForm').hidden = false;
    buttons();
}

$('loadConfig').onclick = async () => {
    if (configBusy || pending) { return; }

    if (dirty() && !await confirmAction('重新加载会覆盖未保存修改')) { return; }

    configBusy = true;
    $('loadConfig').disabled = true;
    const own = ++configEpoch, feedback = epoch.config;

    try {
        const r = await api('/api/config');

        if (!Number.isSafeInteger(r.version) || r.version < 0) { throw new Error('配置响应无效'); }

        validateValues(r.value);

        if (own === configEpoch) {
            loadForm(r);

            if (savedDraft) {
                fill(savedDraft);
                buttons();
            }

            $('loadConfig').textContent = '重新加载配置';

            if (feedback === epoch.config) { toast('配置已加载'); }
        }
    } catch (e) { if (own === configEpoch && feedback === epoch.config) { toast(e.message, 'error'); } } finally {
        configBusy = false;
        $('loadConfig').disabled = false;
        buttons();

        if (own === configEpoch && feedback === epoch.config) { restoreFocus($('loadConfig')); }
    }
};
$('undoConfig').onclick = () => {
    fill(JSON.parse(baseline));
    buttons();
};

function acceptConfig(result, operation) {
    if (result.operationId !== operation.input.operationId || result.version !== operation.input.version + 1 || canonical(result.value) !== canonical(internal(operation.input.value))) { throw new Error('保存回执无效'); }

    if (loaded && configEpoch === operation.epoch) {
        loaded.version = result.version;
        loaded.value = result.value;

        validateValues(result.value);
        baseline = JSON.stringify(display(result.value));
        fill(JSON.parse(baseline));
    }

    savedDraft = null;
    pending = null;
    buttons();
}

async function save() {
    if (configBusy || pending || !loaded || !dirty()) { return; }

    const value = draft();

    try { validateValues(internal(value)); } catch (e) {
        $('configErrors').textContent = e.message;
        const field = e.field && $('cfg-' + e.field);

        if (field) {
            field.setAttribute('aria-invalid', 'true');
            const section = field.closest('details');

            if (section) { section.open = true; }

            field.focus();
        }

        return;
    }

    const snapshot = { version: loaded.version, epoch: configEpoch, feedback: epoch.config };

    // 先锁定处理器；模态确认期间保留触发按钮焦点，接受后再禁用表单。
    configBusy = true;

    try {
        if (!await confirmAction('保存配置，仅对之后创建的房间生效')) { return; }

        const feedback = snapshot.feedback;
        const operation = { feedback, input: { version: snapshot.version, value, operationId: crypto.randomUUID() }, epoch: snapshot.epoch };
        pending = operation;
        buttons();
        const result = await api('/api/config', operation.input);
        acceptConfig(result, operation);

        if (feedback === epoch.config && operation.epoch === configEpoch) { toast('配置已保存'); }
    } catch (e) { if (snapshot.epoch === configEpoch && snapshot.feedback === epoch.config) { toast(e.message, 'error'); } } finally {
        configBusy = false;
        buttons();

        if (snapshot.epoch === configEpoch && snapshot.feedback === epoch.config) { restoreFocus(pending ? $('checkConfig') : $('loadConfig')); }
    }
}

$('saveConfig').onclick = save;
$('checkConfig').onclick = async () => {
    if (configBusy || !pending) { return; }

    configBusy = true;
    buttons();
    const operation = pending, snapshot = { epoch: configEpoch, feedback: epoch.config };
    const feedback = text => { if (snapshot.epoch === configEpoch && snapshot.feedback === epoch.config) { toast(text); } };

    try {
        const r = await api('/api/operation?id=' + encodeURIComponent(operation.input.operationId));

        if (r.status === 'DONE') {
            acceptConfig(r.result, operation);
            feedback('保存结果已核对');
        } else if (r.status === 'REJECTED' && r.result?.operationId === operation.input.operationId) {
            savedDraft = operation.input.value;
            pending = null;

            if (loaded) {
                loaded = null;
                $('configForm').hidden = true;
            }

            feedback('原请求已拒绝；请重新加载配置，草稿已保留');
        } else if (r.status === 'NOT_FOUND') {
            const retry = await api('/api/config', operation.input);
            acceptConfig(retry, operation);
            feedback('原请求已完成');
        } else { throw new Error('结果尚未确定'); }
    } catch (e) { if (snapshot.epoch === configEpoch && snapshot.feedback === epoch.config) { toast(e.message, 'error'); } } finally {
        configBusy = false;
        buttons();

        if (snapshot.epoch === configEpoch && snapshot.feedback === epoch.config) { restoreFocus(pending ? $('checkConfig') : $('loadConfig')); }
    }
};
`;
