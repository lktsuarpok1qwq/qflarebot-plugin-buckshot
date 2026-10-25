import { formatPoints } from '../amounts.js';
import type { RoomState } from './model.js';

export function moneyReason(s: RoomState, kind: 'reserve' | 'release' | 'settle' | 'renew' | 'credit', reward = 0): string {
    const amount = formatPoints(s.stake), level = ['新手', '普通', '困难', '专家', '恶魔'][s.difficulty];
    const mode = s.mode === 'solo' ? '单人·' + level : s.members.length + '人对局';
    const description = kind === 'credit' ? `每日挑战获胜奖励 ${formatPoints(reward)} 积分；日期 ${s.challenge!.date}；难度 ${level}`
        : kind === 'reserve' ? `${mode}：每人冻结本金 ${amount} 积分，从可用余额转入冻结余额`
            : kind === 'release' ? `${s.status === 'CANCELLED' ? '对局取消' : '对局无胜者'}：退回冻结本金 ${amount} 积分`
                : kind === 'renew' ? `延长本金 ${amount} 积分的冻结期限，不重复扣款`
                    : s.game!.winner === 'ai' ? `${mode}失败：扣除已冻结本金 ${amount} 积分`
                        : s.mode === 'solo' ? `${mode}获胜：返还本金 ${amount}，奖励 ${formatPoints(reward)}，共到账 ${formatPoints(s.stake + reward)} 积分`
                            : `${mode}结算：每人本金 ${amount}，合计 ${formatPoints(s.stake * s.members.length)} 积分发给胜者`;

    return `恶魔轮盘：${description}；房间 ${s.gameId}`;
}
