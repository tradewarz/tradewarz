// Coins you starred in the Terminal. Kept in this browser so a launch you flagged stays visible
// (and buyable) even after the hub has stopped streaming it. Nothing here trades on its own.

import type { Candidate, Chain } from '@tradewarz/shared';

export interface Watched { chain: Chain; address: string; symbol: string; name: string; at: number }

const KEY = 'tradewarz.watchlist';
let cache: Watched[] | null = null;

function load(): Watched[] {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Watched[]; } catch { cache = []; }
  return cache;
}
function save(list: Watched[]): void {
  cache = list;
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-300))); } catch { /* private mode: the list lives for this tab only */ }
}

export const keyOf = (chain: Chain, address: string): string => `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
export const watchlist = (): Watched[] => load();
export const isWatched = (chain: Chain, address: string): boolean => load().some((w) => keyOf(w.chain, w.address) === keyOf(chain, address));

/** Star or unstar. Returns the new state. */
export function toggleWatch(c: Pick<Candidate, 'chain' | 'address' | 'symbol' | 'name'>): boolean {
  const k = keyOf(c.chain, c.address);
  const list = load();
  const i = list.findIndex((w) => keyOf(w.chain, w.address) === k);
  if (i >= 0) { list.splice(i, 1); save([...list]); return false; }
  save([...list, { chain: c.chain, address: c.address, symbol: c.symbol, name: c.name, at: Date.now() }]);
  return true;
}
