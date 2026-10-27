import { StoredObject } from './storage.js';
import { challengeSeed } from '../game/random.js';
import { PlayerHistory, type PlayerReplay } from '../replay/history.js';
import { identifier } from '../config.js';
import { requireRule } from '../game/types.js';
import { isPrivateScope } from '../conversation.js';
import { cleanName, type AdmissionName, type CachedName } from './names.js';

export class BuckshotPlayerRegistry extends StoredObject {
    private history: PlayerHistory;

    constructor(state: DurableObjectState, env: unknown) {
        super(state, env, PlayerHistory.schema);
        this.history = new PlayerHistory(state.storage.sql);
    }

    async dailyChallenge(date: string, userId: string) {
        identifier(userId);
        requireRule(/^\d{4}-\d{2}-\d{2}$/.test(date), '每日挑战参数无效');
        requireRule(this.read<string>('challenge-used') !== date, '今日挑战已使用，请明天再来');
        const secret = this.ctx.storage.transactionSync(() => {
            const saved = this.read<number[]>('challenge-secret');

            if (saved) { return saved; }

            const value = [...crypto.getRandomValues(new Uint8Array(32))];
            this.write('challenge-secret', value);

            return value;
        });

        return challengeSeed(secret, date, userId);
    }

    replayHistory(before?: number) { return this.history.list(before); }

    statistics() { return this.history.statistics(); }

    claim(input: { botId: string; userId: string; gameId: string; groupId: string; claimId?: string; challengeDate?: string }, eventName?: string): AdmissionName {
        Object.values(input).forEach(identifier);

        return this.ctx.storage.transactionSync(() => {
            if (input.challengeDate) { requireRule(this.read<string>('challenge-used') !== input.challengeDate, '今日挑战已使用，请明天再来'); }

            const old = this.read<typeof input>('owner');
            requireRule(!old || JSON.stringify(old) === JSON.stringify(input), '你已在其他房间或等待安全关闭');

            if (!old) { this.write('owner', input); }

            return this.admissionName(input.groupId, eventName);
        });
    }

    private admissionName(group: string, eventName?: string): AdmissionName {
        if (eventName === undefined) { return { value: '' }; }

        const names = this.read<CachedName[]>('names') ?? [];
        const cached = names.find(n => n.group === group), now = Date.now();

        const fresh = cleanName(eventName), shared = [...names].reverse().find(n => n.value)?.value || '';

        if (cached && cached.nextLookup > now && (!fresh || fresh === cached.value) && (cached.value || !shared)) { return { value: cached.value, nextLookup: cached.nextLookup }; }

        const value = fresh || cached?.value || shared;
        const token = !fresh && !isPrivateScope(group) && (cached?.value || !value) ? crypto.randomUUID() : undefined;
        const next: CachedName = { group: group, value, nextLookup: now + (token ? 30000 : value ? 86400000 : 300000), ...(token ? { token } : {}) };
        this.write('names', [...names.filter(n => n.group !== group).slice(-7), next]);

        return { value, nextLookup: next.nextLookup, ...(token ? { token } : {}) };
    }

    private saveName(group: string, eventName: string): void {
        const value = cleanName(eventName);

        if (!value) { return; }

        const names = this.read<CachedName[]>('names') ?? [];

        if (names.some(n => n.group === group && n.value === value)) { return; }

        this.write('names', [...names.filter(n => n.group !== group).slice(-7), { group, value, nextLookup: Date.now() + 86400000 }]);
    }

    rememberName(group: string, eventName: string): void {
        identifier(group);
        this.ctx.storage.transactionSync(() => this.saveName(group, eventName));
    }

    webOwner(eventName: string) {
        return this.ctx.storage.transactionSync(() => {
            const owner = this.owner();

            if (owner) { this.saveName(owner.groupId, eventName); }

            return owner;
        });
    }

    nameForOwner(input: { botId: string; userId: string; gameId: string; groupId: string; claimId: string }, eventName: string): AdmissionName | null {
        return this.ctx.storage.transactionSync(() => {
            const owner = this.owner();

            if (!owner || owner.gameId !== input.gameId || owner.groupId !== input.groupId || (owner.claimId ?? owner.gameId) !== input.claimId) { return null; }

            return this.admissionName(input.groupId, eventName);
        });
    }

    finishName(group: string, token: string, value: string): string | null {
        return this.ctx.storage.transactionSync(() => {
            const names = this.read<CachedName[]>('names') ?? [];
            const cached = names.find(n => n.group === group);

            if (!cached || cached.token !== token) { return null; }

            const fresh = cleanName(value);
            cached.value = fresh || cached.value;
            cached.nextLookup = Date.now() + (fresh ? 86400000 : 300000);
            delete cached.token;
            this.write('names', names);

            return cached.value;
        });
    }

    owner() { return this.read<{ botId: string; userId: string; gameId: string; groupId: string; claimId?: string; challengeDate?: string }>('owner') ?? null; }

    release(gameId: string, claimId?: string, replay?: PlayerReplay, started = false): void {
        this.ctx.storage.transactionSync(() => {
            const owner = this.owner();

            if (owner?.gameId === gameId && (!claimId || owner.claimId === claimId)) {
                if (owner.challengeDate && started) { this.write('challenge-used', owner.challengeDate); }

                if (replay) { this.history.record(gameId, replay); }

                this.ctx.storage.sql.exec('DELETE FROM state WHERE id=?', 'owner');
            }
        });
    }
}
