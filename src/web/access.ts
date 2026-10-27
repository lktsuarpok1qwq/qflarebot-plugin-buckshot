import { requireRule } from '../game/types.js';
import type { RoomState } from '../room/model.js';

export const WEB_LIFETIME = 4 * 60 * 60 * 1000;
export const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');

export async function digest(value: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}

export function encodeLocator(group: string, game: string, actor: string, key: string) {
    return btoa(JSON.stringify([group, game, actor, key])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeLocator(value: unknown) {
    requireRule(typeof value === 'string' && /^[A-Za-z0-9_-]{1,1400}$/.test(value), '入口已失效，请私聊重新领取');
    const parsed = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    requireRule(Array.isArray(parsed) && parsed.length === 4 && parsed.every(v => typeof v === 'string' && /^[\w:-]{1,160}$/.test(v)) && /^[a-f0-9]{64}$/.test(parsed[3]), '入口已失效，请私聊重新领取');

    return { group: parsed[0] as string, game: parsed[1] as string, actor: parsed[2] as string, key: parsed[3] as string };
}

export function webAccess(s: RoomState, actor: string, hash: string, now = Date.now()) {
    const session = s.web?.access[actor]?.session;
    requireRule(session && session.digest === hash && session.expires > now && (!s.web?.endedAt || s.web.endedAt + 15 * 60000 > now), '会话已失效，请私聊重新领取');
    requireRule(s.members.some(m => m.id === actor), '你不在本局');

    return session;
}

export function claimable(s: RoomState, now = Date.now()) {
    requireRule(s.web && ['WEB_JOINING', 'PREPARING', 'PLAYING'].includes(s.status), '当前没有可进入的网页对局');
    requireRule(s.status !== 'WEB_JOINING' || s.web.joiningUntil! > now, '网页入场已到期');
}
