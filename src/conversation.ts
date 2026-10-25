import type { SendTarget, Session } from '@qqbot/sdk';
import { identifier } from './config.js';
import { requireRule, type Mode } from './game/types.js';

const PRIVATE_PREFIX = 'c2c:';

export function isPrivateScope(scope: string): boolean { return scope.startsWith(PRIVATE_PREFIX); }

// 私聊使用独立会话键；玩家占用和积分身份仍使用同一 OpenID。
export function scopeFor(session: Pick<Session, 'scene' | 'targetId' | 'userId'>): string {
    requireRule(session.scene === 'group' || session.scene === 'c2c', '仅支持群聊和私聊');
    identifier(session.targetId);

    if (session.scene === 'c2c') {
        requireRule(session.targetId === session.userId, '私聊身份不符');
        const scope = PRIVATE_PREFIX + session.userId;
        identifier(scope);

        return scope;
    }

    requireRule(!isPrivateScope(session.targetId), '会话标识无效');

    return session.targetId;
}

export function targetFor(scope: string): SendTarget {
    identifier(scope);
    const id = isPrivateScope(scope) ? scope.slice(PRIVATE_PREFIX.length) : scope;
    identifier(id);

    return { scene: isPrivateScope(scope) ? 'c2c' : 'group', id };
}

export function validateConversation(scope: string, mode: Mode, owner: string): void {
    const target = targetFor(scope);

    if (target.scene === 'c2c') {
        requireRule(mode === 'solo', '私聊只支持单人对局');
        requireRule(target.id === owner, '私聊身份不符');
    }
}
