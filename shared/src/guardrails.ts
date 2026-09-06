// Platform guardrails. Every bot obeys these whatever its owner typed. Users may make
// any of them tighter; a strategy that tries to loosen one is refused with a sentence
// saying which rail and why. The builder shows the same sentence before saving, the
// hub checks again when storing, and the bot checks a third time before it trades, so
// a hand-edited request cannot slip past.

import type { Chain, Strategy } from './strategy.js';

export const GUARDRAILS = {
  /** A stop loss must exist and may not be wider than this. */
  stopLossMaxPct: 90,
  /** The liquidity-drain exit must fire at or before this much of the pool has left. */
  liquidityDrainExitMaxPct: 35,
  /** One buy may not exceed this share of the pool's liquidity (checked at trade time). */
  maxBuyPctOfPoolLiquidity: 2,
  /** New entries stop for the UTC day once realized losses reach this share of the daily budget. */
  dailyLossBreakerPctOfBudget: 100,
  /** Hard ceiling on simultaneous positions per chain. */
  maxOpenPositions: 25,
  /** Slippage a bot may accept. */
  slippageMaxPct: 30,
  /** Per-buy size ceiling in native coin, per chain: a fat-finger stop, not a strategy. */
  maxSizeNative: { solana: 20, robinhood: 2 } as Record<Chain, number>,
  /** Daily budget ceiling in native coin, per chain. */
  maxDailyBudgetNative: { solana: 200, robinhood: 20 } as Record<Chain, number>,
  /** A ladder may not sell more than 100% in total. */
  ladderTotalMaxPct: 100,
} as const;

export interface Violation { path: string; message: string }

/** Check a parsed strategy against the rails. Empty array = allowed. */
export function guardrailViolations(s: Strategy): Violation[] {
  const v: Violation[] = [];
  const g = GUARDRAILS;
  const native = s.chain === 'solana' ? 'SOL' : 'ETH';

  if (!(s.exits.stopLossPct > 0)) v.push({ path: 'exits.stopLossPct', message: 'Every bot needs a stop loss.' });
  else if (s.exits.stopLossPct > g.stopLossMaxPct) v.push({ path: 'exits.stopLossPct', message: `The stop loss can be at most ${g.stopLossMaxPct}% (you set ${s.exits.stopLossPct}%). A wider stop is the same as none.` });

  if (s.exits.liquidityDrainExitPct > g.liquidityDrainExitMaxPct) v.push({ path: 'exits.liquidityDrainExitPct', message: `The liquidity-drain exit must trigger at ${g.liquidityDrainExitMaxPct}% or less of the pool leaving (you set ${s.exits.liquidityDrainExitPct}%). This is the rug protection; it can be made stricter, not looser.` });

  if (s.entry.maxOpenPositions > g.maxOpenPositions) v.push({ path: 'entry.maxOpenPositions', message: `At most ${g.maxOpenPositions} positions may be open at once (you set ${s.entry.maxOpenPositions}).` });

  if (s.entry.slippagePct > g.slippageMaxPct) v.push({ path: 'entry.slippagePct', message: `Slippage may be at most ${g.slippageMaxPct}% (you set ${s.entry.slippagePct}%).` });

  const maxSize = g.maxSizeNative[s.chain];
  if (s.entry.sizeNative > maxSize) v.push({ path: 'entry.sizeNative', message: `One buy may be at most ${maxSize} ${native} (you set ${s.entry.sizeNative}). This is a fat-finger limit, not advice.` });

  const maxBudget = g.maxDailyBudgetNative[s.chain];
  if (s.entry.dailyBudgetNative > maxBudget) v.push({ path: 'entry.dailyBudgetNative', message: `The daily budget may be at most ${maxBudget} ${native} (you set ${s.entry.dailyBudgetNative}).` });

  if (s.entry.dailyBudgetNative < s.entry.sizeNative) v.push({ path: 'entry.dailyBudgetNative', message: `The daily budget (${s.entry.dailyBudgetNative} ${native}) is smaller than one buy (${s.entry.sizeNative} ${native}), so the bot could never enter.` });

  const ladderTotal = s.exits.ladder.reduce((a, b) => a + b.sellPct, 0);
  if (ladderTotal > g.ladderTotalMaxPct) v.push({ path: 'exits.ladder', message: `The ladder sells ${ladderTotal}% in total; it cannot sell more than 100%.` });
  for (let i = 1; i < s.exits.ladder.length; i++) {
    const prev = s.exits.ladder[i - 1]!, cur = s.exits.ladder[i]!;
    if (cur.atGainPct <= prev.atGainPct) { v.push({ path: `exits.ladder.${i}`, message: 'Ladder steps must be in rising order of gain.' }); break; }
  }

  if (s.entry.style === 'pullback' && s.entry.pullback.minPct >= s.entry.pullback.maxPct) v.push({ path: 'entry.pullback', message: 'The pullback minimum must be smaller than its maximum.' });
  if (s.advanced.dipAdd.enabled && s.advanced.dipAdd.bandMinPct >= s.advanced.dipAdd.bandMaxPct) v.push({ path: 'advanced.dipAdd', message: 'The dip-add band minimum must be smaller than its maximum.' });

  return v;
}

/** Trade-time rail: is this buy small enough for the pool it goes into? */
export function buyWithinPoolLimit(buyUsd: number, poolLiquidityUsd: number): { ok: boolean; maxUsd: number } {
  const maxUsd = (poolLiquidityUsd * GUARDRAILS.maxBuyPctOfPoolLiquidity) / 100;
  return { ok: buyUsd <= maxUsd, maxUsd };
}

/** Trade-time rail: has the day's realized loss reached the breaker? */
export function dailyBreakerTripped(realizedLossNativeToday: number, dailyBudgetNative: number): boolean {
  const limit = (dailyBudgetNative * GUARDRAILS.dailyLossBreakerPctOfBudget) / 100;
  return realizedLossNativeToday >= limit;
}
