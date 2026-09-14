// Rolling tx velocity (TPM) from real trade prints. The hub's Robinhood websocket already
// counts curve trades; Solana does the same when a trade stream is on. This module turns a
// stream of prints — or, as a fallback, DexScreener-shaped 5m/1h txn totals — into 1m / 5m /
// 15m rates, a heat label, and a quiet→hot "just lit" flag for the minute a token starts
// printing. Pure and O(bursts in the window); no scans of the whole book.

import { txnCount, type Candidate, type Heat, type TxVelocity } from './candidate.js';

export const WINDOW_MS = { m1: 60_000, m5: 300_000, m15: 900_000 } as const;

/**
 * Calibrated to IPO-style Robinhood tape (~90 tx/min, ~470 trades in 5 min on the main pool)
 * without lighting up on 2–3 thin-tape prints.
 */
export const TPM = {
  /** Below this, treat as thin / glitch tape — not "printing". */
  thin: 4,
  /** Several prints a minute; worth a glance, not a siren. */
  warming: 8,
  /** A print every few seconds. The "hot tape" floor. */
  hot: 16,
  /** IPO-like clip. */
  blaze: 60,
  /** How long the LIT badge stays after a quiet→hot crossing. */
  litMs: 90_000,
} as const;

/** A single ingest (one SSE candidate) should not dump a whole hour onto the 1-minute tape. */
const MAX_PRINTS_PER_INGEST = 250;
const MAX_BURSTS = 2_000;

const TXN_WINDOWS = ['h24', 'h6', 'h1', 'm5'] as const;

interface Burst { at: number; n: number }
interface Tape {
  bursts: Burst[];
  heat: Heat;
  /** Last snapshot's 1-minute tape was already at the hot floor. */
  oneMinHot: boolean;
  litAt: number | null;
}

export function classifyHeat(tpm1m: number, tpm5m: number): Heat {
  const v = Math.max(tpm1m, tpm5m);
  if (v >= TPM.hot) return 'hot';
  if (v >= TPM.warming) return 'warming';
  return 'quiet';
}

export const isThinTape = (v: TxVelocity | null | undefined): boolean =>
  !v || (v.tpm1m < TPM.thin && v.tpm5m < TPM.thin);

export const isHotTape = (v: TxVelocity | null | undefined): boolean =>
  !!v && (v.heat === 'hot' || v.justLit);

export const isJustLit = (v: TxVelocity | null | undefined): boolean => !!v && v.justLit;

/** Number the TPM column sorts by: live 1m when we have prints, else the 5m average. */
export function tpmRank(c: Candidate): number | null {
  const v = c.velocity;
  if (v) {
    const n = v.tpm1m > 0 ? v.tpm1m : v.tpm5m;
    return n > 0 ? n : null;
  }
  const n5 = txnCount(c, 'm5');
  return n5 !== null && n5 > 0 ? n5 / 5 : null;
}

export function emptyVelocity(): TxVelocity {
  return {
    trades1m: 0, trades5m: 0, trades15m: 0,
    tpm1m: 0, tpm5m: 0, tpm15m: 0,
    accel: 1, heat: 'quiet', justLit: false, litAt: null, source: 'windows',
  };
}

/** 5m / 1h txn windows only — no 1-minute tape, so justLit is always false. */
export function velocityFromWindows(c: Candidate): TxVelocity {
  const trades5m = txnCount(c, 'm5') ?? 0;
  const trades1h = txnCount(c, 'h1');
  const trades15m = trades1h !== null ? Math.round(trades1h / 4) : trades5m;
  const tpm5m = trades5m / 5;
  const tpm15m = trades15m / 15;
  return {
    trades1m: 0,
    trades5m,
    trades15m,
    tpm1m: 0,
    tpm5m,
    tpm15m,
    accel: 1,
    heat: classifyHeat(0, tpm5m),
    justLit: false,
    litAt: null,
    source: 'windows',
  };
}

function isHubVelocity(v: TxVelocity | null | undefined): v is TxVelocity {
  return !!v && typeof v.tpm1m === 'number' && typeof v.tpm5m === 'number' && v.source !== 'prints' && v.source !== 'windows';
}

/**
 * How many new trade prints this snapshot implies versus the last one. First sighting
 * records nothing (a hello of 400 five-minute trades must not land as 400 in this second).
 * Prefers txn-window increases (real prints) over reserve ticks; caps a glitch delta.
 */
