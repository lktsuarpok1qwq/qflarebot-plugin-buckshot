export interface Field { title: string; text: string; variables: string[]; required?: string[]; variableHelp?: Record<string, string>; group: string; parent?: string; parents?: string[]; empty?: boolean; compositions?: Record<string, { fields: string[]; description: string }> }
const field = (title: string, text: string, group: string, parent?: string, required?: string[]): Field => ({ title, text, group, parent, required, variables: [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1]) });
export const REPLY_FIELDS: Record<string, Field> = {
    help: field('玩法帮助', '🎲 恶魔轮盘\n创建：/恶魔轮盘 创建 单人|双人|多人 免费|下注金额 新手|普通|困难|专家|恶魔\n状态：/恶魔轮盘 状态\n操作：/恶魔轮盘 操作 房间ID 版本 加入|准备|开始|退出|确认退出\n射击：/恶魔轮盘 操作 房间ID 版本 射击 玩家序号\n道具：/恶魔轮盘 操作 房间ID 版本 道具 槽位 [目标序号] [被偷槽位] [被偷道具目标序号]\n槽位从 1 开始；认输需再次确认。🔒 情报只私聊操作者', '命令回复'),
    lobby: field('选择玩法', '🎲 选择玩法开始对局，或发送 /恶魔轮盘 帮助', '命令回复'),
    create: field('创建确认', '🎲 {{mode}} · {{difficulty}}\n{{stake}}\n{{reward}}\n确认后锁定房间参数\n文字确认：/恶魔轮盘 确认创建 {{gameId}}', '命令回复', undefined, ['stake', 'reward', 'gameId']),
    quit: field('认输确认', '🏳️ 确认认输？淘汰后仍按本局最终结果结算\n文字确认：/恶魔轮盘 操作 {{gameId}} {{version}} 确认退出', '命令回复', undefined, ['gameId', 'version']),
    panel: field('房间面板', '🎲 恶魔轮盘 · {{status}}{{paused}}{{recovery}}\n房间 {{gameId}} · 版本 {{version}}\n{{stake}}\n{{items}}\n{{turn}}\n{{summary}}\n文字操作：/恶魔轮盘 帮助', '房间与操作'),
    member: field('等待玩家', '{{name}} · {{ready}}', '房间与操作', 'panel'),
    player: field('玩家状态', '{{number}}. {{name}} · ❤️ {{life}}/4{{control}}\n🎒 {{inventory}}', '房间与操作', 'panel'),
    inventoryItem: field('道具槽位', '{{number}}.{{item}}', '房间与操作', 'panel'),
    inventoryEmpty: field('没有道具', '暂无道具', '房间与操作', 'panel'),
    turn: field('当前行动', '👉 当前：{{name}} · {{direction}}', '房间与操作', 'panel'),
    waiting: field('等待开始', '👥 加入后准备，由房主开始', '房间与操作', 'panel'),
    menu: field('合法操作列表', '🎯 选择操作；查看列表不延长计时\n{{items}}', '房间与操作'),
    menuShot: field('射击选项', '{{number}}. 射击 {{target}}', '房间与操作', 'menu'),
    menuItem: field('道具选项', '{{number}}. 槽位 {{slot}} {{item}}{{target}}{{stolen}}{{stolenTarget}}', '房间与操作', 'menu'),
    target: field('道具目标', ' → {{name}}', '房间与操作', 'menu'),
    stolen: field('偷取槽位', ' 偷取槽位 {{slot}} {{item}}', '房间与操作', 'menu'),
    stolenTarget: field('被偷道具目标', '，作用于 {{name}}', '房间与操作', 'menu'),
    load: field('装填公告', '🔫 装填 {{count}} 发：{{live}} 实弹、{{blank}} 空弹', '对局事件'),
    shot: field('射击结果', '💥 {{actor}} → {{target}}：{{shell}}', '对局事件', 'panel'),
    item: field('使用道具', '🧰 {{actor}} 使用{{item}}{{target}}', '对局事件', 'panel'),
    steal: field('偷取道具', '💉 {{actor}} 使用肾上腺素，从 {{target}} 偷取{{item}}', '对局事件', 'panel'),
    skip: field('跳过行动', '⏭️ {{name}} 跳过行动', '对局事件', 'panel'),
    eject: field('退出弹药', '🍺 退掉{{shell}}', '对局事件', 'panel'),
    eliminate: field('玩家淘汰', '💀 {{name}} 淘汰', '对局事件'),
    timeout: field('操作超时', '⌛ {{name}} 操作超时', '对局事件', 'panel'),
    timeoutEliminate: field('超时淘汰', '⌛ {{name}} 操作超时，已淘汰', '对局事件'),
    finish: field('胜者公告', '🏆 胜者：{{name}}', '对局事件'),
    noWinner: field('无胜者公告', '🤝 本局无胜者', '对局事件'),
    intel: field('私聊弹药情报', '🔒 房间 {{gameId}}\n装填 {{loadId}}：使用时第 {{position}} 发是{{shell}}', '私聊情报', undefined, ['gameId', 'loadId', 'position', 'shell']),
    noIntel: field('私聊无情报', '☎️ 房间 {{gameId}}\n电话没有提供弹药情报', '私聊情报'),
    reminder: field('倒计时提醒', '⏳ 操作时间剩余 15 秒', '对局事件'),
    error: field('操作提示', '⚠️ {{message}}', '通用提示'),
    free: field('免费模式', '🆓 免费对局', '共用文案', 'panel'),
    stake: field('下注说明', '🪙 每人下注 {{amount}} 最小积分单位', '共用文案', 'create'),
    soloReward: field('单人返还说明', '胜利总返还 {{amount}}（含本金）；失败失去下注', '共用文案', 'create'),
    multiReward: field('联机返还说明', '胜者获得实际参赛者的全部下注；取消或无胜者退回本金', '共用文案', 'create'),
    ready: field('已准备', '✅ 已准备', '共用文案', 'panel'),
    notReady: field('未准备', '未准备', '共用文案', 'panel'),
    paused: field('暂停标记', ' · ⏸️ 暂停', '共用文案', 'panel'),
    recovery: field('恢复标记', ' · 🛠️ 等待恢复', '共用文案', 'panel'),
    controlled: field('受控标记', ' · 受控', '共用文案', 'panel'),
    forward: field('正向行动', '正向', '共用文案', 'panel'),
    reverse: field('反向行动', '反向', '共用文案', 'panel'),
    live: field('实弹名称', '实弹', '共用文案', 'shot'),
    blank: field('空弹名称', '空弹', '共用文案', 'shot'),
    unknownError: field('未知错误提示', '操作未完成，请查询状态或联系管理员', '共用文案', 'error'),
    inventorySeparator: { ...field('道具项目间隔', '、', '列表排版', 'panel'), empty: true },
    eventSeparator: { ...field('事件项目间隔', '\n', '列表排版', 'panel'), empty: true },
    menuSeparator: { ...field('操作项目间隔', '\n', '列表排版', 'menu'), empty: true }
};

