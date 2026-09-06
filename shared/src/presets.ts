// Presets are starting points, not modes. Each is a full strategy the guardrails accept.
// Solana presets describe DexScreener-listed tokens; Robinhood presets describe pons v2
// launches, which are seconds old and trade on a curve, so their numbers are different.

import { StrategySchema, type Chain, type Strategy, type StrategyInput } from './strategy.js';

export const PRESET_NAMES = ['conservative', 'balanced', 'degen'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESET_BLURB: Record<PresetName, string> = {
  conservative: 'Older, liquid tokens with a steady hour behind them, however the hub found them. Small size, tight exits. Few trades.',
  balanced: 'Fresh graduates and new pools, ten minutes to a day old, moving on real volume. Medium size, a ladder on the way up.',
  degen: 'pump.fun launches in their first hour, while still on the curve: small creator buy, buyers showing up in the last five minutes. Small size because most die; wide take profit because some fly.',
};

export const PRESET_BLURB_ROBINHOOD: Record<PresetName, string> = {
  conservative: 'Pons launches with socials, a small dev bag, no bundle and the fee paid to the deployer. Tiny size, quick exits.',
  balanced: 'Launches that pass the usual honesty checks (dev share, exempt wallets, creator tax, socials). Bought once the opening tax has decayed.',
  degen: 'Most launches that are not obviously rigged. Small size, wide take profit, short hold: a numbers game.',
};

export const PRESET_BLURB_EVM: Record<PresetName, string> = {
  conservative: 'Established pairs with a day of history and deep liquidity. Small size, tight exits, pullback entries.',
  balanced: 'Pairs a few hours old moving on real volume, with mint and honeypot checks passed. Medium size, a ladder on the way up.',
  degen: 'Fresh pools in their first hours with buyers piling in. Small size because most die; wide take profit because some fly.',
};

export function presetBlurb(name: PresetName, chain: Chain): string {
  return chain === 'robinhood' ? PRESET_BLURB_ROBINHOOD[name] : chain === 'solana' ? PRESET_BLURB[name] : PRESET_BLURB_EVM[name];
}

// Base and BNB Chain: DexScreener-shaped pairs on ordinary AMMs. No curve, no launch tax — the
// safety checks (mint, honeypot, tax, holders) carry the weight, and sizes are scaled to the coin.
function evm(name: PresetName, chain: 'base' | 'bsc'): StrategyInput {
  // ETH ≈ 25× BNB in price terms at the time of writing; sizes below keep the dollar amounts similar.
  const k = chain === 'bsc' ? 4 : 1;
  const quotes = chain === 'bsc' ? ['WBNB', 'BNB', 'USDT'] : ['WETH', 'ETH', 'USDC'];
  switch (name) {
    case 'conservative':
      return {
        chain, version: 1, name: 'Conservative',
        discovery: {
          ageMinutes: { min: 24 * 60, max: 60 * 24 * 60 }, liquidityUsd: { min: 100_000, max: null }, marketCapUsd: { min: 300_000, max: null },
          volumeUsd: { h1: { min: 20_000, max: null }, h24: { min: 300_000, max: null } }, priceChangePct: { h1: { min: 1, max: 25 }, h24: { min: -10, max: 60 } },
          buySellRatio: { window: 'h1', min: 1.1 }, minTxns: { window: 'h1', min: 100 }, quoteSymbols: quotes, requireSocials: true,
        },
        safety: { requireMintRenounced: true, requireFreezeRenounced: false, maxTop10HoldersPct: 30, requireLpBurnedOrLocked: true, rejectHoneypot: true, maxSellTaxPct: 5, onUnknown: 'skip' },
        entry: { sizeNative: 0.01 * k, maxOpenPositions: 2, dailyBudgetNative: 0.05 * k, style: 'pullback', pullback: { minPct: 5, maxPct: 15, windowMinutes: 30 }, slippagePct: 2, reentryCooldownMinutes: 120 },
        exits: { takeProfitPct: 25, stopLossPct: 12, trailingPct: 10, maxHoldMinutes: 6 * 60, ladder: [], liquidityDrainExitPct: 25 },
      };
    case 'balanced':
      return {
        chain, version: 1, name: 'Balanced',
        discovery: {
          ageMinutes: { min: 60, max: 3 * 24 * 60 }, liquidityUsd: { min: 30_000, max: null }, marketCapUsd: { min: 50_000, max: 30_000_000 },
          volumeUsd: { m5: { min: 2_000, max: null }, h1: { min: 15_000, max: null } }, priceChangePct: { m5: { min: 2, max: 50 }, h1: { min: 3, max: 150 } },
          buySellRatio: { window: 'm5', min: 1.2 }, minTxns: { window: 'h1', min: 60 }, quoteSymbols: quotes, requireSocials: false,
        },
        safety: { requireMintRenounced: true, requireFreezeRenounced: false, maxTop10HoldersPct: 40, requireLpBurnedOrLocked: false, rejectHoneypot: true, maxSellTaxPct: 10, onUnknown: 'skip' },
        entry: { sizeNative: 0.02 * k, maxOpenPositions: 3, dailyBudgetNative: 0.12 * k, style: 'instant', slippagePct: 3, reentryCooldownMinutes: 30 },
        exits: { takeProfitPct: 80, stopLossPct: 25, trailingPct: 20, maxHoldMinutes: 4 * 60, ladder: [{ atGainPct: 40, sellPct: 40 }, { atGainPct: 100, sellPct: 35 }], liquidityDrainExitPct: 35 },
      };
    case 'degen':
      return {
        chain, version: 1, name: 'Degen',
        discovery: {
          ageMinutes: { min: 5, max: 6 * 60 }, liquidityUsd: { min: 10_000, max: null }, marketCapUsd: { min: null, max: 5_000_000 },
          volumeUsd: { m5: { min: 3_000, max: null } }, priceChangePct: { m5: { min: 5, max: 150 } },
          buySellRatio: { window: 'm5', min: 1.5 }, minTxns: { window: 'm5', min: 20 }, quoteSymbols: quotes, requireSocials: false,
        },
        safety: { requireMintRenounced: true, requireFreezeRenounced: false, maxTop10HoldersPct: 50, requireLpBurnedOrLocked: false, rejectHoneypot: true, maxSellTaxPct: 15, onUnknown: 'skip' },
        entry: { sizeNative: 0.01 * k, maxOpenPositions: 4, dailyBudgetNative: 0.1 * k, style: 'instant', slippagePct: 8, reentryCooldownMinutes: 15 },
        exits: { takeProfitPct: 150, stopLossPct: 35, trailingPct: 30, maxHoldMinutes: 90, ladder: [{ atGainPct: 60, sellPct: 50 }], liquidityDrainExitPct: 35 },
      };
  }
}

function solana(name: PresetName): StrategyInput {
  switch (name) {
    case 'conservative':
      return {
        chain: 'solana', version: 1, name: 'Conservative',
        discovery: {
          ageMinutes: { min: 24 * 60, max: 30 * 24 * 60 }, liquidityUsd: { min: 150_000, max: null }, marketCapUsd: { min: 500_000, max: null },
          volumeUsd: { h1: { min: 30_000, max: null }, h24: { min: 500_000, max: null } }, priceChangePct: { h1: { min: 2, max: 25 }, h24: { min: -10, max: 60 } },
          buySellRatio: { window: 'h1', min: 1.1 }, minTxns: { window: 'h1', min: 150 }, quoteSymbols: ['SOL', 'USDC'], requireSocials: true,
        },
        safety: { requireMintRenounced: true, requireFreezeRenounced: true, maxTop10HoldersPct: 30, requireLpBurnedOrLocked: true, rejectHoneypot: true, maxSellTaxPct: 5, onUnknown: 'skip' },
        entry: { sizeNative: 0.1, maxOpenPositions: 2, dailyBudgetNative: 0.5, style: 'pullback', pullback: { minPct: 5, maxPct: 15, windowMinutes: 30 }, slippagePct: 2, reentryCooldownMinutes: 120 },
        exits: { takeProfitPct: 25, stopLossPct: 12, trailingPct: 10, maxHoldMinutes: 6 * 60, ladder: [], liquidityDrainExitPct: 25 },
      };
    case 'balanced':
      // Graduates and brand-new pools: old enough to have a chart, young enough to still move.
      return {
        chain: 'solana', version: 1, name: 'Balanced',
        discovery: {
          ageMinutes: { min: 10, max: 24 * 60 }, liquidityUsd: { min: 15_000, max: null }, marketCapUsd: { min: 30_000, max: 20_000_000 },
          volumeUsd: { m5: { min: 2_000, max: null }, h1: { min: 10_000, max: null } }, priceChangePct: { m5: { min: 2, max: 60 }, h1: { min: 0, max: 200 } },
          buySellRatio: { window: 'm5', min: 1.2 }, minTxns: { window: 'h1', min: 60 }, quoteSymbols: ['SOL'], requireSocials: false,
        },
        safety: { requireMintRenounced: true, requireFreezeRenounced: true, maxTop10HoldersPct: 40, requireLpBurnedOrLocked: false, rejectHoneypot: true, maxSellTaxPct: 10, onUnknown: 'skip' },
        entry: { sizeNative: 0.15, maxOpenPositions: 3, dailyBudgetNative: 1, style: 'instant', slippagePct: 5, reentryCooldownMinutes: 30 },
        exits: { takeProfitPct: 80, stopLossPct: 25, trailingPct: 20, maxHoldMinutes: 4 * 60, ladder: [{ atGainPct: 40, sellPct: 40 }, { atGainPct: 100, sellPct: 35 }], liquidityDrainExitPct: 35 },
        advanced: { maxBundlePct: 25, pump: { maxDevBuySol: 5, maxDevSharePct: 15, curveOnly: false, migratedOnly: true } },
      };
    case 'degen':
      // The pump.fun sniper: launches in their first hour, still on the curve, with buyers arriving.
      // pump.fun tokens are structurally safe (no mint, no freeze, fixed supply), so the safety block
      // is relaxed and the honesty checks live in advanced.pump — the same shape as pons on Robinhood.
      return {
        chain: 'solana', version: 1, name: 'Degen',
        discovery: {
          ageMinutes: { min: null, max: 60 }, liquidityUsd: { min: 1_500, max: null }, marketCapUsd: { min: 6_000, max: 250_000 },
          volumeUsd: { m5: { min: 500, max: null } }, priceChangePct: {},
          buySellRatio: { window: 'm5', min: 1.3 }, minTxns: { window: 'm5', min: 12 }, quoteSymbols: ['SOL'], requireSocials: false,
        },
        safety: { requireMintRenounced: false, requireFreezeRenounced: false, maxTop10HoldersPct: null, requireLpBurnedOrLocked: false, rejectHoneypot: true, maxSellTaxPct: null, onUnknown: 'allow' },
        entry: { sizeNative: 0.05, maxOpenPositions: 4, dailyBudgetNative: 1, style: 'instant', slippagePct: 10, reentryCooldownMinutes: 15 },
        exits: { takeProfitPct: 150, stopLossPct: 35, trailingPct: 30, maxHoldMinutes: 45, ladder: [{ atGainPct: 50, sellPct: 50 }], liquidityDrainExitPct: 35 },
        advanced: { maxBundlePct: 30, bundleUnknown: 'wait', pump: { maxDevBuySol: 2, maxDevSharePct: 8, curveOnly: true, migratedOnly: false, progressPct: { min: 3, max: 70 }, maxCreatorPrior: 3 } },
      };
  }
}

// pons v2: every launch opens behind a 99% tax that decays over ~3 s; the curve starts with a
// phantom reserve of about 1.68 ETH, so "liquidity" is small and "age" is minutes, not days.
// Safety facts are structural (fixed supply, protocol curve), so the safety block is relaxed and
// the honesty checks live in advanced.pons.
function robinhood(name: PresetName): StrategyInput {
  const safety = { requireMintRenounced: false, requireFreezeRenounced: false, maxTop10HoldersPct: null, requireLpBurnedOrLocked: false, rejectHoneypot: true, onUnknown: 'allow' as const };
  switch (name) {
    case 'conservative':
      return {
        chain: 'robinhood', version: 1, name: 'Conservative',
        discovery: { ageMinutes: { min: null, max: 20 }, liquidityUsd: { min: 2_000, max: null }, marketCapUsd: { min: null, max: 300_000 }, quoteSymbols: ['ETH'], requireSocials: true },
        safety: { ...safety, maxSellTaxPct: 3 },
        entry: { sizeNative: 0.005, maxOpenPositions: 2, dailyBudgetNative: 0.03, style: 'instant', slippagePct: 3, reentryCooldownMinutes: 60 },
        exits: { takeProfitPct: 40, stopLossPct: 25, trailingPct: 15, maxHoldMinutes: 45, ladder: [], liquidityDrainExitPct: 30 },
        advanced: { maxBundlePct: 10, pons: { maxOpeningTaxBps: 200, maxTaxWaitMs: 12_000, maxDevSharePct: 5, maxExemptWallets: 1, requireFeeToDeployer: true, curveOnly: true } },
      };
    case 'balanced':
      return {
        chain: 'robinhood', version: 1, name: 'Balanced',
        discovery: { ageMinutes: { min: null, max: 30 }, liquidityUsd: { min: 1_500, max: null }, marketCapUsd: { min: null, max: 1_000_000 }, quoteSymbols: ['ETH'], requireSocials: true },
        safety: { ...safety, maxSellTaxPct: 4 },
        entry: { sizeNative: 0.01, maxOpenPositions: 3, dailyBudgetNative: 0.05, style: 'instant', slippagePct: 3, reentryCooldownMinutes: 30 },
        exits: { takeProfitPct: 80, stopLossPct: 35, trailingPct: 25, maxHoldMinutes: 45, ladder: [{ atGainPct: 50, sellPct: 40 }], liquidityDrainExitPct: 35 },
        advanced: { maxBundlePct: 20, pons: { maxOpeningTaxBps: 300, maxTaxWaitMs: 12_000, maxDevSharePct: 8, maxExemptWallets: 2, requireFeeToDeployer: false, curveOnly: true } },
      };
    case 'degen':
      return {
        chain: 'robinhood', version: 1, name: 'Degen',
        discovery: { ageMinutes: { min: null, max: 60 }, liquidityUsd: { min: 1_000, max: null }, quoteSymbols: ['ETH'], requireSocials: false },
        safety: { ...safety, maxSellTaxPct: 6 },
        entry: { sizeNative: 0.005, maxOpenPositions: 5, dailyBudgetNative: 0.05, style: 'instant', slippagePct: 5, reentryCooldownMinutes: 15 },
        exits: { takeProfitPct: 150, stopLossPct: 40, trailingPct: 30, maxHoldMinutes: 30, ladder: [{ atGainPct: 60, sellPct: 50 }], liquidityDrainExitPct: 35 },
        advanced: { maxBundlePct: 35, pons: { maxOpeningTaxBps: 400, maxTaxWaitMs: 12_000, maxDevSharePct: 12, maxExemptWallets: 4, requireFeeToDeployer: false, curveOnly: true } },
      };
  }
}

export function presetInput(name: PresetName, chain: Chain): StrategyInput {
  return chain === 'robinhood' ? robinhood(name) : chain === 'solana' ? solana(name) : evm(name, chain);
}

export function preset(name: PresetName, chain: Chain): Strategy {
  return StrategySchema.parse(presetInput(name, chain));
}
