import { parseMultiplier } from './multipliers.js';

export const configForm = 'const parseMultiplier = ' + parseMultiplier.toString() + ';\n' + String.raw`
const fields = [['freeEnabled', '免费模式', 'boolean'], ['stakesEnabled', '积分下注', 'boolean'], ['calibrated', '倍率已校准', 'boolean'], ['turnSeconds', '操作时间（秒）', 'number'], ['aiDelaySeconds', 'AI 展示间隔（秒）', 'number'], ['aiBudgetMs', 'AI 搜索预算（毫秒）', 'number'], ['minStake', '最小下注（最小单位）', 'number'], ['maxStake', '最大下注（最小单位）', 'number'], ['rewardLimit', '奖励上限（最小单位）', 'number'], ['multipliers', '五档倍率（1～10 倍，最多 3 位小数）', 'multipliers']];
let configEpoch = 0, configBusy = false, loaded = null, baseline = '', pending = null;
const drafts = new Map();

function validateValues(value) {
    if (!value || typeof value !== 'object') { throw new Error('配置响应无效'); }

    for (const key of ['freeEnabled', 'stakesEnabled', 'calibrated']) {
        if (typeof value[key] !== 'boolean') { throw new Error('开关格式无效'); }
    }

    for (const [key, min, max] of [['turnSeconds', 20, 300], ['aiDelaySeconds', 1, 3], ['aiBudgetMs', 1, 8], ['minStake', 1, 1e12], ['maxStake', 1, 2.5e11], ['rewardLimit', 0, 1e12]]) {
        if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) {
            const error = new Error(fields.find(field => field[0] === key)[1] + '须为 ' + min + '～' + max + ' 的整数');
            error.field = key;
            throw error;
        }
    }

    if (value.minStake > value.maxStake || value.stakesEnabled && !value.calibrated) { throw new Error('下注范围或校准状态无效'); }

    if (!Array.isArray(value.multipliers) || value.multipliers.length !== 5 || value.multipliers.some(n => !Number.isSafeInteger(n) || n < 1000 || n > 10000)) { throw new Error('配置响应中的五档倍率无效'); }
}

function canonical(value) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }

function draft() {
    const value = {};

    for (const [key, , type] of fields) {
        const e = $('cfg-' + key);
        value[key] = type === 'boolean' ? e.checked : type === 'number' ? (e.value.trim() ? Number(e.value) : NaN) : [...e.querySelectorAll('input')].map(input => input.value);
    }

    return value;
}

function internal(value) {
    if (!Object.keys(value).length) { return value; }

    return {
        ...value, multipliers: value.multipliers.map((text, index) => {
            try { return parseMultiplier(text); } catch (error) {
                error.field = 'multiplier-' + index;
                throw error;
            }
        })
    };
}

function display(value) { return { ...value, multipliers: value.multipliers.map(n => String(n / 1000)) }; }

function dirty() {
    if (!loaded) { return false; }

    try { return canonical(internal(draft())) !== canonical(internal(JSON.parse(baseline))); } catch { return true; }
}

function buttons() {
    $('configForm').setAttribute('aria-busy', String(configBusy));
    const changed = dirty();
    $('saveConfig').disabled = !changed || configBusy || !!pending;
    $('undoConfig').disabled = !changed || configBusy || !!pending;
    $('clearConfig').disabled = !loaded || loaded.scope === '*' || configBusy || !!pending;
    $('configStatus').textContent = pending ? '保存结果未知，请核对或重试原请求' : !loaded ? '尚未加载' : changed ? '有未保存修改' : (loaded.scope === '*' ? '全局配置' : '群 ' + loaded.scope) + ' · 版本 ' + loaded.version;
    $('checkConfig').hidden = !pending;
    $('checkConfig').disabled = configBusy;
    $('loadConfig').disabled = configBusy || !!pending;

    for (const input of $('configForm').querySelectorAll('input')) { input.disabled = configBusy || !!pending; }
}

function fill(value) {
    for (const [key, , type] of fields) {
        const e = $('cfg-' + key);

        if (type === 'boolean') { e.checked = value[key]; } else if (type === 'multipliers') { [...e.querySelectorAll('input')].forEach((input, i) => input.value = value[key][i]); } else { e.value = value[key]; }
    }
}

function loadForm(result) {
    loaded = result;
    $('configErrors').textContent = '';
    $('configForm').replaceChildren();

    for (const [key, label, type] of fields) {
        const row = document.createElement(type === 'multipliers' ? 'div' : 'label');
        row.className = 'row';
        const name = document.createElement('span');
        name.textContent = label;
        const e = document.createElement(type === 'multipliers' ? 'span' : 'input');
        e.id = 'cfg-' + key;

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

        e.setAttribute('aria-describedby', 'configErrors');
        e.oninput = () => {
            $('configErrors').textContent = '';
            e.removeAttribute('aria-invalid');
            buttons();
        };
        row.append(name, e);
        $('configForm').append(row);
    }

    fill(display(result.effective.values));
    baseline = JSON.stringify(draft());
    $('configForm').hidden = false;
    buttons();
}

$('scope').oninput = () => {
    if (loaded && dirty()) { drafts.set(loaded.scope, draft()); }

    configEpoch++;
    loaded = null;
    baseline = '';
    $('configForm').hidden = true;
    buttons();
};
$('loadConfig').onclick = async () => {
    if (configBusy || pending) { return; }

    if (dirty() && !await confirmAction('重新加载会覆盖本范围的未保存修改')) { return; }

    configBusy = true;
    $('loadConfig').disabled = true;
    const scope = $('scope').value.trim() || '*', own = ++configEpoch, feedback = epoch.config;

    try {
        const r = await api('/api/config?scope=' + encodeURIComponent(scope));

        if (r.scope !== scope || !Number.isSafeInteger(r.version) || r.version < 0) { throw new Error('配置响应无效'); }

        validateValues(r.effective?.values);

        if (own === configEpoch) {
            loadForm(r);

            if (drafts.has(scope)) {
                fill(drafts.get(scope));
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
    if (result.scope !== operation.input.scope || result.operationId !== operation.input.operationId || result.version !== operation.input.version + 1 || canonical(result.value) !== canonical(internal(operation.input.value))) { throw new Error('保存回执无效'); }

    if (loaded && loaded.scope === result.scope && configEpoch === operation.epoch) {
        loaded.version = result.version;
        loaded.value = result.value;

        if (Object.keys(result.value).length) {
            baseline = JSON.stringify(display(result.value));
            fill(JSON.parse(baseline));
        } else {
            loaded = null;
            $('configForm').hidden = true;
        }
    }

    drafts.delete(result.scope);
    pending = null;
    buttons();
}

async function save(clear) {
    if (configBusy || pending || !loaded || !clear && !dirty()) { return; }

    const value = clear ? {} : draft();

    try { if (!clear) { validateValues(internal(value)); } } catch (e) {
        $('configErrors').textContent = e.message;
        const field = e.field && $('cfg-' + e.field);

        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }

        return;
    }

    const snapshot = { scope: loaded.scope, version: loaded.version, epoch: configEpoch, feedback: epoch.config };

    // 先锁定处理器；模态确认期间保留触发按钮焦点，接受后再禁用表单。
    configBusy = true;

    try {
        if (!await confirmAction(clear ? '清除本群覆盖，之后新房间使用全局设置' : '保存配置，仅对之后创建的房间生效')) { return; }

        const feedback = snapshot.feedback;
        const operation = { feedback, input: { scope: snapshot.scope, version: snapshot.version, value, operationId: crypto.randomUUID() }, epoch: snapshot.epoch };
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

$('saveConfig').onclick = () => save(false);
$('clearConfig').onclick = () => save(true);
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
        } else if (r.status === 'REJECTED' && r.result?.operationId === operation.input.operationId && r.result?.scope === operation.input.scope) {
            drafts.set(operation.input.scope, operation.input.value);
            pending = null;

            if (loaded?.scope === operation.input.scope) {
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
