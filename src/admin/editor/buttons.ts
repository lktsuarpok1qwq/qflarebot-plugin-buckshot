export const BUTTON_EDITOR_SCRIPT = String.raw`
function createButtonEditor(current, changed) {
    const make = (tag, text, className) => {
        const node = document.createElement(tag);

        if (text !== undefined) { node.textContent = text; }

        if (className) { node.className = className; }

        return node;
    };
    const descriptors = new WeakMap();
    let controls = [];
    const bind = (node, owner, field, row, item) => {
        const descriptor = { owner, field, row, item, node };
        descriptors.set(node, descriptor);
        controls.push(descriptor);

        return node;
    };
    const button = (text, action, inactive = false) => {
        const node = make('button', text, 'qb-btn' + (['删除此行', '移除按钮'].includes(text) ? ' qb-btn--danger' : ''));
        node.disabled = inactive;
        node.dataset.inactive = String(inactive);
        node.onclick = () => {
            if (!inactive) {
                const focus = action();
                draw(focus?.owner ? focus : undefined);
                changed();
            }
        };

        return node;
    };
    const labeled = (text, control) => {
        const label = make('label', text);
        control.classList.add('qb-input');
        control.setAttribute('aria-label', text);
        label.append(control);

        return label;
    };

    function draw(preferred) {
        const { config, key } = current(), target = $('reply-buttons-editor');
        const previous = preferred || descriptors.get(document.activeElement);
        controls = [];
        target.replaceChildren();

        if (!MESSAGE_KEYS.includes(key)) {
            return;
        }

        const rows = config.buttons[key];

        if (!rows.length) { target.append(make('p', '当前消息不附带按钮，可点击“添加一行”设置', 'hint')); }

        rows.forEach((row, index) => {
            const group = make('section', undefined, 'reply-button-row');
            const header = make('div', undefined, 'actions');
            header.append(make('strong', '第 ' + (index + 1) + ' 行'));
            header.append(button('上移', () => { [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; }, index === 0));
            header.append(button('下移', () => { [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; }, index === rows.length - 1));
            header.append(button('添加按钮', () => {
                const item = { action: 'status', label: '查看状态', enter: true };
                row.push(item);

                return { owner: item, field: 'label' };
            }, row.length >= 5));
            header.append(button('删除此行', () => rows.splice(index, 1), row.some(item => DYNAMIC.includes(item.action))));
            [...header.querySelectorAll('button')].forEach(node => bind(node, row, node.textContent, index));
            group.append(header);
            row.forEach((item, position) => {
                const box = make('div', undefined, 'reply-button-item');
                const fields = make('div', undefined, 'grid');
                const label = make('input');
                label.value = item.label;
                label.oninput = () => {
                    item.label = label.value;
                    changed();
                };
                fields.append(labeled('按钮文字', bind(label, item, 'label', index, position)));
                const action = make('select');
                const dynamic = DYNAMIC.includes(item.action);
                Object.entries(BUTTON_ACTIONS).filter(([name]) => !DYNAMIC.includes(name) || name === item.action).forEach(([name, title]) => {
                    const option = make('option', title);
                    option.value = name;
                    action.append(option);
                });
                action.value = item.action;
                action.disabled = dynamic;
                action.dataset.inactive = String(dynamic);
                action.onchange = () => {
                    item.action = action.value;
                    delete item.data;
                    delete item.enter;

                    if (item.action === 'command') { item.data = ''; }

                    if (item.action === 'link') { item.data = 'https://'; }

                    if (![...DYNAMIC, 'link'].includes(item.action)) { item.enter = true; }

                    draw();
                    changed();
                };
                const actionField = labeled('按钮功能', bind(action, item, 'action', index, position));
                const actionHelp = make('span', BUTTON_ACTION_HELP[item.action], 'hint');
                actionHelp.id = 'reply-action-help-' + index + '-' + position;
                action.setAttribute('aria-describedby', actionHelp.id);
                actionField.append(actionHelp);
                fields.append(actionField);

                if (['command', 'link'].includes(item.action)) {
                    const data = make('input');
                    data.value = item.data || '';
                    data.placeholder = item.action === 'command' ? '例如 /每日' : 'https://example.com';
                    data.oninput = () => {
                        item.data = data.value;
                        changed();
                    };
                    fields.append(labeled(item.action === 'link' ? '链接地址' : '命令内容', bind(data, item, 'data', index, position)));
                }

                if (![...DYNAMIC, 'link'].includes(item.action)) {
                    const enter = make('select');

                    for (const [value, title] of [['true', '直接发送命令'], ['false', '填入输入框']]) {
                        const option = make('option', title);
                        option.value = value;
                        enter.append(option);
                    }

                    enter.value = String(item.enter);
                    enter.onchange = () => {
                        item.enter = enter.value === 'true';
                        changed();
                    };
                    fields.append(labeled('点击方式', bind(enter, item, 'enter', index, position)));
                }

                const destination = make('select');

                for (let i = 0; i < rows.length + (rows.length < 5 ? 1 : 0); i++) {
                    const option = make('option', i === rows.length ? '新建一行' : '第 ' + (i + 1) + ' 行');
                    option.value = String(i);
                    option.disabled = i !== index && rows[i]?.length >= 5;
                    destination.append(option);
                }

                destination.value = String(index);
                destination.onchange = () => {
                    const next = Number(destination.value);

                    if (next === index) { return; }

                    if (next === rows.length) { rows.push([]); }

                    const target = rows[next];
                    row.splice(position, 1);
                    target.push(item);
                    config.buttons[key] = rows.filter(row => row.length);
                    draw();
                    changed();
                };
                fields.append(labeled('所在行', bind(destination, item, 'destination', index, position)));
                box.append(fields);
                const actions = make('div', undefined, 'actions');
                actions.append(button('前移', () => { [row[position - 1], row[position]] = [row[position], row[position - 1]]; }, position === 0));
                actions.append(button('后移', () => { [row[position + 1], row[position]] = [row[position], row[position + 1]]; }, position === row.length - 1));
                actions.append(button('移除按钮', () => {
                    row.splice(position, 1);
                    config.buttons[key] = rows.filter(row => row.length);
                }, dynamic));
                [...actions.querySelectorAll('button')].forEach(node => bind(node, item, node.textContent, index, position));
                box.append(actions);
                group.append(box);
            });
            target.append(group);
        });
        target.append(bind(button('添加一行', () => {
            const item = { action: 'status', label: '查看状态', enter: true };
            rows.push([item]);

            return { owner: item, field: 'label' };
        }, rows.length >= 5), target, 'add'));

        if (previous) {
            // 对象身份跟随移动；删除后按原行列选择邻近控件，不给配置增加持久化标识。
            const available = controls.filter(control => !control.node.disabled);
            const rowIndex = Math.min(previous.row ?? 0, rows.length - 1);
            const itemIndex = Math.min(previous.item ?? 0, (rows[rowIndex]?.length || 1) - 1);
            const next = available.find(control => control.owner === previous.owner && control.field === previous.field)
                || available.find(control => control.owner === previous.owner)
                || available.find(control => control.row === rowIndex && control.item === itemIndex)
                || available.find(control => control.row === rowIndex)
                || available.find(control => control.field === 'add');
            next?.node.focus();
        }
    }

    function validate(error) {
        const target = $('reply-buttons-editor');

        for (const node of target.querySelectorAll('[data-button-error]')) { node.remove(); }

        for (const { node } of controls) {
            node.removeAttribute('aria-invalid');
            const descriptions = (node.getAttribute('aria-describedby') || '').split(' ').filter(id => id && !id.startsWith('reply-button-error-'));

            if (descriptions.length) { node.setAttribute('aria-describedby', descriptions.join(' ')); } else { node.removeAttribute('aria-describedby'); }
        }

        target.removeAttribute('aria-invalid');
        target.removeAttribute('aria-describedby');

        if (!error) { return null; }

        const field = controls.find(control => control.row === error.row && control.item === error.item && control.field === error.control)?.node;
        const node = field || target;
        const message = make('span', error.message, 'field-error');
        message.id = 'reply-button-error-current';
        message.dataset.buttonError = 'true';
        message.setAttribute('role', 'status');

        if (field) { field.closest('label').append(message); } else {
            target.append(message);
            target.tabIndex = -1;
        }

        node.setAttribute('aria-invalid', 'true');
        node.setAttribute('aria-describedby', [node.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '));

        return node;
    }

    return { draw, validate };
}
`;