REPLY_FIELDS["modeSolo"] = field("单人显示名称", "单人", '共用文案', 'panel');
REPLY_FIELDS["modeDuo"] = field("双人显示名称", "双人", '共用文案', 'panel');
REPLY_FIELDS["modeMulti"] = field("多人显示名称", "多人", '共用文案', 'panel');
REPLY_FIELDS["level0"] = field("新手显示名称", "新手", '共用文案', 'panel');
REPLY_FIELDS["level1"] = field("普通显示名称", "普通", '共用文案', 'panel');
REPLY_FIELDS["level2"] = field("困难显示名称", "困难", '共用文案', 'panel');
REPLY_FIELDS["level3"] = field("专家显示名称", "专家", '共用文案', 'panel');
REPLY_FIELDS["level4"] = field("恶魔显示名称", "恶魔", '共用文案', 'panel');
REPLY_FIELDS["statusWAITING"] = field("等待加入显示名称", "等待加入", '共用文案', 'panel');
REPLY_FIELDS["statusPREPARING"] = field("准备下注显示名称", "准备下注", '共用文案', 'panel');
REPLY_FIELDS["statusPLAYING"] = field("对局中显示名称", "对局中", '共用文案', 'panel');
REPLY_FIELDS["statusFINISHED"] = field("已结束显示名称", "已结束", '共用文案', 'panel');
REPLY_FIELDS["statusSETTLING"] = field("结算中显示名称", "结算中", '共用文案', 'panel');
REPLY_FIELDS["statusSETTLED"] = field("已结算显示名称", "已结算", '共用文案', 'panel');
REPLY_FIELDS["statusCLOSED"] = field("已关闭显示名称", "已关闭", '共用文案', 'panel');
REPLY_FIELDS["statusCANCELLED"] = field("已取消显示名称", "已取消", '共用文案', 'panel');
REPLY_FIELDS["itemglass"] = field("放大镜显示名称", "放大镜", '共用文案', 'panel');
REPLY_FIELDS["itembeer"] = field("啤酒显示名称", "啤酒", '共用文案', 'panel');
REPLY_FIELDS["itemcigarette"] = field("香烟显示名称", "香烟", '共用文案', 'panel');
REPLY_FIELDS["itemsaw"] = field("手锯显示名称", "手锯", '共用文案', 'panel');
REPLY_FIELDS["itemcuffs"] = field("手铐显示名称", "手铐", '共用文案', 'panel');
REPLY_FIELDS["itemjammer"] = field("干扰器显示名称", "干扰器", '共用文案', 'panel');
REPLY_FIELDS["itemphone"] = field("电话显示名称", "电话", '共用文案', 'panel');
REPLY_FIELDS["iteminverter"] = field("逆转器显示名称", "逆转器", '共用文案', 'panel');
REPLY_FIELDS["itemmedicine"] = field("过期药品显示名称", "过期药品", '共用文案', 'panel');
REPLY_FIELDS["itemadrenaline"] = field("肾上腺素显示名称", "肾上腺素", '共用文案', 'panel');
REPLY_FIELDS["itemremote"] = field("遥控器显示名称", "遥控器", '共用文案', 'panel');
export const ERROR_KEYS: Record<string, string> = { "缺少稳定事件编号": "reason0", "游戏操作请在群内进行": "reason1", "创建参数无效，发送 /恶魔轮盘 帮助": "reason2", "模式未启用或金额超出范围": "reason3", "返还或奖励超出上限": "reason4", "创建确认已失效": "reason5", "操作无效": "reason6", "未知操作，发送 /恶魔轮盘 帮助": "reason7", "仅群内操作": "reason8", "仅创建者可确认": "reason9", "创建确认身份或参数不符": "reason10", "创建编号冲突": "reason11", "创建确认已过期": "reason12", "房间已失效": "reason13", "面板已更新，请查询状态": "reason14", "分页无效": "reason15", "Points 来源未授权": "reason16", "Points 资金权限不完整": "reason17", "账户未开通、暂停或余额不足": "reason18", "有玩家尚未开通积分账户": "reason19", "预留状态无法确认": "reason20", "本金已失效，禁止重新扣款": "reason21", "创建编号已关闭": "reason22", "创建参数无效": "reason23", "下注范围或模式配置无效": "reason24", "你已有尚未关闭的房间": "reason25", "本群已有房间或创建编号冲突": "reason26", "加入编号冲突": "reason27", "该加入请求已拒绝，请查询状态后重新加入": "reason28", "存储结构未识别": "reason29", "存储版本不匹配": "reason30", "你已在其他房间或等待安全关闭": "reason31", "房间不存在或已失效": "reason32", "模式或玩家无效": "reason33", "难度无效": "reason34", "下注金额无效": "reason35", "该模式未启用或金额不符": "reason36", "奖励超出配置上限": "reason37", "本群已有房间": "reason38", "房间已创建，须按房间状态恢复": "reason39", "操作编号冲突": "reason40", "投递租约已失效": "reason41", "缺少消息回执": "reason42", "资金租约失效": "reason43", "缺少资金核对依据": "reason44", "房间尚未安全结算": "reason45", "操作类型无效": "reason46", "仅管理入口允许此操作": "reason47", "房间已暂停或等待恢复": "reason48", "等待房间已到期": "reason49", "本金预留已到期，等待善后": "reason50", "当前不能加入": "reason51", "已加入或身份不符": "reason52", "当前不能离开等待房间": "reason53", "当前不能准备": "reason54", "仅等待中的房主可以开始": "reason55", "人数不足或尚未全部准备": "reason56", "当前不能认输": "reason57", "玩家不在本局": "reason58", "玩家已离开": "reason59", "请重新确认认输": "reason60", "当前不能淘汰玩家": "reason61", "当前不能操作": "reason62", "操作时间已到": "reason63", "当前状态不能暂停": "reason64", "请先恢复异常任务": "reason65", "胜负已固定，不能取消": "reason66", "预留结果未确定": "reason67", "资金任务当前不能核对": "reason68", "任务不允许重发": "reason69", "配置格式错误": "reason70", "配置字段无效": "reason71", "开关格式错误": "reason72", "下注范围无效": "reason73", "倍率须为五个 1000～10000 的整数，1000 表示一倍": "reason74", "启用下注前须确认倍率校准": "reason75", "标识无效": "reason76", "玩家不存在": "reason77", "玩家重复": "reason78", "人数不符合模式": "reason79", "AI 不符合模式": "reason80", "对局已结束": "reason81", "玩家已淘汰": "reason82", "未轮到你行动": "reason83", "操作或道具目标无效": "reason84" };

