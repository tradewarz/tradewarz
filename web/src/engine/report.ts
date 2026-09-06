// Telling the hub where to look.
//
// The bot trades from the tab, so only the tab knows a transaction happened. It reports the
// hash and nothing else — the hub reads the receipt and works out the amounts itself, so there
// is no version of this where saying something false gets you a better score.
//
// It reads hashes back out of the bot's own store rather than being called at each trade, which
// means a tab that was closed mid-trade, or reloaded, still reports what it did as soon as it
// comes back. Reporting the same hash twice costs nothing.

import type { Chain } from '@tradewarz/shared';
import { api } from '../api.js';
import { botStore } from './store.js';

const SENT_KEY = 'tradewarz.reported';
const EVERY_MS = 20_000;

let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;

function sent(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function remember(hashes: Set<string>): void {
  // Keep the list bounded: a week of trading is a few hundred hashes.
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...hashes].slice(-2000))); } catch { /* private mode: we re-report, which is free */ }
}

export interface ReportMeta { strategyId: string | null; manual: boolean }

/** Every transaction this browser's bot has made and not yet reported, by chain, with which rules (or a hand buy) sent it. */
async function pending(): Promise<Map<Chain, { hashes: string[]; meta: Record<string, ReportMeta> }>> {
  const already = sent();
  const out = new Map<Chain, { hashes: string[]; meta: Record<string, ReportMeta> }>();
  for (const p of await botStore.positions()) {
    const hashes = [p.entryTx, ...p.exits.map((x) => x.tx)].filter((h): h is string => !!h && !already.has(h));
    if (!hashes.length) continue;
    const entry = out.get(p.chain) ?? { hashes: [], meta: {} };
    const m: ReportMeta = { strategyId: p.strategyId === 'manual' || !p.strategyId ? null : p.strategyId, manual: !!p.manual };
    for (const h of hashes) { if (!entry.hashes.includes(h)) entry.hashes.push(h); entry.meta[h] = m; }
    out.set(p.chain, entry);
  }
  return out;
}

export async function reportOnce(): Promise<number> {
  if (sending) return 0;
  sending = true;
  let reported = 0;
  try {
    const byChain = await pending();
    if (!byChain.size) return 0;
    const done = sent();
    for (const [chain, { hashes: all, meta }] of byChain) {
      for (let i = 0; i < all.length; i += 50) {
        const batch = all.slice(i, i + 50);
        try {
          await api.reportTrades(chain, batch, Object.fromEntries(batch.map((h) => [h, meta[h]!])));
          for (const h of batch) done.add(h);
          reported += batch.length;
        } catch {
          // No bot wallet registered yet, or the hub is down: try again on the next pass.
          remember(done);
          return reported;
        }
      }
    }
    remember(done);
  } finally {
    sending = false;
  }
  return reported;
}

export function startReporting(): void {
  if (timer !== null) return;
  void reportOnce();
  timer = setInterval(() => { void reportOnce(); }, EVERY_MS);
}
export function stopReporting(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
