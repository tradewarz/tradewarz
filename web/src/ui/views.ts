// How the Terminal is set up - chain, filter, source, search, sort - remembered in this browser,
// and saved under names so a trader can flip between "Solana passes, newest" and "bundled pons
// launches by liquidity" in one click. Nothing here leaves the browser.

import type { Candidate, Chain } from '@tradewarz/shared';
import { isBundled } from '@tradewarz/shared';

export type SortKey = 'age' | 'liquidity' | 'mcap' | 'curve' | 'dev' | 'bundle' | 'chg5m' | 'vol5m' | 'bs5m' | 'score';
export type SortDir = 'asc' | 'desc';

export interface TerminalView {
  chain: 'all' | Chain;
  filter: 'all' | 'pass' | 'acted' | 'watching' | 'bundled';
  source: string;
  q: string;
  sort: SortKey;
  dir: SortDir;
}
export interface SavedView extends TerminalView { name: string; savedAt: number }

export const DEFAULT_VIEW: TerminalView = { chain: 'all', filter: 'all', source: 'all', q: '', sort: 'age', dir: 'desc' };

const CURRENT_KEY = 'tradewarz.terminal';
const SAVED_KEY = 'tradewarz.views';

export function loadCurrentView(): TerminalView {
  try { return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(CURRENT_KEY) ?? '{}') as Partial<TerminalView>) }; } catch { return { ...DEFAULT_VIEW }; }
}
export function storeCurrentView(v: TerminalView): void {
  try { localStorage.setItem(CURRENT_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}
export function savedViews(): SavedView[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedView[]; } catch { return []; }
}
export function saveView(name: string, v: TerminalView): SavedView[] {
  const list = savedViews().filter((x) => x.name !== name);
  list.unshift({ ...v, name, savedAt: Date.now() });
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* private mode */ }
  return list;
}
export function deleteView(name: string): SavedView[] {
  const list = savedViews().filter((x) => x.name !== name);
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return list;
}

/** The number a column sorts by; null sorts last whichever way. */
export function sortValue(c: Candidate, key: SortKey): number | null {
  switch (key) {
    case 'age': return c.createdAt ?? c.updatedAt;
    case 'liquidity': return c.liquidityUsd;
    case 'mcap': return c.marketCapUsd;
    case 'curve': return c.pons ? (c.pons.phase === 0 ? c.pons.progress : 1) : c.pump ? (c.pump.complete ? 1 : c.pump.progress) : null;
    case 'dev': return c.pons ? c.pons.devSharePct : c.pump ? c.pump.devSharePct : null;
    case 'bundle': return c.bundle ? c.bundle.supplyPct + (isBundled(c.bundle) ? 0 : 0) : null;
    case 'chg5m': return c.priceChangePct.m5;
    case 'vol5m': return c.volumeUsd.m5;
    case 'bs5m': { const t = c.txns.m5; return t ? (t.sells === 0 ? t.buys : t.buys / t.sells) : null; }
    case 'score': return c.listing ? c.listing.score : null;
  }
}

export function sortCandidates<T extends { c: Candidate }>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a.c, key), y = sortValue(b.c, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x === y ? 0 : x < y ? -sign : sign;
  });
}

export const SORT_LABEL: Record<SortKey, string> = { age: 'age', liquidity: 'liquidity', mcap: 'market cap', curve: 'curve', dev: 'dev share', bundle: 'bundle', chg5m: '5m change', vol5m: '5m volume', bs5m: 'buys/sells', score: 'score' };