for (const [text, key] of Object.entries(ERROR_KEYS)) { REPLY_FIELDS[key] = field(text, text, '操作提示文案', 'error'); }

for (const key of ['free', 'stake']) { REPLY_FIELDS[key].parents = ['panel', 'create']; }

for (const key of ['live', 'blank']) {
    REPLY_FIELDS[key].parent = 'panel';
    REPLY_FIELDS[key].parents = ['panel', 'intel'];
}

REPLY_FIELDS.target.parents = ['menu', 'panel', 'item'];

for (const key of ['shot', 'item', 'steal', 'skip', 'eject', 'eliminate', 'timeout', 'timeoutEliminate']) {
    REPLY_FIELDS[key].parent = 'panel';
    REPLY_FIELDS[key].parents = ['panel', key];
}

for (const key of ['live', 'blank']) { REPLY_FIELDS[key].parents = ['panel', 'intel', 'shot', 'eject']; }

for (const [key, f] of Object.entries(REPLY_FIELDS)) {
    if (key.startsWith('mode') || key.startsWith('level')) { f.parent = 'create'; }

    if (key.startsWith('item') && key !== 'item') { f.parents = ['panel', 'menu', 'item', 'steal']; }
}

REPLY_FIELDS.panel.compositions = {
    items: { fields: ['member', 'player', 'inventoryItem'], description: '等待时按等待玩家片段、对局时按玩家状态片段生成；只在有输出的玩家之间插入玩家项目间隔。道具槽位使用道具项目间隔。' },
    summary: { fields: ['shot', 'item', 'steal', 'skip', 'eject', 'eliminate', 'timeout', 'timeoutEliminate'], description: '本次公开事件按业务顺序展开，非空事件之间使用事件项目间隔；私聊情报不进入摘要。' },
    turn: { fields: ['turn', 'waiting'], description: '等待房间使用等待开始片段，有游戏状态时使用当前行动片段。' }
};
REPLY_FIELDS.menu.compositions = { items: { fields: ['menuShot', 'menuItem', 'target', 'stolen', 'stolenTarget'], description: '当前页最多八项合法操作，分别使用射击或道具选项片段；仅在非空项目间插入操作项目间隔。' } };
REPLY_FIELDS.player.compositions = { inventory: { fields: ['inventoryItem', 'inventoryEmpty'], description: '按原始槽位顺序展开道具，非空项目间使用道具项目间隔；没有道具时使用没有道具片段。' } };
REPLY_FIELDS.error.compositions = { message: { fields: ['unknownError'], description: '按实际拒绝原因选择操作提示文案；未识别的错误使用未知错误提示。各提示只编辑一份，程序决定选择条件。' } };
REPLY_FIELDS.create.compositions = { stake: { fields: ['free', 'stake'], description: '依下注金额选择免费或下注说明。' }, reward: { fields: ['soloReward', 'multiReward'], description: '免费对局为空；下注时按玩法选择单人或联机返还说明。' } };

