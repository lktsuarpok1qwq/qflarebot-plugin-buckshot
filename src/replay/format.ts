import type { ReplayWireStep } from './codec.js';
import type { RoomState } from '../room/model.js';
import type { Item } from '../game/types.js';
import { isPrivateScope } from '../conversation.js';

export const REPLAY_ZONE = 'Asia/Shanghai';
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;
export const MAX_REPLAY_STEPS = 2000;
export const REPLAY_ITEMS: Item[] = ['glass', 'beer', 'cigarette', 'saw', 'cuffs', 'jammer', 'phone', 'inverter', 'medicine', 'adrenaline', 'remote'];
export interface ReplayPlayer { id: string; name: string; ai?: true }
export interface ReplayTracking { version: number; key: string; base?: string; bytes: number; count: number; truncated: boolean; ids: Record<string, string>; players: ReplayPlayer[] }
export interface ReplayAction { type: string; slot?: number; item?: number; target?: string; stolenSlot?: number; stolenTarget?: string }
export interface ReplayResult { k: string; v?: Record<string, string | number | [string]>; to?: string; ammo?: (0 | 1)[] }
export interface ReplayState {
    status: string; current?: string; turn?: number; direction?: -1; saw?: true; paused?: true;
    players: { p: string; hp: number; items: number[]; control?: 'skip' | 'release'; ready?: true; timeouts?: number }[];
}
export interface ReplayStep { actor?: string; action: ReplayAction; state: ReplayState; results?: ReplayResult[] }
export interface ReplayHeader {
    format: 'buckshot-replay'; version: 5;
    adminAI?: [string, import('../game/personality.js').Personality][];
    game: { id: string; mode: string; challengeDate?: string; dailyRewardMinor?: number; difficulty?: number; startedAt: string; endedAt?: string; scene: 'group' | 'c2c'; stakeMinor?: number; winner?: string };
    config?: { turnSeconds?: number; readSeconds?: number; multiplier?: number }; players: ReplayPlayer[]; integrity: { complete: boolean; reason?: string };
}
export interface ReplayFile extends ReplayHeader { steps: ReplayWireStep[] }

let timeFormatter: Intl.DateTimeFormat | undefined;

