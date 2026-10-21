/** Same budget as rule 10.b of cotizadores: an external call gets 30 seconds. */
export const HTTP_TIMEOUT_MS = 30_000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}