export type ReplyKey = string;
export type Replies = Record<string, string>;
export const DEFAULT_REPLIES = Object.fromEntries(Object.entries(REPLY_FIELDS).map(([key, f]) => [key, f.text]));
export const REPLY_GROUPS = Object.fromEntries(Object.entries(REPLY_FIELDS).map(([key, f]) => [key, f.group]));
export const REPLY_VARIABLE_HELP: Record<string, string> = { gameId: '当前房间编号', version: '当前操作版本，凭据由程序生成', items: '按当前草稿生成的玩家或操作列表', summary: '本次公开事件，私聊情报不会进入此处', name: '玩家显示名', actor: '操作者显示名', target: '目标玩家或已渲染目标片段', shell: '已合法公开或仅向操作者揭示的弹药名称', stake: '当前免费或下注说明', reward: '本金及胜利返还规则', position: '使用道具时弹药的相对位置', loadId: '装填编号', number: '从 1 开始的序号', inventory: '按槽位片段和道具项目间隔生成的列表', life: '当前生命', item: '道具显示名称', amount: '最小积分单位的整数数量', mode: '玩法名称', difficulty: 'AI 难度名称', message: '可编辑操作提示片段', status: '当前房间状态', paused: '暂停时显示的标记', recovery: '等待恢复时显示的标记', turn: '当前行动或等待开始片段', ready: '玩家准备状态片段', control: '受控时显示的标记', direction: '行动方向', slot: '道具槽位，从 1 开始', stolen: '偷取槽位说明片段', stolenTarget: '被偷道具目标说明片段', count: '装填总数', live: '实弹数', blank: '空弹数' };
export const REPLY_FRAGMENTS: Record<string, { message: string; variable: string; empty: boolean }> = Object.fromEntries(Object.entries(REPLY_FIELDS).filter(([, f]) => f.parent).map(([key, f]) => [key, { message: f.parent!, variable: 'items', empty: !!f.empty }]));

