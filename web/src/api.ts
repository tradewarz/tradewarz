// The page's only conversation partner besides the chain RPCs. Every mutating call
// carries the x-tradewarz header (a cross-site form cannot add it) and the session cookie.

import type { ApiError, BoardView, Candidate, Chain, CopyStatus, HubInfo, IntelView, ListingsView, NonceRequest, NonceResponse, SessionUser, StrategyRecord } from '@tradewarz/shared';
import type { ReviewData } from './ui/Review.jsx';

const q = (chain: Chain, week: string) => `chain=${encodeURIComponent(chain)}&week=${encodeURIComponent(week)}`;

export class ApiFailure extends Error {
  constructor(public status: number, public body: ApiError) { super(body.error); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'x-tradewarz': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new ApiFailure(res.status, (json as ApiError) ?? { error: `hub answered ${res.status}` });
  return json as T;
}

export const api = {
  info: () => call<HubInfo>('GET', '/api/info'),
  me: () => call<{ me: SessionUser | null }>('GET', '/api/me'),
  nonce: (req: NonceRequest) => call<NonceResponse>('POST', '/api/auth/nonce', req),
  verify: (nonce: string, signature: string) => call<{ ok: true; me: SessionUser; created: boolean; purpose: string }>('POST', '/api/auth/verify', { nonce, signature }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
  refreshGate: () => call<{ me: SessionUser }>('POST', '/api/gate/refresh', {}),
  strategies: () => call<{ strategies: StrategyRecord[] }>('GET', '/api/strategies'),
  saveStrategy: (strategy: unknown, id?: string) => call<{ strategy: StrategyRecord }>('PUT', '/api/strategies', { id, strategy }),
  setActive: (id: string, active: boolean) => call<{ strategies: StrategyRecord[] }>('POST', `/api/strategies/${encodeURIComponent(id)}/active`, { active }),
  deleteStrategy: (id: string) => call<{ ok: true }>('DELETE', `/api/strategies/${encodeURIComponent(id)}`),
  watch: (client: string, w: { chain: Chain; token: string; tokens: string }) => call<{ ok: true; watching: number }>('POST', `/api/stream/watch?client=${encodeURIComponent(client)}`, w),
  unwatch: (client: string, w: { chain: Chain; token: string }) => call<{ ok: true; watching: number }>('DELETE', `/api/stream/watch?client=${encodeURIComponent(client)}`, w),
  streamState: () => call<{ feed: unknown; ethUsd: number | null; solUsd: number | null; candidates: number; tabs: number }>('GET', '/api/stream/state'),
  track: (chain: Chain, address: string) => call<{ ok: true; candidate: Candidate | null }>('POST', '/api/stream/track', { chain, address }),
  listings: (limit = 300) => call<ListingsView>('GET', `/api/listings?limit=${limit}`),
  intel: (limit = 200) => call<IntelView>('GET', `/api/intel?limit=${limit}`),
  ops: () => call<import('./ui/Ops.js').OpsData>('GET', '/api/ops'),
  copy: () => call<CopyStatus>('GET', '/api/copy'),
  handoff: () => call<{ code: string; expiresAt: number }>('POST', '/api/auth/handoff', {}),
  setControl: (patch: { paused?: boolean; notice?: string }) => call<import('@tradewarz/shared').HubControl>('POST', '/api/ops/control', patch),
  backups: () => call<{ dir: string; backups: Array<{ name: string; bytes: number; at: number }> }>('GET', '/api/ops/backups'),
  backupNow: () => call<{ name: string; bytes: number; at: number }>('POST', '/api/ops/backup', {}),
  claimHandoff: (code: string) => call<{ me: SessionUser }>('POST', '/api/auth/handoff/claim', { code }),

  // the contest
  board: (chain: Chain, week = 'current') => call<BoardView>('GET', `/api/board?${q(chain, week)}`),
  reportTrades: (chain: Chain, txs: string[], meta?: Record<string, { strategyId: string | null; manual: boolean; copied?: boolean }>) => call<{ ok: true; queued: number }>('POST', '/api/trades/report', { chain, txs, meta }),
  research: (chain: Chain | 'all', week: string) => call<import('./ui/Research.js').ResearchView>('GET', `/api/research/strategies?chain=${chain}&week=${encodeURIComponent(week)}`),
  myTrades: () => call<import('./ui/MyData.js').MyTradesView>('GET', '/api/me/trades'),
  setHandle: (handle: string) => call<{ ok: true; handle: string }>('PUT', '/api/profile/handle', { handle }),
  review: (chain: Chain, week = 'current') => call<ReviewData>('GET', `/api/review?${q(chain, week)}`),
  setReview: (userId: string, state: string, note: string, chain: Chain, week = 'current') =>
    call<ReviewData>('POST', `/api/review/${encodeURIComponent(userId)}?${q(chain, week)}`, { state, note }),
  rebuildEntry: (userId: string, chain: Chain, week = 'current') =>
    call<{ ok: true; trades: number }>('POST', `/api/review/${encodeURIComponent(userId)}/rebuild?${q(chain, week)}`, {}),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiFailure) return e.body.problems?.length ? `${e.body.error}: ${e.body.problems.join('; ')}` : e.body.error;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message).split('\n')[0] ?? 'failed';
  return String(e);
}
