// The bot. One engine, one instance per chain, living in the tab: it reacts to the hub stream and
// signs with the bot wallet. Everything chain-specific sits behind a ChainAdapter (adapters.ts).
//
// candidate message → rules (shared evaluate) → chain pre-buy gate (pons tax) → platform rails →
//   entry style → buy → position saved → hub asked for marks
// mark message → update value/peak/liquidity → exits (drain, stop, ladder, take profit, trailing)
//   → sell → ledger updated
// tick message → time-based exits, balance refresh, day rollover, health
//
// Every decision is written down with its reasons so the Bot panel can show exactly why.

import { GUARDRAILS, buyWithinPoolLimit, dailyBreakerTripped, evaluate, preset, type Candidate, type Chain, type Strategy, type StreamMessage } from '@tradewarz/shared';
import { adapters, baseAdapter, bscAdapter, robinhoodAdapter, solanaAdapter, type ChainAdapter } from './adapters.js';
import { CHAINS, type NativeSymbol } from '@tradewarz/shared';
import { botStore, utcDay, type Cooldown, type DayLedger, type Position } from './store.js';
import { engineLease } from './lease.js';
import { hubStream } from './stream.js';

export type Verdict = 'buy' | 'skip' | 'hold' | 'exit' | 'error' | 'info';
/** How long a position may sit with no market (no venue, or worth nothing) before it is written off. */
const DEAD_AFTER_MS = 30 * 60_000;

