// The strategy vocabulary. One schema, used by the builder (to render sentences and
// validate input), by the bot in the browser (to decide) and by the hub (to store and
// to refuse anything that loosens a guardrail). Numbers are plain: percentages are
// percent (10 = 10%), money is USD, sizes are in the chain's native coin (SOL / ETH),
// time is minutes.

import { z } from 'zod';

export const CHAINS = ['solana', 'robinhood', 'base', 'bsc'] as const;
export type Chain = (typeof CHAINS)[number];
export const ChainSchema = z.enum(CHAINS);

export type NativeSymbol = 'SOL' | 'ETH' | 'BNB';
export const NATIVE_SYMBOL: Record<Chain, NativeSymbol> = { solana: 'SOL', robinhood: 'ETH', base: 'ETH', bsc: 'BNB' };
export const CHAIN_NAME: Record<Chain, string> = { solana: 'Solana', robinhood: 'Robinhood Chain', base: 'Base', bsc: 'BNB Chain' };
/** Solana is its own world; every other chain here is an EVM chain and shares the bot's EVM key. */
export const isEvmChain = (c: Chain): boolean => c !== 'solana';
export const EVM_CHAIN_ID: Record<Exclude<Chain, 'solana'>, number> = { robinhood: 4663, base: 8453, bsc: 56 };
/** Smallest-unit decimals of the native coin. */
export const NATIVE_DECIMALS: Record<Chain, number> = { solana: 9, robinhood: 18, base: 18, bsc: 18 };
/** DexScreener's slug for each chain, for links and for its API's chainId field. */
export const DEXSCREENER_SLUG: Record<Chain, string> = { solana: 'solana', robinhood: 'robinhood', base: 'base', bsc: 'bsc' };
/** GeckoTerminal network ids that map onto a chain we trade. */
export const GECKO_NETWORK: Partial<Record<string, Chain>> = { solana: 'solana', base: 'base', bsc: 'bsc', robinhood: 'robinhood', 'robinhood-chain': 'robinhood', robinhood_chain: 'robinhood' };
export const EXPLORER: Record<Chain, { base: string; token: string; address: string; tx: string }> = {
  solana: { base: 'https://solscan.io', token: 'token', address: 'account', tx: 'tx' },
  robinhood: { base: 'https://robinhoodchain.blockscout.com', token: 'token', address: 'address', tx: 'tx' },
  base: { base: 'https://basescan.org', token: 'token', address: 'address', tx: 'tx' },
  bsc: { base: 'https://bscscan.com', token: 'token', address: 'address', tx: 'tx' },
};

/** A bound that may be open on either side. null = no limit. */
export const RangeSchema = z
  .object({ min: z.number().finite().nullable().default(null), max: z.number().finite().nullable().default(null) })
  .refine((r) => r.min === null || r.max === null || r.min <= r.max, { message: 'minimum is above maximum' });
export type Range = z.infer<typeof RangeSchema>;
export const openRange = (): Range => ({ min: null, max: null });

export const WINDOWS = ['m5', 'h1', 'h6', 'h24'] as const;
export type Window = (typeof WINDOWS)[number];
export const WINDOW_LABEL: Record<Window, string> = { m5: 'last 5 minutes', h1: 'last hour', h6: 'last 6 hours', h24: 'last 24 hours' };

const WindowRanges = z.object({ m5: RangeSchema.default(openRange()), h1: RangeSchema.default(openRange()), h6: RangeSchema.default(openRange()), h24: RangeSchema.default(openRange()) });