export function countPrints(prev: Candidate | undefined, next: Candidate): number {
  if (!prev) return 0;
  for (const w of TXN_WINDOWS) {
    const a = prev.txns[w];
    const b = next.txns[w];
    if (!b) continue;
    const nextN = b.buys + b.sells;
    const prevN = a ? a.buys + a.sells : null;
    if (prevN === null) {
      // Window just appeared. A fat hydrate is history dumped in one snapshot; a small
      // number is live tape on a token we were already watching with empty txn fields.
      if (nextN > 0 && nextN < 30) return Math.min(nextN, MAX_PRINTS_PER_INGEST);
      continue;
    }
    const d = nextN - prevN;
    if (d > 0) return Math.min(d, MAX_PRINTS_PER_INGEST);
  }
  if (prev.pons && next.pons && prev.pons.quoteReserve !== next.pons.quoteReserve) return 1;
  if (prev.pump && next.pump && (prev.pump.realSol !== next.pump.realSol || prev.pump.vSol !== next.pump.vSol)) return 1;
  return 0;
}

function countIn(bursts: Burst[], now: number, windowMs: number): number {
  const since = now - windowMs;
  let n = 0;
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]!;
    if (b.at < since) break;
    n += b.n;
  }
  return n;
}

function trim(tape: Tape, now: number): void {
  const floor = now - WINDOW_MS.m15;
  const bursts = tape.bursts;
  let i = 0;
  while (i < bursts.length && bursts[i]!.at < floor) i++;
  if (i > 0) tape.bursts = bursts.slice(i);
  if (tape.bursts.length > MAX_BURSTS) tape.bursts = tape.bursts.slice(-MAX_BURSTS);
}

function snapshotTape(tape: Tape, c: Candidate, now: number): TxVelocity {
  trim(tape, now);
  const fromWindows = velocityFromWindows(c);
  const trades1m = countIn(tape.bursts, now, WINDOW_MS.m1);
  const trades5mTape = countIn(tape.bursts, now, WINDOW_MS.m5);
  const trades15mTape = countIn(tape.bursts, now, WINDOW_MS.m15);
  const trades5m = Math.max(trades5mTape, fromWindows.trades5m);
  const trades15m = Math.max(trades15mTape, fromWindows.trades15m);
  const tpm1m = trades1m;
  const tpm5m = trades5m / 5;
  const tpm15m = trades15m / 15;
  const accel = tpm1m > 0 ? tpm1m / Math.max(tpm5m, 1) : 1;
  const heat = classifyHeat(tpm1m, tpm5m);
  const oneMinHot = tpm1m >= TPM.hot;
  // Ignition is a 1-minute crossing, not a fat 5m window we inherited on hello.
  if (oneMinHot && !tape.oneMinHot) tape.litAt = now;
  if (!oneMinHot) tape.litAt = null;
  tape.oneMinHot = oneMinHot;
  tape.heat = heat;
  const justLit = tape.litAt !== null && now - tape.litAt < TPM.litMs && oneMinHot;
  const source: TxVelocity['source'] = trades15mTape > 0 ? 'prints' : 'windows';
  return {
    trades1m, trades5m, trades15m,
    tpm1m, tpm5m, tpm15m,
    accel, heat, justLit, litAt: justLit ? tape.litAt : null,
    source,
  };
}

/** Per-token rolling tape. One book for the whole stream. */
export class TapeBook {
  private tapes = new Map<string, Tape>();

  ingest(key: string, prev: Candidate | undefined, next: Candidate, now = Date.now()): TxVelocity {
    if (isHubVelocity(next.velocity)) {
      const n = countPrints(prev, next);
      if (n > 0) this.record(key, n, now);
      return next.velocity.source === 'hub' ? next.velocity : { ...next.velocity, source: 'hub' };
    }
    const n = countPrints(prev, next);
    if (n > 0) this.record(key, n, now);
    const tape = this.tapes.get(key) ?? { bursts: [], heat: 'quiet' as Heat, oneMinHot: false, litAt: null };
    this.tapes.set(key, tape);
    return snapshotTape(tape, next, now);
  }

  drop(key: string): void { this.tapes.delete(key); }
  clear(): void { this.tapes.clear(); }
  size(): number { return this.tapes.size; }

  private record(key: string, n: number, now: number): void {
    let tape = this.tapes.get(key);
    if (!tape) { tape = { bursts: [], heat: 'quiet', oneMinHot: false, litAt: null }; this.tapes.set(key, tape); }
    const last = tape.bursts[tape.bursts.length - 1];
    if (last && last.at === now) last.n += n;
    else tape.bursts.push({ at: now, n });
    trim(tape, now);
  }
}
