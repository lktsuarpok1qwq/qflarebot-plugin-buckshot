import { parseMultiplier } from './multipliers.js';
import { parsePoints, formatPoints } from '../amounts.js';

export const configForm = 'const parseMultiplier = ' + parseMultiplier.toString() + ';\nconst parsePoints = ' + parsePoints.toString() + ';\nconst formatPoints = ' + formatPoints.toString() + ';\n' + String.raw`
const fields = [['dailyReward', '每日挑战奖励', 'money'], ['showAIStyle', '显示庄家性格', 'boolean'], ['freeEnabled', '免费模式', 'boolean'], ['stakesEnabled', '积分下注', 'boolean'], ['turnSeconds', '操作时间', 'number'], ['recallSeconds', '撤回等待', 'number'], ['aiReadSeconds', '装填阅读时间', 'number'], ['aiDelaySeconds', 'AI 恢复延迟', 'number'], ['aiBudgetMs', 'AI 搜索预算', 'number'], ['minStake', '最小下注', 'money'], ['maxStake', '最大下注', 'money'], ['rewardLimit', '单局奖励上限', 'money'], ['multipliers', '五档倍率', 'multipliers']];
const integerLimits = { turnSeconds: [20, 300], recallSeconds: [1, 20], aiReadSeconds: [0, 10], aiDelaySeconds: [1, 3], aiBudgetMs: [1, 8] };
const hints = { dailyReward: '积分，最多 2 位小数；0 不发奖', turnSeconds: '20～300 秒，整数', recallSeconds: '1～20 秒，整数', aiReadSeconds: '0～10 秒，整数；仅 AI 先手时等待', aiDelaySeconds: '1～3 秒，整数；中断后接手行动', aiBudgetMs: '1～8 毫秒，整数；每日挑战使用固定搜索量', minStake: '积分，最多 2 位小数', maxStake: '积分，最多 2 位小数', rewardLimit: '下注局的奖励上限，最多 2 位小数', multipliers: '1～10 倍，含本金，最多 3 位小数' };
let configEpoch = 0, configBusy = false, loaded = null, baseline = '', pending = null;
let savedDraft = null;

function validateValues(value) {
    if (!value || typeof value !== 'object') { throw new Error('配置响应无效'); }

    for (const key of ['freeEnabled', 'stakesEnabled', 'showAIStyle']) {
        if (typeof value[key] !== 'boolean') { throw new Error('开关格式无效'); }
    }

    for (const [key, min, max] of [['turnSeconds', 20, 300], ['recallSeconds', 1, 20], ['aiReadSeconds', 0, 10], ['aiDelaySeconds', 1, 3], ['aiBudgetMs', 1, 8], ['dailyReward', 0, 1e12], ['minStake', 1, 1e12], ['maxStake', 1, 2.5e11], ['rewardLimit', 0, 1e12]]) {
        if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) {
            const error = new Error(fields.find(field => field[0] === key)[1] + '须为 ' + (['minStake', 'maxStake', 'rewardLimit', 'dailyReward'].includes(key) ? formatPoints(min) + '～' + formatPoints(max) + '，最多 2 位小数' : min + '～' + max + ' 的整数'));
            error.field = key;
            throw error;
        }
    }

    if (value.minStake > value.maxStake) { throw new Error('下注范围无效'); }

    if (!Array.isArray(value.multipliers) || value.multipliers.length !== 5 || value.multipliers.some(n => !Number.isSafeInteger(n) || n < 1000 || n > 10000)) { throw new Error('配置响应中的五档倍率无效'); }
}

function validateForm(focus = false) {
    let first = null;
    const setError = (input, message) => {
        input.setCustomValidity(message);
        const error = $(input.id + '-error');
        error.textContent = message;
        error.hidden = !message;

        if (message) {
            input.setAttribute('aria-invalid', 'true');
            first ??= input;
        } else { input.removeAttribute('aria-invalid'); }
    };

    for (const [key, , type] of fields) {
        if (type === 'boolean') { continue; }

        const inputs = type === 'multipliers' ? [...$('cfg-' + key).querySelectorAll('input')] : [$('cfg-' + key)];

        for (const input of inputs) {
            const raw = input.value.trim();
            let message = '';

            try {
                if (!raw || input.validity.badInput) { throw Error('请填写有效数字'); }

                if (type === 'number' && !/^\d+$/.test(raw)) { throw Error('请填写整数，不使用指数或符号'); }

                if (type === 'money') { parsePoints(raw, ['dailyReward', 'rewardLimit'].includes(key)); }

                if (type === 'multipliers') { parseMultiplier(raw); }

                if (!Number.isFinite(Number(raw)) || Number(raw) < Number(input.min) || Number(raw) > Number(input.max)) { throw Error('范围为 ' + input.min + '～' + input.max); }
            } catch (error) { message = error.message; }

            setError(input, message);
        }
    }

    const min = $('cfg-minStake'), max = $('cfg-maxStake');

    if (!min.validationMessage && !max.validationMessage && Number(min.value) > Number(max.value)) { setError(max, '最大下注不能小于最小下注'); }

    $('configErrors').textContent = first ? '请修正标红的输入项' : '';

    if (first && focus) {
        const section = first.closest('details');

        if (section) { section.open = true; }

        first.focus();
    }

    return !first;
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

    for (const key of ['minStake', 'maxStake', 'rewardLimit', 'dailyReward']) {
        if (!Object.hasOwn(value, key)) { continue; }

        try { amounts[key] = parsePoints(value[key], ['rewardLimit', 'dailyReward'].includes(key)); } catch (error) {
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

    for (const key of ['minStake', 'maxStake', 'rewardLimit', 'dailyReward']) { if (Object.hasOwn(value, key)) { result[key] = formatPoints(value[key]); } }

    if (value.multipliers) { result.multipliers = value.multipliers.map(n => String(n / 1000)); }

    return result;
}

function dirty() {
    if (!loaded) { return false; }

    try { return canonical(internal(draft())) !== canonical(internal(JSON.parse(baseline))); } catch { return true; }
}

function buttons() {
    $('configForm').setAttribute('aria-busy', String(configBusy));
    const valid = !loaded || validateForm(), changed = dirty() || !valid;
    $('saveConfig').disabled = !changed || !valid || configBusy || !!pending;
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
        ['常用设置', ['freeEnabled', 'showAIStyle', 'turnSeconds', 'aiReadSeconds', 'recallSeconds'], '阅读不占玩家倒计时；最新操作面板保留。'],
        ['积分与返还', ['dailyReward', 'stakesEnabled', 'minStake', 'maxStake', 'rewardLimit', 'multipliers'], '每日挑战每天一次，开局后计次；发奖需 Points 授权及玩家开户。'],
        ['高级设置', ['aiDelaySeconds', 'aiBudgetMs'], '正常行动即时推进；复杂局面同时受搜索量上限约束。']
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
                input.required = true;
                input.setAttribute('aria-label', difficulty + '倍率');
                const label = document.createElement('label');
                label.textContent = difficulty;
                label.append(input);
                const error = document.createElement('small');
                error.id = input.id + '-error';
                error.className = 'danger field-error';
                error.hidden = true;
                input.setAttribute('aria-describedby', 'cfg-multipliers-hint ' + error.id);
                label.append(error);
                e.append(label);
            }
        } else { e.type = type === 'boolean' ? 'checkbox' : 'number'; }

        if (type === 'money') {
            e.min = ['rewardLimit', 'dailyReward'].includes(key) ? '0' : '0.01';
            e.max = key === 'maxStake' ? '2500000000' : '10000000000';
            e.step = '0.01';
            e.inputMode = 'decimal';
        }

        if (type === 'number') {
            [e.min, e.max] = integerLimits[key].map(String);
            e.step = '1';
            e.inputMode = 'numeric';
        }

        if (type === 'number' || type === 'money') { e.required = true; }

        e.oninput = () => buttons();
        e.addEventListener('focusout', () => buttons());
        const controls = document.createElement('div');
        controls.className = 'config-controls';

        controls.append(e);

        if (hints[key]) {
            const hint = document.createElement('small');
            hint.id = e.id + '-hint';
            hint.className = 'hint field-hint';
            hint.textContent = hints[key];
            name.append(hint);
        }

        if (type === 'money' || type === 'number') {
            const error = document.createElement('small');
            error.id = e.id + '-error';
            error.className = 'danger field-error';
            error.hidden = true;
            e.setAttribute('aria-describedby', e.id + '-hint ' + error.id);
            controls.append(error);
        }

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
    $('configErrors').textContent = '';

    for (const input of $('configForm').querySelectorAll('[aria-invalid]')) { input.removeAttribute('aria-invalid'); }

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
    if (configBusy || pending || !loaded) { return; }

    if (!validateForm(true)) { return; }

    if (!dirty()) { return; }

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

$('configForm').onsubmit = event => {
    event.preventDefault();
    save();
};
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
