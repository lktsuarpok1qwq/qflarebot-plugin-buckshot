export interface CachedName { group: string; value: string; nextLookup: number; token?: string }
export interface AdmissionName { value: string; token?: string; nextLookup?: number }

export function cleanName(value: unknown): string {
    return typeof value === 'string' ? value.replace(/[\r\n<>\[\](){}`\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
}
