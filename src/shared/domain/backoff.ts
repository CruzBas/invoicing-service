export const MINUTE = 60_000;

/** 1, 2, 4… minutes, capped at one hour. */
export function backoff(attempt: number): Date {
  const delay = Math.min(MINUTE * 2 ** Math.min(attempt, 10), 60 * MINUTE);
  return new Date(Date.now() + delay);
}
