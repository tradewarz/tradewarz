// What the bot remembers across reloads, in this browser's IndexedDB: positions (open and
// recently closed), the daily ledger for the budget and the loss breaker, and per-token
// cooldowns. No keys here, ever.

import type { Chain } from '@tradewarz/shared';

export interface Exit { at: number; tokens: string; valueWei: string; reason: string; tx: string | null }
export interface Position {
  id: string; chain: Chain; strategyId: string;
  token: string; curve: string | null; symbol: string; name: string;
  openedAt: number; entryTx: string | null;
  /** Native spent on entry (wei / lamports), as a decimal string. */
  entryWei: string;
  /** Tokens held right now (raw units). */
  tokens: string;
  /** Tokens bought at entry (raw units), for ladder percentages. */
  tokensAtEntry: string;
  lastWei: string; lastAt: number; peakWei: string;
  /** Pool liquidity high-water mark for the drain exit (wei of quote reserve), when known. */
  liqPeakWei: string | null;
  ladderDone: number[]; // indices of ladder steps already sold
  status: 'open' | 'closed';
  exits: Exit[];
  venue: 'curve' | 'pool' | 'none';
  /** Bought by hand from the Terminal rather than by the rules. */
  manual?: boolean;
  /** False = hand-held: the bot prices it and shows it, but only you sell it. Missing = managed. */
  managed?: boolean;
  /** Closed without a sale: the token had no market, so the whole entry was booked as a loss. The tokens are still in the wallet. */
  writtenOff?: boolean;
  /** Opened by copying this followed wallet (its address) - shown as the label the person gave it. */
  copiedFrom?: string;
  copyLabel?: string;
}
export interface DayLedger { day: string; chain: Chain; spentWei: string; realizedWei: string; entries: number }
export interface Cooldown { key: string; until: number; reason: string }

const DB_NAME = 'tradewarz-bot';
const STORES = ['positions', 'ledger', 'cooldowns'] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}
async function all<T>(store: Store): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as T[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function put(store: Store, key: string, value: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function del(store: Store, key: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const utcDay = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);

export const botStore = {
  positions: () => all<Position>('positions'),
  savePosition: (p: Position) => put('positions', p.id, p),
  deletePosition: (id: string) => del('positions', id),
  ledger: () => all<DayLedger>('ledger'),
  saveLedger: (l: DayLedger) => put('ledger', `${l.chain}:${l.day}`, l),
  cooldowns: () => all<Cooldown>('cooldowns'),
  saveCooldown: (c: Cooldown) => put('cooldowns', c.key, c),
  deleteCooldown: (key: string) => del('cooldowns', key),
};
