import { WEB_TIMING as timing } from './timing.js';
import { secureRandom } from '../game/types.js';
import { legalActions } from '../game/engine.js';
import type { Action, GameEvent } from '../game/types.js';
import type { RoomState } from '../room/model.js';
import { replayLink } from '../replay/access.js';

export function beginWebFrame(s: RoomState, actor?: string, move?: Action, now = Date.now()) {
    if (!s.web) { return; }

    const player = s.game?.players.find(p => p.id === actor);
    const item = move?.type === 'item' ? player?.inventory[move.slot] : undefined;
    s.web.frame = {
        id: ++s.web.sequence, at: now, until: now, actor, move,
        item, sawed: !!s.game?.saw, stolenItem: item === 'adrenaline' && move?.type === 'item' ? s.game?.players.find(p => p.id === move.target)?.inventory[move.stolenSlot!] : undefined,
        before: s.game?.players.map(p => ({ id: p.id, life: p.life, items: p.inventory.slice() })) ?? [], events: []
    };
}

export function webEvents(s: RoomState, events: GameEvent[], now: number) {
    const frame = s.web!.frame!;
    frame.events.push(...events);
    const item = frame.stolenItem ?? frame.item;
    const actionMs = frame.move?.type === 'shoot' || item === 'beer' ? timing.shot : item === 'glass' ? timing.glass : item === 'phone' ? timing.phone : frame.item ? timing.item : 0;
    const load = events.find(e => e.type === 'load');
    const loadMs = load ? s.config.values.aiReadSeconds * 1000 + ((load.live ?? 0) + (load.blank ?? 0)) * timing.cartridge + timing.loading : 0;
    frame.until = frame.at + Math.max(actionMs + (frame.stolenItem ? timing.stolen : 0) + loadMs, s.config.values.actionDelaySeconds * 1000);
    s.resultUntil = frame.until;
    // 动画已经包含等待，AI 下一步只补足配置的间隔，不重复相加。
    const min = Math.round(s.config.values.aiIntervalMin * 10), max = Math.round(s.config.values.aiIntervalMax * 10);
    s.aiPaceUntil = Math.max(frame.until, now + (min + (max > min ? secureRandom(max - min + 1) : 0)) * 100);
}