export function templateError(value: unknown, variables: readonly string[], required: readonly string[] = []): { message: string; start: number; end: number } | null {
    if (typeof value !== 'string' || !value.trim()) { return { message: '模板不能为空', start: 0, end: 0 }; }

    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.exec(value);

    if (control) { return { message: '模板包含不支持的控制字符', start: control.index, end: control.index + 1 }; }

    const keys = new Set<string>();
    let end = 0;

    for (const match of value.matchAll(/\{\{([^{}]*)\}\}/g)) {
        const malformed = /\{\{|\}\}/.exec(value.slice(end, match.index));

        if (malformed) { return { message: '变量格式应为 {{变量名}}', start: end + malformed.index, end: end + malformed.index + 1 }; }

        if (value[match.index - 1] === '{' || value[match.index + match[0].length] === '}') {
            return { message: '变量格式应为 {{变量名}}', start: Math.max(0, match.index - 1), end: match.index + match[0].length + 1 };
        }

        const key = match[1]!;

        if (!variables.includes(key)) { return { message: '未知变量：' + key, start: match.index, end: match.index + match[0].length }; }

        keys.add(key);
        end = match.index + match[0].length;
    }

    const malformed = /\{\{|\}\}/.exec(value.slice(end));

    if (malformed) { return { message: '变量格式应为 {{变量名}}', start: end + malformed.index, end: end + malformed.index + 1 }; }

    const missing = required.find(key => !keys.has(key));

    return missing ? { message: '必须保留变量：{{' + missing + '}}', start: value.length, end: value.length } : null;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
    // 一次替换，不将变量内容当作另一层模板或脚本执行。
    return template.replace(/\{\{([^{}]*)\}\}/g, (_, name: string) => values[name] ?? '{{' + name + '}}');
}

export function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+.!|~\-]/g, '\\$&');
}
