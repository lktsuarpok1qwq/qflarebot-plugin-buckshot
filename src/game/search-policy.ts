// 高档策略的计算上限与回合主动权权重；普通对局仍受配置的软时间预算约束。
export const SEARCH_POLICIES = {
    3: { nodes: 256, depth: 4, tempo: 8 },
    4: { nodes: 3072, depth: 10, tempo: 16 }
} as const;