// ---------------------------------------------------------------------------------
// Discovery: which tokens the bot is allowed to look at.
export const DiscoverySchema = z.object({
  /** Age of the pair on the DEX, in minutes. */
  ageMinutes: RangeSchema.default({ min: 30, max: 2880 }),
  liquidityUsd: RangeSchema.default({ min: 50_000, max: null }),
  /** Market cap when known, otherwise FDV. */
  marketCapUsd: RangeSchema.default(openRange()),
  volumeUsd: WindowRanges.default({}),
  priceChangePct: WindowRanges.default({}),
  /** Buys divided by sells over the window; 1.5 means 3 buys for every 2 sells. */
  buySellRatio: z.object({ window: z.enum(WINDOWS).default('h1'), min: z.number().nullable().default(null) }).default({}),
  minTxns: z.object({ window: z.enum(WINDOWS).default('h1'), min: z.number().int().nullable().default(null) }).default({}),
  /** Allowed quote assets; empty = any. */
  quoteSymbols: z.array(z.string().min(1).max(12)).default([]),
  requireSocials: z.boolean().default(false),
  requireBoosted: z.boolean().default(false),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

// ---------------------------------------------------------------------------------
// Safety: what the bot refuses regardless of how good the chart looks.
export const SafetySchema = z.object({
  requireMintRenounced: z.boolean().default(true),
  requireFreezeRenounced: z.boolean().default(true),
  maxTop10HoldersPct: z.number().min(1).max(100).nullable().default(40),
  requireLpBurnedOrLocked: z.boolean().default(false),
  rejectHoneypot: z.boolean().default(true),
  maxSellTaxPct: z.number().min(0).max(100).nullable().default(10),
  /** When a check cannot be performed: 'skip' the token or 'allow' it anyway. */
  onUnknown: z.enum(['skip', 'allow']).default('skip'),
});
export type Safety = z.infer<typeof SafetySchema>;

// ---------------------------------------------------------------------------------
// Entry and sizing.
export const ENTRY_STYLES = ['instant', 'pullback', 'breakout'] as const;
export const EntrySchema = z.object({
  /** Native coin per buy (SOL or ETH). */
  sizeNative: z.number().positive(),
  maxOpenPositions: z.number().int().min(1),
  /** Native coin the bot may put into new entries per UTC day. */
  dailyBudgetNative: z.number().positive(),
  style: z.enum(ENTRY_STYLES).default('instant'),
  /** pullback: buy once price has retraced this far from its local high, but not deeper than max. */
  pullback: z.object({ minPct: z.number().min(1).max(90).default(12), maxPct: z.number().min(1).max(95).default(25), windowMinutes: z.number().int().min(1).max(240).default(20) }).default({}),
  /** breakout: buy when price makes a new high over the lookback. */
  breakout: z.object({ lookbackMinutes: z.number().int().min(1).max(1440).default(30) }).default({}),
  slippagePct: z.number().min(0.1).max(30).default(3),
  /** After a position in a token closes, leave that token alone for this long. */
  reentryCooldownMinutes: z.number().int().min(0).max(10_080).default(30),
});
export type Entry = z.infer<typeof EntrySchema>;

// ---------------------------------------------------------------------------------
// Exits. Stop loss and the liquidity-drain exit always exist (see guardrails).
export const LadderStepSchema = z.object({ atGainPct: z.number().positive(), sellPct: z.number().min(1).max(100) });
export const ExitsSchema = z.object({
  takeProfitPct: z.number().positive().nullable().default(80),
  stopLossPct: z.number().positive(),
  trailingPct: z.number().positive().nullable().default(25),
  maxHoldMinutes: z.number().int().positive().nullable().default(240),
  ladder: z.array(LadderStepSchema).max(6).default([]),
  /** Sell everything if the pool loses this % of its liquidity from its high-water mark. */
  liquidityDrainExitPct: z.number().min(5).max(90),
});
export type Exits = z.infer<typeof ExitsSchema>;

// ---------------------------------------------------------------------------------
// Advanced: the power-user layer, collapsed by default.
/** Rules that only mean something for pons v2 launches on Robinhood Chain (ignored elsewhere). */
export const PonsRulesSchema = z.object({
  /** Do not buy while the opening tax is above this (it starts at 99% and decays to 0 in ~3 s). */
  maxOpeningTaxBps: z.number().int().min(0).max(5000).default(300),
  /** Give up waiting for the tax to decay after this long. */
  maxTaxWaitMs: z.number().int().min(1000).max(60_000).default(12_000),
  /** Launcher's own share of supply from the launch transaction. */
  maxDevSharePct: z.number().min(0).max(100).default(8),
  /** Wallets the launcher exempted from the opening tax: more than a couple is a declared bundle. */
  maxExemptWallets: z.number().int().min(0).max(50).default(2),
  /** Skip launches whose creator fee is paid to a wallet other than the deployer. */
  requireFeeToDeployer: z.boolean().default(false),
  /** Only buy while the token is still on the curve (before graduation). */
  curveOnly: z.boolean().default(true),
  /** How far along the curve (0–100%) the launch must be: a floor skips the first seconds, a ceiling skips late entries. */
  progressPct: RangeSchema.default({}),
  /** Skip serial launchers: more prior launches than this in the hub's window (blank = do not check). */
  maxDeployerPrior: z.number().int().min(0).nullable().default(null),
  /** Require a launcher with at least this many graduated launches (blank = do not check). */
  minDeployerGraduated: z.number().int().min(0).nullable().default(null),
});

/** Rules that only mean something for pump.fun launches on Solana (ignored elsewhere). */
export const PumpRulesSchema = z.object({
  /** The creator's own buy in the creation transaction, in SOL (blank = do not check). */
  maxDevBuySol: z.number().min(0).nullable().default(3),
  /** The creator's share of supply from that buy (blank = do not check). */
  maxDevSharePct: z.number().min(0).max(100).nullable().default(10),
  /** Only buy while the token is still on the bonding curve. */
  curveOnly: z.boolean().default(false),
  /** Only buy once the token has graduated to a pool. */
  migratedOnly: z.boolean().default(false),
  /** How far along the curve (0–100%) the launch must be. */
  progressPct: RangeSchema.default({}),
  /** Market cap in SOL as the curve prices it. */
  marketCapSol: RangeSchema.default({}),
  /** Skip serial creators: more prior launches than this in the hub's window (blank = do not check). */
  maxCreatorPrior: z.number().int().min(0).nullable().default(null),
});

/** Rules about coins that arrived through a CoinGecko / CoinMarketCap listing. */
export const ListingRulesSchema = z.object({
  /** Only trade tokens that came in through a listing; skip everything else the hub finds. */
  onlyListed: z.boolean().default(false),
  /** Minimum listing score, 0–100 (blank = do not check). Applies only to tokens that have one. */
  minScore: z.number().min(0).max(100).nullable().default(null),
  /** Require the coin to be on both catalogues. */
  requireConfirmed: z.boolean().default(false),
  /** Allowed verdicts; empty = any. */
  verdicts: z.array(z.enum(['ACT', 'WATCH', 'REJECT'])).default([]),
});

export const AdvancedSchema = z.object({
  dipAdd: z.object({ enabled: z.boolean().default(false), maxAdds: z.number().int().min(1).max(3).default(1), bandMinPct: z.number().min(5).max(80).default(20), bandMaxPct: z.number().min(5).max(90).default(30) }).default({}),
  winnerReentryCooldownMinutes: z.number().int().min(0).max(10_080).default(5),
  keywords: z.object({ include: z.array(z.string().min(1).max(40)).max(20).default([]), exclude: z.array(z.string().min(1).max(40)).max(50).default([]) }).default({}),
  blockedSources: z.array(z.string()).default([]),
  /** Skip launches where wallets other than the creator bought more than this share of supply in the launch block (blank = do not check). */
  maxBundlePct: z.number().min(0).max(100).nullable().default(null),
  /** While the launch-block check has not come back: 'wait' (skip until it has) or 'allow' (judge without it). */
  bundleUnknown: z.enum(['wait', 'allow']).default('allow'),
  pons: PonsRulesSchema.default({}),
  pump: PumpRulesSchema.default({}),
  listing: ListingRulesSchema.default({}),
});
export type Advanced = z.infer<typeof AdvancedSchema>;

// ---------------------------------------------------------------------------------
export const STRATEGY_VERSION = 1 as const;
export const StrategySchema = z.object({
  version: z.literal(STRATEGY_VERSION).default(STRATEGY_VERSION),
  chain: ChainSchema,
  name: z.string().min(1).max(60).default('My bot'),
  discovery: DiscoverySchema.default({}),
  safety: SafetySchema.default({}),
  entry: EntrySchema,
  exits: ExitsSchema,
  advanced: AdvancedSchema.default({}),
});
export type Strategy = z.infer<typeof StrategySchema>;
/** What a user may submit: partial, to be filled with defaults and checked. */
export type StrategyInput = z.input<typeof StrategySchema>;

/** Parse user input into a full strategy, or return the first few problems in plain words. */
export function parseStrategy(input: unknown): { ok: true; strategy: Strategy } | { ok: false; problems: string[] } {
  const r = StrategySchema.safeParse(input);
  if (r.success) return { ok: true, strategy: r.data };
  const problems = r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'strategy'}: ${i.message}`);
  return { ok: false, problems };
}
