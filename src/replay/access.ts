export const REPLAY_FILE = /^\d{13}_(\d{2})(\d{2})(\d{2})_(solo|duo|multi)_([\w.-]+)_([a-f0-9]{32})(_daily)?\.bs$/;

// 链接持有者只能读取一个具有随机密钥的已归档对象，不提供公开列表。
export function replayPath(key: string): string { return '/p/buckshot/replay/#key=' + encodeURIComponent(key); }

export function replayLink(key: string, base?: string): string { return (base ?? '') + replayPath(key); }