export function dateParts(time: number) {
    const formatter = timeFormatter ??= new Intl.DateTimeFormat('en-CA', { timeZone: REPLAY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = formatter.formatToParts(time);
    const part = (name: string) => parts.find(p => p.type === name)!.value;

    return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}:${part('second')}` };
}

export function replayPrefix(bot: string) { return `replays/bs1/${encodeURIComponent(bot)}/`; }

export function replayKey(s: RoomState) {
    const started = s.statistics?.startedAt ?? s.createdAt, part = dateParts(started), reverse = String(9999999999999 - started).padStart(13, '0');

    return `${replayPrefix(s.botId)}${part.date}/${reverse}_${part.time.replaceAll(':', '')}_${s.mode}_${s.gameId}_${crypto.randomUUID().replaceAll('-', '')}${s.challenge ? '_daily' : ''}.bs`;
}

export function playerId(s: RoomState, id?: string | null): string | undefined {
    if (!id || id === 'admin') { return undefined; }

    const tracking = s.replay!;

    if (!tracking.ids[id]) { tracking.ids[id] = id === 'ai' ? 'ai' : `p${Object.keys(tracking.ids).filter(k => k !== 'ai').length + 1}`; }

    return tracking.ids[id];
}

function refreshPlayers(s: RoomState): void {
    for (const p of s.game?.players ?? s.members.map(m => ({ ...m, ai: false }))) {
        const id = playerId(s, p.id)!, saved = s.replay!.players.find(p => p.id === id);

        const name = p.ai ? p.name : s.members.find(m => m.id === p.id)?.name ?? p.name;

        if (saved) { saved.name = name; } else { s.replay!.players.push({ id, name, ...(p.ai ? { ai: true as const } : {}) }); }
    }
}

export function replayHeader(s: RoomState): ReplayHeader {
    refreshPlayers(s);
    const c = s.config.values, config = { readSeconds: c.aiReadSeconds, ...(c.turnSeconds !== 60 ? { turnSeconds: c.turnSeconds } : {}), ...(s.stake && s.mode === 'solo' ? { multiplier: c.multipliers[s.difficulty] / 1000 } : {}) };

    return {
        format: 'buckshot-replay', version: 5,
        adminAI: s.mode === 'solo' && s.aiPersonality ? [[playerId(s, 'ai')!, s.aiPersonality]] : (s.opponents ?? []).map(p => [playerId(s, p.id)!, p.personality]),
        game: { id: s.gameId, mode: s.mode, ...(s.challenge ? { challengeDate: s.challenge.date, dailyRewardMinor: c.dailyReward } : {}), startedAt: new Date(s.statistics?.startedAt ?? s.createdAt).toISOString(), scene: isPrivateScope(s.groupId) ? 'c2c' : 'group', ...(s.mode === 'solo' ? { difficulty: s.difficulty } : {}), ...(s.stake ? { stakeMinor: s.stake } : {}), ...(s.status === 'CLOSED' ? { endedAt: new Date().toISOString() } : {}), ...(s.game?.winner ? { winner: playerId(s, s.game.winner) } : {}) },
        ...(Object.keys(config).length ? { config } : {}), players: structuredClone(s.replay!.players),
        integrity: { complete: !s.replay!.truncated, ...(s.replay!.truncated ? { reason: '记录达到大小或操作步数上限，后续步骤未收录' } : {}) }
    };
}

export function snapshot(s: RoomState): ReplayState {
    refreshPlayers(s);
    const g = s.game;

    return {
        status: g?.finished ? 'FINISHED' : s.status, ...(g ? { current: playerId(s, g.current), turn: g.turn } : {}), ...(g?.direction === -1 ? { direction: -1 as const } : {}), ...(g?.saw ? { saw: true as const } : {}), ...(s.paused ? { paused: true as const } : {}),
        players: g ? g.players.map(p => ({ p: playerId(s, p.id)!, hp: p.life, items: p.inventory.map(i => REPLAY_ITEMS.indexOf(i)), ...(p.control !== 'none' ? { control: p.control } : {}), ...(p.timeouts ? { timeouts: p.timeouts } : {}) })) : s.members.map(p => ({ p: playerId(s, p.id)!, hp: 4, items: [], ...(p.ready ? { ready: true as const } : {}) }))
    };
}

// 操作只保存选择，不保存回调、消息标识或隐藏状态。
export function safeAction(s: RoomState, action: Record<string, unknown>, actor?: string): ReplayAction {
    if (action.type === 'play' && action.move && typeof action.move === 'object') { return safeAction(s, action.move as Record<string, unknown>, actor); }

    const safe: ReplayAction = { type: String(action.type) };

    for (const key of ['slot', 'stolenSlot'] as const) { if (Number.isSafeInteger(action[key])) { safe[key] = action[key] as number; } }

    for (const key of ['target', 'stolenTarget'] as const) { if (typeof action[key] === 'string') { safe[key] = playerId(s, action[key]); } }

    if (safe.type === 'item' && safe.slot !== undefined && actor) {
        const item = s.game?.players.find(p => p.id === actor)?.inventory[safe.slot];

        if (item) { safe.item = REPLAY_ITEMS.indexOf(item); }
    }

    return safe;
}

export function operationStep(s: RoomState, action: ReplayAction, actor: string | undefined, previousSeq: number): ReplayStep {
    refreshPlayers(s);
    const results: ReplayResult[] = [];
    const players = s.game?.players ?? s.members;

    const append = (part: NonNullable<import('../game/types.js').GameEvent['message']>, recipient?: string) => {
        if (['reminder', 'intel', 'noIntel'].includes(part.key)) { return; }

        const v: NonNullable<ReplayResult['v']> = {};

        for (const [key, value] of Object.entries(part.values)) {
            if (key === 'gameId' || key === 'replayUrl') { continue; }

            const id = part.users?.[key];
            const matched = id ? players.filter(p => p.id === id) : ['actor', 'target', 'name'].includes(key) ? players.filter(p => p.name === value) : [];
            v[key] = matched.length === 1 ? [playerId(s, matched[0].id)!] : ['shell', 'count', 'live', 'blank', 'position', 'loadId'].includes(key) ? Number(value) : value;
        }

        results.push({ k: part.key, ...(part.key === 'load' && s.game ? { ammo: s.game.shells.slice() } : {}), ...(Object.keys(v).length ? { v } : {}), ...(recipient ? { to: playerId(s, recipient) } : {}) });
    };

    if (s.web) {
        for (const event of s.operationEvents ?? []) {
            if (event.type !== 'intel' && event.message) { append(event.message, event.recipient); }
        }
    }

    const hasFinish = s.web && s.operationEvents?.some(e => e.type === 'finish');

    for (const task of s.outbox) {
        if (task.seq <= previousSeq) { continue; }

        const recipient = task.private ? s.members.find(m => m.privateId === task.target)?.id : undefined;

        for (const part of task.parts ?? []) {
            if (part.key !== 'finish' || !hasFinish) { append(part, recipient); }
        }
    }

    for (const event of s.replayIntel ?? []) {
        if (!event.message || !event.recipient) { continue; }

        results.push({ k: event.message.key, to: playerId(s, event.recipient), ...(event.intel ? { v: { loadId: event.loadId!, position: Number(event.message.values.position), shell: event.intel.shell } } : {}) });
    }

    return { ...(actor ? { actor: playerId(s, actor) } : {}), action, state: snapshot(s), ...(results.length ? { results } : {}) };
}
