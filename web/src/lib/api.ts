/**
 * REST client for god interventions.
 *
 * The admin token (when the server requires one) is held in localStorage and
 * sent as a header — never as a query parameter, so it stays out of proxy and
 * access logs.
 */

const TOKEN_KEY = 'civ.adminToken';

export const getToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const setToken = (v: string): void => {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked; the token simply won't persist */
  }
};

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const post = <T = { ok: boolean; message?: string }>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const get = <T>(path: string) => request<T>(path);

export const god = {
  pause: (paused?: boolean) => post('/api/god/pause', { paused }),
  speed: (tickMs: number) => post('/api/god/speed', { tickMs }),
  terraform: (x: number, y: number, radius: number, biome: string) =>
    post('/api/god/terraform', { x, y, radius, biome }),
  bless: (x: number, y: number, radius: number, ticks: number) =>
    post('/api/god/bless', { x, y, radius, ticks }),
  curse: (x: number, y: number, radius: number, ticks: number) =>
    post('/api/god/curse', { x, y, radius, ticks }),
  disaster: (kind: string, opts: Record<string, unknown>) =>
    post('/api/god/disaster', { kind, ...opts }),
  food: (opts: Record<string, unknown>) => post('/api/god/food', opts),
  inspire: (tribeId: number, tech?: string) => post('/api/god/inspire', { tribeId, tech }),
  births: (count: number, tribeId?: number) => post('/api/god/births', { count, tribeId }),
  smite: (opts: Record<string, unknown>) => post('/api/god/smite', opts),
  spawnTribe: (x: number, y: number, size: number) => post('/api/god/tribe', { x, y, size }),
  decree: (a: number, b: number, rel: string) => post('/api/god/decree', { a, b, rel }),
  reset: (seed?: number) => post('/api/god/reset', { seed }),
};