// 同次广播和 HTTP 回执复用公开投影；私密情报与合法动作始终按接收者生成。
export function webProjection(s: RoomState, now = Date.now()) {
    const g = s.game;
    const players = g?.players ?? [...s.members.map(p => ({ ...p, ai: false, life: 4, inventory: [], control: 'none' })), ...(s.opponents ?? []).map(p => ({ ...p, ai: true, life: 4, inventory: [], control: 'none' }))];
    const id = (value?: string | null) => value ? 'p' + players.findIndex(p => p.id === value) : undefined;
    const action = (move: Action) => ({ ...move, ...('target' in move && move.target ? { target: id(move.target) } : {}), ...(move.type === 'item' && move.stolenTarget ? { stolenTarget: id(move.stolenTarget) } : {}) });
    const f = s.web?.frame;
    const frame = f && f.until > now ? {
        id: f.id, at: f.at, until: f.until, actor: id(f.actor), move: f.move && action(f.move), item: f.item, sawed: !!f.sawed, stolenItem: f.stolenItem,
        before: f.before.map(p => ({ id: id(p.id), life: p.life, items: p.items }))
    } : undefined;
    const events = frame ? f!.events.map(e => {
        if (e.type === 'intel') {
            const item = f!.stolenItem ?? f!.item;
            const message = e.intel ? `第 ${Number(e.message?.values.position)} 发是${e.intel.shell ? '实弹' : '空弹'}` : '电话没有提供情报';
            const expires = f!.at + (f!.stolenItem ? timing.stolen : 0) + (item === 'phone' ? timing.item + Array.from(message).length * 85 + 3000 : timing.glass);

            return { recipient: e.recipient, value: { type: e.type, expires, intel: e.intel ? { position: Number(e.message?.values.position), shell: e.intel.shell } : null } };
        }

        return { value: { type: e.type, ...(e.type === 'load' ? { live: e.live, blank: e.blank } : {}), ...(e.type === 'shot' || e.type === 'eject' ? { shell: Number(e.message?.values.shell) } : {}) } };
    }) : [];
    const common = {
        gameId: s.gameId, version: s.version, status: s.status, mode: s.mode,
        now, readSeconds: s.config.values.aiReadSeconds, deadline: s.deadline, joiningUntil: s.web?.joiningUntil,
        paused: s.paused, recovery: s.recovery, nextTarget: g ? id(Array.from({ length: players.length - 1 }, (_, n) => players[(players.findIndex(p => p.id === g.current) + g.direction * (n + 1) + players.length) % players.length]).find(p => p.life > 0)?.id) : undefined, current: id(g?.current), winner: id(g?.winner), finished: !!g?.finished,
        saw: !!g?.saw, direction: g?.direction ?? 1,
        players: players.map(p => ({ id: id(p.id), name: p.name, avatar: !p.ai && /^\d+$/.test(s.botId) && /^[A-Fa-f0-9]{32}$/.test(p.id) ? `https://thirdqq.qlogo.cn/qqapp/${s.botId}/${p.id}/640` : undefined, ai: p.ai, life: p.life, items: p.inventory, control: p.control === 'skip', ready: p.ai || !!s.web?.access[p.id]?.session?.ready })),
        stake: s.stake, challengeDate: s.challenge?.date, reward: s.challenge ? s.config.values.dailyReward : undefined,
        money: s.money.map(t => ({ kind: t.kind, state: t.state })),
        statistics: g?.finished && s.statistics ? { shots: s.statistics.shots, live: s.statistics.live, blank: s.statistics.blank, items: s.statistics.items, duration: (s.statistics.finishedAt ?? now) - (s.statistics.startedAt ?? now) } : undefined,
        replay: s.status === 'CLOSED' && s.web?.replayReady && s.replay ? replayLink(s.replay.key, s.replay.base) : undefined,
        terminal: ['CLOSED', 'CANCELLED'].includes(s.status)
    };
    const project = (actor: string) => {
        const canAct = s.status === 'PLAYING' && !s.paused && !s.recovery && !frame && s.deadline !== undefined && s.deadline > now && g?.current === actor;

        return {
            ...common, self: id(actor), host: s.host === actor, ready: !!s.web?.access[actor]?.session?.ready,
            frame: frame ? { ...frame, events: events.filter(e => e.value.type !== 'intel' || e.recipient === actor && e.value.expires! > now).map(e => e.value) } : undefined,
            moves: canAct ? legalActions(g!, actor).map(action) : []
        };
    };
    const views = new Map<string, ReturnType<typeof project>>();

    return (actor: string) => {
        let value = views.get(actor);

        if (!value) {
            value = project(actor);
            views.set(actor, value);
        }

        return value;
    };
}

export function webView(s: RoomState, actor: string, now = Date.now()) { return webProjection(s, now)(actor); }

export function webMove(s: RoomState, input: Action): Action {
    const target = (value: string | undefined) => {
        if (value === undefined) { return undefined; }

        if (!/^p[0-3]$/.test(value)) { throw Error('目标无效'); }

        const player = s.game?.players[Number(value.slice(1))];

        if (!player) { throw Error('目标无效'); }

        return player.id;
    };

    if (input.type === 'shoot') { return { type: 'shoot', target: target(input.target)! }; }

    if (input.type !== 'item' || !Number.isSafeInteger(input.slot)) { throw Error('操作无效'); }

    return { type: 'item', slot: input.slot, ...(input.target ? { target: target(input.target) } : {}), ...(input.stolenSlot !== undefined ? { stolenSlot: input.stolenSlot } : {}), ...(input.stolenTarget ? { stolenTarget: target(input.stolenTarget) } : {}) };
}