// Write-offs are also remembered here, outside the position store: a tab still running an older
// build keeps saving its stale copy of a position, and this is what stops that copy from
// resurrecting one you removed. Applied on every load.
const TOMBSTONES_KEY = 'tradewarz.writtenOff';
function tombstones(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(TOMBSTONES_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function addTombstone(id: string): void {
  const s = tombstones(); s.add(id);
  try { localStorage.setItem(TOMBSTONES_KEY, JSON.stringify([...s].slice(-500))); } catch { /* private mode */ }
}
export interface Decision { at: number; token: string; symbol: string; verdict: Verdict; reasons: string[]; tx?: string }

export interface BotState {
  chain: Chain;
  native: NativeSymbol;
  decimals: number;
  running: boolean;
  strategyId: string | null;
  connected: boolean;
  silenceSec: number;
  /** Smallest units (wei / lamports). */
  balance: bigint | null;
  need: bigint;
  candidatesSeen: number;
  passingNow: number;
  open: Position[];
  closed: Position[];
  spentToday: bigint;
  realizedToday: bigint;
  breakerTripped: boolean;
  decisions: Decision[];
  lastError: string | null;
  nativeUsd: number | null;
  wakeLock: boolean;
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

type RevertLike = {
  shortMessage?: string; message?: string; metaMessages?: string[];
  reason?: string; signature?: string; raw?: string; data?: { errorName?: string }; cause?: RevertLike;
};
/**
 * The useful half of an error. viem's top line stops at 'reverted with the following signature:'
 * and the signature itself is further down the cause chain, so walk to it — an unnamed 4-byte
 * selector is still something you can look up, and "reverted" alone is not. Plain errors pass through.
 */
export function describeRevert(e: unknown): string {
  const err = (e ?? {}) as RevertLike;
  const bits: string[] = [];
  if (err.shortMessage) bits.push(err.shortMessage);
  else if (err.message) bits.push(err.message.split('\n').map((l) => l.trim()).find(Boolean) ?? 'failed');
  let cause = err.cause;
  for (let i = 0; i < 6 && cause; i++) {
    const named = cause.data?.errorName ?? cause.signature ?? cause.raw;
    if (named) { bits.push(`reverted with ${named}`); break; }
    if (cause.reason) { bits.push(cause.reason); break; }
    cause = cause.cause;
  }
  const meta = (err.metaMessages ?? []).map((m) => m.trim()).filter((m) => m && !/^contract call/i.test(m));
  if (bits.length < 2 && meta.length) bits.push(meta[0]!);
  return (bits.join(' — ') || 'failed').slice(0, 240);
}

export class Bot {
  private strategy: Strategy | null = null;
  private strategyId: string | null = null;
  private positions = new Map<string, Position>();
  private ledger = new Map<string, DayLedger>();
  private cooldowns = new Map<string, Cooldown>();
  private busy = new Set<string>();
  /** Positions whose sell keeps failing: how many times, and when it is worth trying again. */
  private sellFails = new Map<string, { n: number; until: number }>();
  /** When each open position was first seen without a market (see DEAD_AFTER_MS). */
  private deadSince = new Map<string, number>();
  private lastVerdict = new Map<string, string>();
  private samples = new Map<string, Array<{ t: number; p: number }>>();
  private decisions: Decision[] = [];
  private listeners = new Set<() => void>();
  private off: (() => void) | null = null;
  private balance: bigint | null = null;
  private balanceAt = 0;
  private lastError: string | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private ticks = 0;
  running = false;
  /** The switch as the person set it; `running` is that AND this tab holding the engine lease. */
  private wantRunning = false;
  private reloadTimer: number | null = null;

  constructor(readonly a: ChainAdapter) {}
  get chain(): Chain { return this.a.chain; }
  private key(address: string): string { return this.chain === 'solana' ? address : address.toLowerCase(); }
  private same(a: string, b: string): boolean { return this.key(a) === this.key(b); }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private changed(): void { for (const l of this.listeners) l(); if (engineLease.active) engineLease.announceChange(); }

  private primed = false;
  /**
   * Load what this chain's bot remembers and start listening for prices — without switching the
   * rules on. This is what lets you buy by hand, watch a position and sell it while the bot is off.
   */
  async prime(rpcUrl: string): Promise<void> {
    this.a.setRpc(rpcUrl);
    if (this.primed) return;
    this.primed = true;
    const [positions, ledger, cooldowns] = await Promise.all([botStore.positions(), botStore.ledger(), botStore.cooldowns()]);
    this.positions.clear(); for (const p of positions) if (p.chain === this.chain) this.positions.set(p.id, p);
    this.ledger.clear(); for (const l of ledger) if (l.chain === this.chain) this.ledger.set(l.day, l);
    this.cooldowns.clear(); for (const c of cooldowns) if (c.until > Date.now() && c.key.startsWith(`${this.chain}:`)) this.cooldowns.set(c.key, c);
    await this.applyTombstones();
    hubStream.start();
    engineLease.start();
    this.off = hubStream.on((m) => { void this.onMessage(m); });
    // Viewers re-read the shared store when the trading tab says something changed (and every few seconds regardless);
    // a tab that inherits the lease reloads once and then runs the bot the person switched on.
    engineLease.onChange(() => { if (!engineLease.active) this.scheduleReload(); });
    engineLease.on(() => {
      if (engineLease.active) { void this.reload().then(() => { if (this.wantRunning && this.strategy && !this.running) void this.start(this.strategy, this.strategyId ?? '', ''); }); }
      else if (this.running) { this.running = false; this.note('info', '', 'bot', ['another TradeWarz tab took over trading; this tab now only shows your positions']); }
      this.changed();
    });
    if (!engineLease.active) this.scheduleReload();
    for (const p of this.openPositions()) void hubStream.watch(this.chain, p.token, BigInt(p.tokens));
    void this.refreshBalance(true);
    this.changed();
  }

  /** Re-read positions, ledger and cooldowns from the shared store (another tab may have changed them). */
  async reload(): Promise<void> {
    const [positions, ledger, cooldowns] = await Promise.all([botStore.positions(), botStore.ledger(), botStore.cooldowns()]);
    this.positions.clear(); for (const p of positions) if (p.chain === this.chain) this.positions.set(p.id, p);
    await this.applyTombstones();
    this.ledger.clear(); for (const l of ledger) if (l.chain === this.chain) this.ledger.set(l.day, l);
    this.cooldowns.clear(); for (const c of cooldowns) if (c.until > Date.now() && c.key.startsWith(`${this.chain}:`)) this.cooldowns.set(c.key, c);
    this.changed();
  }
  /** A position removed earlier that a stale tab has re-saved as open is closed again, quietly. */
  private async applyTombstones(): Promise<void> {
    const dead = tombstones();
    if (!dead.size) return;
    for (const pos of this.positions.values()) {
      if (pos.status !== 'open' || !dead.has(pos.id)) continue;
      pos.status = 'closed'; pos.lastWei = '0'; pos.writtenOff = true;
      if (!pos.exits.some((x) => x.reason.startsWith('written off'))) pos.exits = [...pos.exits, { at: Date.now(), tokens: pos.tokens, valueWei: '0', reason: 'written off: removed earlier (re-applied)', tx: null }];
      if (engineLease.active) await botStore.savePosition(pos).catch(() => undefined);
    }
  }
  private scheduleReload(): void {
    if (this.reloadTimer !== null) return;
    this.reloadTimer = window.setTimeout(() => { this.reloadTimer = null; void this.reload(); }, 1_000);
  }
  /** Is this the tab that trades? Everything that signs or writes asks first. */
  private mustBeActive(): void {
    if (!engineLease.active) throw new Error('your bots are running in another TradeWarz tab; this tab only shows them. Close the other tab, or use "Run here".');
  }

  async start(strategy: Strategy, strategyId: string, rpcUrl: string): Promise<void> {
    if (rpcUrl) await this.prime(rpcUrl);
    this.strategy = strategy; this.strategyId = strategyId;
    this.wantRunning = true;
    if (!engineLease.active) {
      // Another tab holds the engine: remember the wish, trade the moment the lease arrives here.
      this.setOnce('lease', 'standby', () => this.note('info', '', 'bot', [`${strategy.name} is running in your other TradeWarz tab; this tab only shows positions`]));
      this.changed();
      return;
    }
    if (!this.running) {
      this.running = true;
      void this.requestWakeLock();
      document.addEventListener('visibilitychange', this.onVisibility);
      this.note('info', '', 'bot', [`started: ${strategy.name}`]);
      for (const c of hubStream.candidates.values()) if (c.chain === this.chain) void this.consider(c);
    } else {
      this.note('info', '', 'bot', [`rules updated: ${strategy.name}`]);
    }
    this.changed();
  }

  stop(): void {
    this.wantRunning = false;
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock?.release(); this.wakeLock = null;
    this.note('info', '', 'bot', ['stopped: open positions are no longer managed until you switch on again (they stay priced, and you can still sell by hand)']);
    this.changed();
  }

  /**
   * Buy by hand. `target` is a candidate the hub is showing, or a bare address the person pasted.
   * `manage` = let the running bot apply its exits (stop loss, ladder, take profit, drain); false =
   * hand-held: priced and shown, sold only when you press Sell.
   */
  async buyNow(target: Candidate, sizeNative: number, opts: { slippagePct: number; manage: boolean }): Promise<Position> {
    this.mustBeActive();
    if (!(sizeNative > 0)) throw new Error('enter an amount');
    const size = this.a.parse(sizeNative);
    const key = this.key(target.address);
    if (this.busy.has(key)) throw new Error('already buying this token');
    await this.refreshBalance(true);
    if (this.balance !== null && this.balance < size + this.a.gasReserve) throw new Error(`the bot wallet holds ${this.a.format(this.balance)} ${this.a.native}; this buy needs ${this.a.format(size + this.a.gasReserve)} ${this.a.native} including fees`);
    const usd = this.a.nativeUsd();
    if (usd && target.liquidityUsd !== null) {
      const lim = buyWithinPoolLimit(sizeNative * usd, target.liquidityUsd);
      if (!lim.ok) throw new Error(`${sizeNative} ${this.a.native} is more than ${GUARDRAILS.maxBuyPctOfPoolLiquidity}% of this pool's liquidity — at most about $${lim.maxUsd.toFixed(0)} here`);
    }
    // The strategy only lends its slippage and (on Robinhood) its tax ceiling to a manual buy.
    const base = this.strategy ?? preset('balanced', this.chain);
    const s: Strategy = { ...base, entry: { ...base.entry, slippagePct: opts.slippagePct } };
    const manage = opts.manage && this.running;
    this.busy.add(key);
    try {
      const hold = await this.a.preBuy(target, s);
      if (hold) throw new Error(hold.replace('; will retry', ''));
      const res = await this.a.buy(target, size, s);
      const pos: Position = {
        id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, chain: this.chain, strategyId: manage ? this.strategyId ?? 'manual' : 'manual',
        token: target.address, curve: this.a.curveOf(target), symbol: target.symbol || target.address.slice(0, 6), name: target.name, openedAt: Date.now(), entryTx: res.hash, entryWei: size.toString(),
        tokens: res.tokens.toString(), tokensAtEntry: res.tokens.toString(), lastWei: size.toString(), lastAt: Date.now(), peakWei: size.toString(),
        liqPeakWei: this.a.liquidityPeak(target), ladderDone: [], status: 'open', exits: [], venue: res.venue, manual: true, managed: manage,
      };
      this.positions.set(pos.id, pos);
      await botStore.savePosition(pos);
      const day = this.today();
      day.spentWei = (BigInt(day.spentWei) + size).toString(); day.entries++;
      await botStore.saveLedger(day);
      await hubStream.watch(this.chain, target.address, res.tokens);
      this.balanceAt = 0; void this.refreshBalance(true);
      this.note('buy', target.address, pos.symbol, [`bought by hand: ${this.a.format(size)} ${this.a.native} of ${pos.symbol} ${res.note}${manage ? '; the bot manages the exits' : '; hand-held until you sell'}`], res.hash);
      return pos;
    } catch (e) {
      this.note('error', target.address, target.symbol || target.address.slice(0, 6), [`manual buy failed: ${describeRevert(e)}`]);
      throw e;
    } finally {
      this.busy.delete(key);
    }
  }

  /** Hand a position to the bot's exits, or take it back. */
  async setManaged(positionId: string, managed: boolean): Promise<void> {
    this.mustBeActive();
    const pos = this.positions.get(positionId);
    if (!pos) throw new Error('no such position');
    pos.managed = managed;
    await botStore.savePosition(pos);
    this.note('info', pos.token, pos.symbol, [managed ? `${pos.symbol}: the bot now manages the exits` : `${pos.symbol}: hand-held; only you sell it`]);
  }

  /**
   * Take a dead position off the books. Nothing is sold - there is nothing to sell into - so the
   * tokens stay in the wallet and the whole entry is booked as today's loss. Used by hand from the
   * positions list, and by the bot once a token has had no market for DEAD_AFTER_MS.
   */
  async writeOff(positionId: string, reason: string): Promise<void> {
    this.mustBeActive();
    const pos = this.positions.get(positionId);
    if (!pos || pos.status !== 'open') throw new Error('no such open position');
    const held = BigInt(pos.tokens);
    const basis = (BigInt(pos.entryWei) * held) / BigInt(pos.tokensAtEntry || pos.tokens || '1');
    pos.exits = [...pos.exits, { at: Date.now(), tokens: held.toString(), valueWei: '0', reason: `written off: ${reason}`, tx: null }];
    pos.status = 'closed'; pos.lastWei = '0'; pos.writtenOff = true;
    addTombstone(pos.id);
    const day = this.today();
    day.realizedWei = (BigInt(day.realizedWei) - basis).toString();
    await botStore.saveLedger(day);
    await botStore.savePosition(pos);
    await hubStream.unwatch(this.chain, pos.token).catch(() => undefined);
    this.sellFails.delete(pos.id); this.deadSince.delete(pos.id);
    this.note('exit', pos.token, pos.symbol, [`${pos.symbol} written off as a total loss (${this.a.format(basis)} ${this.a.native}): ${reason}. The tokens stay in the bot wallet.`]);
    this.changed();
  }

  updateStrategy(strategy: Strategy): void { this.strategy = strategy; this.lastVerdict.clear(); this.changed(); }

  state(): BotState {
    const day = this.today();
    const mine = [...hubStream.candidates.values()].filter((c) => c.chain === this.chain);
    return {
      chain: this.chain, native: this.a.native, decimals: this.a.decimals,
      running: this.running, strategyId: this.strategyId, connected: hubStream.connected, silenceSec: hubStream.silenceSec(),
      balance: this.balance, need: this.needNative(), candidatesSeen: mine.length,
      passingNow: this.strategy ? mine.filter((c) => evaluate(c, this.strategy!).pass).length : 0,
      open: this.openPositions(), closed: [...this.positions.values()].filter((p) => p.status === 'closed').sort((a, b) => (b.exits.at(-1)?.at ?? 0) - (a.exits.at(-1)?.at ?? 0)).slice(0, 20),
      spentToday: BigInt(day.spentWei), realizedToday: BigInt(day.realizedWei), breakerTripped: this.breaker(), decisions: this.decisions.slice(-60).reverse(),
      lastError: this.lastError, nativeUsd: this.a.nativeUsd(), wakeLock: !!this.wakeLock,
    };
  }

  // ---- internals ----------------------------------------------------------------------------
  private openPositions(): Position[] { return [...this.positions.values()].filter((p) => p.status === 'open').sort((a, b) => b.openedAt - a.openedAt); }
  private today(): DayLedger { const day = utcDay(); let l = this.ledger.get(day); if (!l) { l = { day, chain: this.chain, spentWei: '0', realizedWei: '0', entries: 0 }; this.ledger.set(day, l); } return l; }
  private needNative(): bigint { return (this.strategy ? this.a.parse(this.strategy.entry.sizeNative) : 0n) + this.a.gasReserve; }
  private breaker(): boolean {
    if (!this.strategy) return false;
    const realized = Number(this.a.format(BigInt(this.today().realizedWei), 9));
    return realized < 0 && dailyBreakerTripped(-realized, this.strategy.entry.dailyBudgetNative);
  }
  private note(verdict: Verdict, token: string, symbol: string, reasons: string[], tx?: string): void {
    this.decisions.push({ at: Date.now(), token, symbol, verdict, reasons, tx });
    if (this.decisions.length > 400) this.decisions.splice(0, this.decisions.length - 400);
    if (verdict === 'error') this.lastError = reasons[0] ?? null;
    this.changed();
  }
  private onVisibility = () => { if (document.visibilityState === 'visible') void this.requestWakeLock(); };
  private async requestWakeLock(): Promise<void> {
    try {
      if (!this.running || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; this.changed(); });
      this.changed();
    } catch { /* not granted: fine, the page still runs while visible */ }
  }
  private async refreshBalance(force = false): Promise<void> {
    if (!force && Date.now() - this.balanceAt < 30_000) return;
    try { this.balance = await this.a.balance(); this.balanceAt = Date.now(); this.changed(); } catch { /* keep the old value */ }
  }

  private async onMessage(m: StreamMessage): Promise<void> {
    if (!engineLease.active) { if (m.kind === 'tick') this.changed(); return; }
    // Prices flow whether or not the rules are on: a hand-held position still wants its PnL.
    if (m.kind === 'mark' && m.chain === this.chain) { await this.onMark(m); return; }
    if (m.kind === 'tick') {
      this.ticks++;
      if (this.ticks % 3 === 0 && this.openPositions().length) void this.refreshBalance();
      if (this.running && this.strategy) await this.timeExits();
      this.changed();
      return;
    }
    if (!this.running || !this.strategy) return;
    if (m.kind === 'candidate' && m.candidate.chain === this.chain) await this.consider(m.candidate);
    else if (m.kind === 'hello') { for (const c of m.candidates) if (c.chain === this.chain) await this.consider(c); }
  }

  private async consider(c: Candidate): Promise<void> {
    const s = this.strategy!;
    const key = this.key(c.address);
    if (this.busy.has(key)) return;
    if ([...this.positions.values()].some((p) => p.status === 'open' && this.same(p.token, c.address))) return;
    const cd = this.cooldowns.get(`${this.chain}:${key}`);
    if (cd && cd.until > Date.now()) return;

    // price samples for pullback / breakout entries
    if (c.priceNative !== null) {
      const arr = this.samples.get(key) ?? [];
      arr.push({ t: c.updatedAt, p: c.priceNative });
      const cutoff = Date.now() - 4 * 3_600_000;
      while (arr.length && arr[0]!.t < cutoff) arr.shift();
      this.samples.set(key, arr);
    }

    const ev = evaluate(c, s);
    const sig = ev.pass ? 'pass' : ev.reasons.join('|');
    if (!ev.pass) {
      if (this.lastVerdict.get(key) !== sig) { this.lastVerdict.set(key, sig); this.note('skip', c.address, c.symbol, ev.reasons.slice(0, 3)); }
      return;
    }

    // platform rails and budget
    const rails: string[] = [];
    const open = this.openPositions().length;
    if (open >= s.entry.maxOpenPositions) rails.push(`${open} position${open === 1 ? '' : 's'} open, your maximum is ${s.entry.maxOpenPositions}`);
    const size = this.a.parse(s.entry.sizeNative);
    const day = this.today();
    if (BigInt(day.spentWei) + size > this.a.parse(s.entry.dailyBudgetNative)) rails.push(`today's budget is used up (${this.a.format(BigInt(day.spentWei))} of ${s.entry.dailyBudgetNative} ${this.a.native})`);
    if (this.breaker()) rails.push(`the daily loss breaker is tripped (${this.a.format(BigInt(day.realizedWei))} ${this.a.native} today); new entries resume tomorrow UTC`);
    if (this.balance !== null && this.balance < size + this.a.gasReserve) rails.push(`the bot wallet holds ${this.a.format(this.balance)} ${this.a.native}; one buy needs ${this.a.format(size + this.a.gasReserve)} ${this.a.native} including fees. Deposit more or lower the buy size.`);
    const usd = this.a.nativeUsd();
    if (usd && c.liquidityUsd !== null) {
      const lim = buyWithinPoolLimit(s.entry.sizeNative * usd, c.liquidityUsd);
      if (!lim.ok) rails.push(`${s.entry.sizeNative} ${this.a.native} is more than ${GUARDRAILS.maxBuyPctOfPoolLiquidity}% of this pool's liquidity (max about $${lim.maxUsd.toFixed(0)} here)`);
    }
    if (rails.length) {
      const rs = 'rail:' + rails.join('|');
      if (this.lastVerdict.get(key) !== rs) { this.lastVerdict.set(key, rs); this.note('skip', c.address, c.symbol, rails); }
      return;
    }

    // entry style
    if (s.entry.style !== 'instant') {
      const arr = this.samples.get(key) ?? [];
      const now = Date.now();
      const cur = c.priceNative ?? 0;
      if (s.entry.style === 'pullback') {
        const win = arr.filter((x) => now - x.t <= s.entry.pullback.windowMinutes * 60_000);
        const peak = win.reduce((m, x) => Math.max(m, x.p), 0);
        const drop = peak > 0 ? ((peak - cur) / peak) * 100 : 0;
        if (!(drop >= s.entry.pullback.minPct && drop <= s.entry.pullback.maxPct)) { this.setOnce(key, `pb:${drop.toFixed(0)}`, () => this.note('hold', c.address, c.symbol, [`passes your rules; waiting for a ${s.entry.pullback.minPct}–${s.entry.pullback.maxPct}% pullback (now ${drop.toFixed(1)}% off the ${s.entry.pullback.windowMinutes}-minute high)`])); return; }
      } else if (s.entry.style === 'breakout') {
        const win = arr.filter((x) => now - x.t <= s.entry.breakout.lookbackMinutes * 60_000 && now - x.t > 5_000);
        const high = win.reduce((m, x) => Math.max(m, x.p), 0);
        if (!(win.length >= 3 && cur > high)) { this.setOnce(key, 'bo', () => this.note('hold', c.address, c.symbol, [`passes your rules; waiting for a break above the ${s.entry.breakout.lookbackMinutes}-minute high`])); return; }
      }
    }

    await this.buy(c, size);
  }
  private setOnce(key: string, sig: string, fn: () => void): void { if (this.lastVerdict.get(key) !== sig) { this.lastVerdict.set(key, sig); fn(); } }

  private async buy(c: Candidate, size: bigint): Promise<void> {
    const s = this.strategy!;
    const key = this.key(c.address);
    this.busy.add(key);
    try {
      const hold = await this.a.preBuy(c, s);
      if (hold) { this.setOnce(key, `hold:${hold}`, () => this.note('hold', c.address, c.symbol, [hold])); return; }
      const res = await this.a.buy(c, size, s);
      const pos: Position = {
        id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, chain: this.chain, strategyId: this.strategyId ?? '',
        token: c.address, curve: this.a.curveOf(c), symbol: c.symbol, name: c.name, openedAt: Date.now(), entryTx: res.hash, entryWei: size.toString(),
        tokens: res.tokens.toString(), tokensAtEntry: res.tokens.toString(), lastWei: size.toString(), lastAt: Date.now(), peakWei: size.toString(),
        liqPeakWei: this.a.liquidityPeak(c), ladderDone: [], status: 'open', exits: [], venue: res.venue,
      };
      this.positions.set(pos.id, pos);
      await botStore.savePosition(pos);
      const day = this.today();
      day.spentWei = (BigInt(day.spentWei) + size).toString(); day.entries++;
      await botStore.saveLedger(day);
      await hubStream.watch(this.chain, c.address, res.tokens);
      this.balanceAt = 0; void this.refreshBalance(true);
      this.note('buy', c.address, c.symbol, [`bought ${this.a.format(size)} ${this.a.native} of ${c.symbol} ${res.note}`], res.hash);
    } catch (e) {
      this.note('error', c.address, c.symbol, [`buy failed: ${describeRevert(e)}`]);
      await this.cooldown(key, 2, 'buy failed');
    } finally {
      this.busy.delete(key);
    }
  }

  private async cooldown(key: string, minutes: number, reason: string): Promise<void> {
    const cd: Cooldown = { key: `${this.chain}:${key}`, until: Date.now() + minutes * 60_000, reason };
    this.cooldowns.set(cd.key, cd);
    await botStore.saveCooldown(cd);
  }

  /** The rules in force for exits and slippage: the live strategy, or the chain's Balanced preset when the bot is off. */
  private rules(): Strategy { return this.strategy ?? preset('balanced', this.chain); }

  private async onMark(m: Extract<StreamMessage, { kind: 'mark' }>): Promise<void> {
    const s = this.rules();
    for (const pos of this.openPositions()) {
      if (!this.same(pos.token, m.token) || this.busy.has(pos.id)) continue;
      // The hub priced `m.tokens`; scale to what this position holds.
      const held = BigInt(pos.tokens), priced = BigInt(m.tokens);
      const value = priced > 0n ? (BigInt(m.valueWei) * held) / priced : 0n;
      pos.lastWei = value.toString(); pos.lastAt = m.at; pos.venue = m.venue;
      if (value > BigInt(pos.peakWei)) pos.peakWei = value.toString();
      if (m.liquidityWei !== null) { const liq = BigInt(m.liquidityWei); if (pos.liqPeakWei === null || liq > BigInt(pos.liqPeakWei)) pos.liqPeakWei = liq.toString(); }
      await botStore.savePosition(pos);
      // A token with no market at all (no venue, or worth nothing) for half an hour is dead: take it off the books.
      if (m.venue === 'none' || value === 0n) {
        const since = this.deadSince.get(pos.id) ?? m.at;
        this.deadSince.set(pos.id, since);
        if (m.at - since >= DEAD_AFTER_MS) { await this.writeOff(pos.id, `no market for this token for ${Math.round(DEAD_AFTER_MS / 60_000)} minutes`).catch(() => undefined); continue; }
      } else this.deadSince.delete(pos.id);
      if (m.venue === 'none') { this.setOnce(`swept:${pos.id}`, 'swept', () => this.note('info', pos.token, pos.symbol, [this.chain === 'robinhood' ? 'the curve is being swept into a pool; sells resume once the pool exists' : 'no price for this token right now; sells resume when one appears'])); this.changed(); continue; }
      // Exits are the bot's job only while it is on, and never for a position you chose to hold by hand.
      if (!this.running || !this.strategy || pos.managed === false) { this.changed(); continue; }

      const basis = (BigInt(pos.entryWei) * held) / BigInt(pos.tokensAtEntry || pos.tokens);
      const gain = basis > 0n ? Number(((value - basis) * 10_000n) / basis) / 100 : 0;
      const peakGain = basis > 0n ? Number(((BigInt(pos.peakWei) - basis) * 10_000n) / basis) / 100 : 0;
      const x = s.exits;
      let reason: string | null = null, sellTokens = held, ladderStep: number | undefined;

      if (m.liquidityWei !== null && pos.liqPeakWei !== null && BigInt(pos.liqPeakWei) > 0n) {
        const drop = Number(((BigInt(pos.liqPeakWei) - BigInt(m.liquidityWei)) * 10_000n) / BigInt(pos.liqPeakWei)) / 100;
        if (drop >= x.liquidityDrainExitPct) reason = `liquidity drain: the pool lost ${drop.toFixed(0)}% from its high (your limit ${x.liquidityDrainExitPct}%)`;
      }
      if (!reason && gain <= -x.stopLossPct) reason = `stop loss at ${pct(gain)} (your limit −${x.stopLossPct}%)`;
      if (!reason) {
        const step = x.ladder.findIndex((st, i) => !pos.ladderDone.includes(i) && gain >= st.atGainPct);
        if (step >= 0) {
          const st = x.ladder[step]!;
          sellTokens = (BigInt(pos.tokensAtEntry) * BigInt(Math.round(st.sellPct * 100))) / 10_000n;
          if (sellTokens > held) sellTokens = held;
          reason = `ladder: sell ${st.sellPct}% at ${pct(gain)} (step ${step + 1})`;
          ladderStep = step;
        }
      }
      if (!reason && x.takeProfitPct !== null && gain >= x.takeProfitPct) reason = `take profit at ${pct(gain)} (your target +${x.takeProfitPct}%)`;
      if (!reason && x.trailingPct !== null && peakGain > 0 && gain <= peakGain - x.trailingPct && BigInt(pos.peakWei) > basis) {
        const fromPeak = Number(((BigInt(pos.peakWei) - value) * 10_000n) / BigInt(pos.peakWei)) / 100;
        if (fromPeak >= x.trailingPct) reason = `trailing stop: ${fromPeak.toFixed(0)}% below the peak of ${pct(peakGain)} (your trail ${x.trailingPct}%)`;
      }
      if (reason) await this.sell(pos, sellTokens, reason, ladderStep);
      else this.changed();
    }
  }

  private async timeExits(): Promise<void> {
    const s = this.strategy!;
    if (s.exits.maxHoldMinutes === null) return;
    for (const pos of this.openPositions()) {
      if (this.busy.has(pos.id) || pos.managed === false) continue;
      const ageMin = (Date.now() - pos.openedAt) / 60_000;
      if (ageMin >= s.exits.maxHoldMinutes) await this.sell(pos, BigInt(pos.tokens), `max hold: ${Math.round(ageMin)} minutes (your limit ${s.exits.maxHoldMinutes})`);
    }
  }

  async sellNow(positionId: string): Promise<void> {
    this.mustBeActive();
    const pos = this.positions.get(positionId);
    if (!pos || pos.status !== 'open') throw new Error('no such open position');
    await this.sell(pos, BigInt(pos.tokens), 'sold by hand', undefined, true);
  }

  private async sell(pos: Position, tokens: bigint, reason: string, ladderStep?: number, force = false): Promise<void> {
    const s = this.rules();
    // A sell that fails will usually fail again on the next price a second later. Backing off keeps
    // one stuck position from filling the log, and says so once instead of every tick.
    const fail = this.sellFails.get(pos.id);
    if (!force && fail && Date.now() < fail.until) return;
    this.busy.add(pos.id);
    try {
      const res = await this.a.sell(pos, tokens, s);
      if (ladderStep !== undefined) pos.ladderDone = [...pos.ladderDone, ladderStep];
      const held = BigInt(pos.tokens);
      const basisSold = (BigInt(pos.entryWei) * tokens) / BigInt(pos.tokensAtEntry || pos.tokens);
      const remaining = held - tokens > 0n ? held - tokens : 0n;
      pos.tokens = remaining.toString();
      pos.exits = [...pos.exits, { at: Date.now(), tokens: tokens.toString(), valueWei: res.nativeOut.toString(), reason, tx: res.hash }];
      pos.venue = res.venue;
      const day = this.today();
      day.realizedWei = (BigInt(day.realizedWei) + (res.nativeOut - basisSold)).toString();
      await botStore.saveLedger(day);
      if (remaining <= 0n) { pos.status = 'closed'; await hubStream.unwatch(this.chain, pos.token); await this.cooldown(this.key(pos.token), res.nativeOut >= basisSold ? s.advanced.winnerReentryCooldownMinutes : s.entry.reentryCooldownMinutes, 'closed'); }
      else await hubStream.watch(this.chain, pos.token, remaining);
      await botStore.savePosition(pos);
      const realized = basisSold > 0n ? Number(((res.nativeOut - basisSold) * 10_000n) / basisSold) / 100 : 0;
      this.note('exit', pos.token, pos.symbol, [`${remaining <= 0n ? 'sold all' : `sold ${this.a.format(res.nativeOut)} ${this.a.native} worth`} of ${pos.symbol} on the ${res.venue} for ${this.a.format(res.nativeOut)} ${this.a.native} (${pct(realized)}): ${reason}`], res.hash);
      this.balanceAt = 0; void this.refreshBalance(true);
      this.sellFails.delete(pos.id);
    } catch (e) {
      const n = (this.sellFails.get(pos.id)?.n ?? 0) + 1;
      const waitMs = Math.min(300_000, 10_000 * 2 ** (n - 1));
      this.sellFails.set(pos.id, { n, until: Date.now() + waitMs });
      const wait = waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} min` : `${Math.round(waitMs / 1000)}s`;
      this.note('error', pos.token, pos.symbol, [`sell failed (${reason}): ${describeRevert(e)}; try ${n}, next attempt in about ${wait}`]);
      if (n === 4) this.note('info', pos.token, pos.symbol, [`${pos.symbol} will not sell — usually there is nothing left in the pool to sell into. It stays open and keeps retrying slowly; sell it by hand from Positions if you want it gone.`]);
    } finally {
      this.busy.delete(pos.id);
    }
  }
}

export const robinhoodBot = new Bot(robinhoodAdapter);
export const solanaBot = new Bot(solanaAdapter);
export const baseBot = new Bot(baseAdapter);
export const bscBot = new Bot(bscAdapter);
export const bots: Record<Chain, Bot> = { robinhood: robinhoodBot, solana: solanaBot, base: baseBot, bsc: bscBot };
export const allBots = (): Bot[] => CHAINS.map((c) => bots[c]);
export const botFor = (chain: Chain): Bot => bots[chain];
export { adapters };
