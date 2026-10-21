/** Player actions return a Result: success with a value, or a human-readable reason to show. */
export type Result<T = void> = { ok: true; value: T } | { ok: false; reason: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (reason: string): Result<never> => ({ ok: false, reason });
