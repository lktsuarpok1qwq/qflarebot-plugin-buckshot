import type { ReplayAction, ReplayResult, ReplayState, ReplayStep } from './format.js';

export type ReplayWireStep = [string | null, unknown[], unknown[], unknown[][]?];

// v5 固定字典与完整状态数组；同一编解码器用于写入端和浏览器，不依赖前后步骤。
export function createReplayCodec() {
    const items = ['glass', 'beer', 'cigarette', 'saw', 'cuffs', 'jammer', 'phone', 'inverter', 'medicine', 'adrenaline', 'remote'];
    const actions = ['create', 'join', 'leave', 'ready', 'start', 'shoot', 'item', 'timeout', 'quit', 'removed', 'pause', 'resume', 'cancel', 'abort'];
    const fields = ['slot', 'target', 'stolenSlot', 'stolenTarget', 'item'] as const;
    const statuses = ['WAITING', 'PREPARING', 'PLAYING', 'FINISHED', 'SETTLING', 'SETTLED', 'CANCELLED', 'CLOSED'];
    const results = [
        ['load', ['count', 'live', 'blank']], ['shot', ['actor', 'target', 'shell']], ['item', ['actor', 'item', 'target']], ['steal', ['actor', 'target', 'item']],
        ['skip', ['name']], ['eject', ['shell']], ['eliminate', ['name']], ['timeout', ['name']], ['timeoutEliminate', ['name']], ['finish', ['name']], ['noWinner', ['name']], ['intel', ['loadId', 'position', 'shell']], ['noIntel', []], ['matchCancelled', []]
    ] as const;
    const fail = (): never => { throw Error('回放紧凑编码无效'); };
    const trim = (v: unknown[]) => {
        while (v.length > 1 && v.at(-1) === null) { v.pop(); }

        return v;
    };
    const index = (value: unknown, list: readonly unknown[]) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < list.length;
    const encodeAction = (a: ReplayAction): unknown[] => {
        const code = actions.indexOf(a.type);

        if (code < 0) { fail(); }

        return trim([code, ...fields.map(k => a[k] ?? null)]);
    };
    const decodeAction = (v: unknown): ReplayAction => {
        if (!Array.isArray(v) || v.length < 1 || v.length > 6 || !index(v[0], actions)) { return fail(); }

        const a: Record<string, unknown> = { type: actions[v[0]] };
        fields.forEach((k, i) => { if (v[i + 1] !== undefined && v[i + 1] !== null) { a[k] = v[i + 1]; } });

        return a as unknown as ReplayAction;
    };
    const encodeResult = (r: ReplayResult): unknown[] => {
        const code = results.findIndex(([key]) => key === r.k);

        if (code < 0) { return fail(); }

        const names: readonly string[] = results[code][1];

        if (r.v && Object.keys(r.v).some(k => !names.includes(k))) { return fail(); }

        const values = r.v ? names.map(k => {
            const value = r.v![k];

            if (k === 'item' && value !== undefined) {
                const item = items.indexOf(String(value));

                if (item < 0) { return fail(); }

                return item;
            }

            return value ?? null;
        }) : null;

        return trim([code, values ? trim(values) : null, r.to ?? null, r.ammo ?? null]);
    };
    const decodeResult = (v: unknown): ReplayResult => {
        if (!Array.isArray(v) || v.length < 1 || v.length > 4 || !index(v[0], results)) { return fail(); }

        const [k, names] = results[v[0]], r: ReplayResult = { k };

        if (v[1] !== undefined && v[1] !== null) {
            if (!Array.isArray(v[1]) || v[1].length > names.length) { return fail(); }

            r.v = {};
            const values = r.v;
            names.forEach((name, i) => {
                const value = v[1][i];

                if (value === null || value === undefined) { return; }

                if (name === 'item' && !index(value, items)) { fail(); }

                values[name] = name === 'item' ? items[value] : value;
            });
        }

        if (v[2] !== undefined && v[2] !== null) { r.to = v[2]; }

        if (v[3] !== undefined && v[3] !== null) { r.ammo = v[3]; }

        return r;
    };
    const encodeState = (state: ReplayState): unknown[] => {
        const status = statuses.indexOf(state.status);

        if (status < 0) { return fail(); }

        return [status, state.current ?? null, state.turn ?? null, state.direction ?? null, state.saw ?? null, state.paused ?? null,
            state.players.map(p => trim([p.p, p.hp, p.items, p.control ?? null, p.ready ?? null, p.timeouts ?? null]))];
    };
    const decodeState = (v: unknown): ReplayState => {
        if (!Array.isArray(v) || v.length !== 7 || !index(v[0], statuses) || !Array.isArray(v[6]) || v[6].length > 4) { return fail(); }

        const present = (value: unknown): boolean => value !== null && value !== undefined;
        const id = (value: unknown) => typeof value === 'string' && value.length > 0;

        if (present(v[1]) && !id(v[1]) || present(v[2]) && (!Number.isSafeInteger(v[2]) || v[2] < 1) || present(v[3]) && v[3] !== -1 || present(v[4]) && v[4] !== true || present(v[5]) && v[5] !== true) { return fail(); }

        const players = v[6].map((p: unknown) => {
            if (!Array.isArray(p) || p.length < 3 || p.length > 6 || !id(p[0]) || !Number.isInteger(p[1]) || p[1] < 0 || p[1] > 4 || !Array.isArray(p[2]) || p[2].length > 8 || p[2].some(i => !index(i, items))) { return fail(); }

            if (present(p[3]) && !['skip', 'release'].includes(p[3]) || present(p[4]) && p[4] !== true || present(p[5]) && (!Number.isSafeInteger(p[5]) || p[5] < 0)) { return fail(); }

            return { p: p[0], hp: p[1], items: p[2], ...(present(p[3]) ? { control: p[3] } : {}), ...(present(p[4]) ? { ready: p[4] } : {}), ...(present(p[5]) ? { timeouts: p[5] } : {}) };
        });

        if (new Set(players.map(p => p.p)).size !== players.length || present(v[1]) && !players.some(p => p.p === v[1])) { return fail(); }

        return { status: statuses[v[0]], ...(present(v[1]) ? { current: v[1] } : {}), ...(present(v[2]) ? { turn: v[2] } : {}), ...(present(v[3]) ? { direction: v[3] } : {}), ...(present(v[4]) ? { saw: v[4] } : {}), ...(present(v[5]) ? { paused: v[5] } : {}), players };
    };
    const encodeStep = (step: ReplayStep): ReplayWireStep => {
        const value: ReplayWireStep = [step.actor ?? null, encodeAction(step.action), encodeState(step.state)];

        if (step.results !== undefined) { value.push(step.results.map(encodeResult)); }

        return value;
    };
    const decodeStep = (step: unknown): ReplayStep => {
        if (!Array.isArray(step) || step.length < 3 || step.length > 4 || step[0] !== null && (typeof step[0] !== 'string' || !step[0]) || step[3] !== undefined && (!Array.isArray(step[3]) || step[3].length > 100)) { return fail(); }

        return { ...(step[0] !== null ? { actor: step[0] } : {}), action: decodeAction(step[1]), state: decodeState(step[2]), ...(step[3] !== undefined ? { results: step[3].map(decodeResult) } : {}) };
    };

    return { items, actions, statuses, results, encodeAction, decodeAction, encodeResult, decodeResult, encodeState, decodeState, encodeStep, decodeStep };
}

export const replayCodec = createReplayCodec();
