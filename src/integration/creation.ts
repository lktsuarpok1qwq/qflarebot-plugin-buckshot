import type { PluginContext, Session } from '@qqbot/sdk';
import type { PointsService } from 'qflarebot-plugin-points';
import { payout, type ConfigSnapshot } from '../config.js';
import { requireRule, type Mode } from '../game/types.js';
import { renderMessage } from '../templates/send.js';
import type { ReplyConfiguration } from '../templates/reply-config.js';
import { ensureDatabase, readConfig } from './database.js';

const MODES: Record<string, Mode> = { 单人: 'solo', 双人: 'duo', 多人: 'multi' };
const DIFFICULTIES = ['新手', '普通', '困难', '专家', '恶魔'];
const modeKey = (mode: Mode) => mode === 'solo' ? 'Solo' : mode === 'duo' ? 'Duo' : 'Multi';

async function configuration(ctx: PluginContext, session: Session) {
    await ensureDatabase(ctx);

    return readConfig(ctx, session.targetId);
}

// 选择步骤只读配置；仅生成最终确认时持久化授权，不创建房间或预留积分。
export async function prepareCreate(ctx: PluginContext, session: Session, args: string[], templates: ReplyConfiguration, snapshot?: ConfigSnapshot) {
    const mode = Object.hasOwn(MODES, args[0]) ? MODES[args[0]] : undefined, stake = args[1] === '免费' ? 0 : Number(args[1]), difficulty = DIFFICULTIES.indexOf(args[2] || '普通');
    requireRule(args.length <= 3 && mode && Number.isSafeInteger(stake) && stake >= 0 && difficulty >= 0, '创建参数无效，发送 /恶魔轮盘 帮助');
    const config = snapshot ?? await configuration(ctx, session);
    requireRule(stake ? config.values.stakesEnabled && config.values.calibrated && stake >= config.values.minStake && stake <= config.values.maxStake : config.values.freeEnabled, '模式未启用或金额超出范围');
    requireRule(!stake || mode !== 'solo' || payout(stake, config.values.multipliers[difficulty]) <= 1e12 && payout(stake, config.values.multipliers[difficulty]) - stake <= config.values.rewardLimit, '返还或奖励超出上限');
    const gameId = crypto.randomUUID(), expiresAt = Date.now() + 600000;
    const create = { mode, stake, difficulty, gameId, botId: ctx.botId, groupId: session.targetId, config, member: { id: session.userId, name: '', ready: true, privateId: session.userId } };
    await ctx.db.run('INSERT INTO {coord_ops}(bot,id,game_id,request,state,expires_at) VALUES(?,?,?,?,?,?)', ctx.botId, `create:${gameId}`, gameId, JSON.stringify({ input: create, expiresAt }), 'CREATE_READY', expiresAt);

    return renderMessage(templates, 'create', { values: { mode: modeKey(mode), stake: String(stake), difficulty: String(difficulty), reward: stake ? String(payout(stake, config.values.multipliers[difficulty])) : '', gameId }, dynamic: { confirmCreate: JSON.stringify({ create: { mode, stake, difficulty }, owner: session.userId, gameId }) } });
}

async function pointsReason(ctx: PluginContext, mode: Mode): Promise<string | undefined> {
    let service: PointsService;

    try { service = ctx.service<PointsService>('points.wallet'); } catch { return 'setupNoPoints'; }

    try {
        const policy = await service.getSourcePolicy({ source: 'buckshot' });

        if (!policy.ok) { return 'setupPointsUnavailable'; }

        const data = policy.data;

        if (!data.registered) { return 'setupUnregistered'; }

        if (!data.enabled) { return 'setupUnauthorized'; }

        if (!(['reserve', 'settle', 'release', 'renew'] as const).every(p => data.operationPermissions.includes(p))) { return 'setupPermissions'; }

        if (mode === 'solo' && !data.readPermissions.includes('balance')) { return 'setupBalancePermission'; }
    } catch { return 'setupPointsUnavailable'; }
}

export async function chooseCreation(ctx: PluginContext, session: Session, args: string[], templates: ReplyConfiguration) {
    const [name, fee, amount] = args, mode = Object.hasOwn(MODES, name) ? MODES[name] : undefined;
    requireRule(mode && args.length <= 3 && (!fee || fee === '免费' || fee === '积分') && !(fee === '免费' && amount !== undefined), '创建参数无效，发送 /恶魔轮盘 帮助');
    const prefix = `/恶魔轮盘 新建 ${name}`;
    const values = { mode: modeKey(mode) };
    const back = { draftBack: prefix };

    if (!fee) {
        return renderMessage(templates, 'setupMode', { values, dynamic: { draftFree: prefix + ' 免费', draftPoints: prefix + ' 积分' } });
    }

    const config = await configuration(ctx, session), cfg = config.values;
    let reason = fee === '免费' ? cfg.freeEnabled ? undefined : 'setupFreeDisabled' : !cfg.stakesEnabled ? 'setupPointsDisabled' : !cfg.calibrated ? 'setupUncalibrated' : undefined;

    // 仅积分入口查询一次来源；金额及难度选择不重复读取 Points，最终确认仍执行资金预检。
    if (!reason && fee === '积分' && amount === undefined) { reason = await pointsReason(ctx, mode); }

    if (reason) { return renderMessage(templates, 'setupBlocked', { values, reason, dynamic: back }); }

    const input = { ...values, min: String(cfg.minStake), max: String(cfg.maxStake), command: prefix + ' 积分 金额' };
    const amountButtons = { draftAmount: prefix + ' 积分 ', ...back };

    if (fee === '积分' && amount === undefined) { return renderMessage(templates, 'setupAmount', { values: input, dynamic: amountButtons }); }

    if (fee === '积分' && (!/^[1-9]\d*$/.test(amount) || !Number.isSafeInteger(Number(amount)) || Number(amount) < cfg.minStake || Number(amount) > cfg.maxStake)) {
        return renderMessage(templates, 'setupAmount', { values: input, dynamic: amountButtons, notice: 'setupAmountInvalid' });
    }

    const stake = fee === '免费' ? '免费' : String(Number(amount));

    if (mode !== 'solo') { return prepareCreate(ctx, session, [name, stake], templates, config); }

    const dynamic = Object.fromEntries(DIFFICULTIES.map((level, i) => [`draftLevel${i}`, `/恶魔轮盘 创建 ${name} ${stake} ${level}`]));
    dynamic.draftBack = fee === '积分' ? prefix + ' 积分' : prefix;

    return renderMessage(templates, 'setupDifficulty', { values: { ...values, stake: fee === '免费' ? '0' : stake }, dynamic });
}
