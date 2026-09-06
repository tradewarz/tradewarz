// A candidate is one token/pair as the hub streams it to every tab: DexScreener-shaped
// market data plus whatever safety evidence exists. The bot never fetches these itself.

import type { Chain, Window } from './strategy.js';

export interface WindowNumbers { m5: number | null; h1: number | null; h6: number | null; h24: number | null }
export interface WindowTxns { m5: { buys: number; sells: number } | null; h1: { buys: number; sells: number } | null; h6: { buys: number; sells: number } | null; h24: { buys: number; sells: number } | null }

export interface SafetyEvidence {
  /** true = renounced / safe, false = not, null = unknown */
  mintRenounced: boolean | null;
  freezeRenounced: boolean | null;
  top10HoldersPct: number | null;
  lpBurnedOrLocked: boolean | null;
  honeypot: boolean | null;
  sellTaxPct: number | null;
  /** Where the evidence came from, for the "why" panel. */
  source: string | null;
  checkedAt: number | null;
}

/** Facts specific to a pons v2 launch on Robinhood Chain, read from the chain by the hub. */
export interface PonsFacts {
  curve: string;
  deployer: string;
  /** 0 curve · 1 swept · 2 pool · 3 rescued */
  phase: number;
  /** Share of supply the launcher bought in the launch transaction. */
  devSharePct: number;
  creatorTaxBps: number;
  /** Wallets declared exempt from the opening tax at launch (the declared bundle). */
  exemptWallets: number;
  /** The opening tax right now, for a neutral recipient; 0 once decayed. */
  openingTaxBps: number;
  /** 0..1 along the curve toward graduation. */
  progress: number;
  /** Does the creator fee go to the deployer's own wallet? */
  feeToDeployer: boolean | null;
  /** Prior launches by this deployer in the index window, when known. */
  deployerPrior: number | null;
  deployerGraduated: number | null;
  /** Curve reserves, as strings (bigint), so a tab can price its own position without another read. */
  quoteReserve: string;
  tokenReserve: string;
  realQuoteReserve: string;
  feeBps: number;
  graduated: boolean;
  readyToGraduate: boolean;
  /** The pair asset; ETH for native pairs. */
  pairToken: string;
  pairDecimals: number;
}

/** Facts specific to a pump.fun launch on Solana: the creation event plus the bonding curve as the hub reads it. */
export interface PumpFacts {
  /** The bonding-curve account. */
  curve: string;
  creator: string;
  /** SOL the creator bought in the creation transaction. */
  devBuySol: number;
  /** The creator's share of supply from that buy, when it could be worked out. */
  devSharePct: number | null;
  /** Virtual reserves right now; price = vSol / vTokens. */
  vSol: number;
  vTokens: number;
  /** Real SOL in the curve — what could actually be sold into. */
  realSol: number;
  marketCapSol: number | null;
  /** 0..1 toward graduation. */
  progress: number;
  /** The curve is complete: the token moved to a pool. */
  complete: boolean;
  /** Where it trades right now. */
  pool: 'pump' | 'pump-amm' | 'raydium' | 'other';
  /** Prior launches by this creator in the hub's window, when known. */
  creatorPrior: number | null;
}

/**
 * Who else bought in the launch block. A "bundle" is the creator landing buys from other wallets in
 * the same slot/block as the launch itself, so insiders hold a big slice at the floor price. The hub
 * reads this from the chain for launches it saw being created; absent = not checked (yet).
 */
export interface BundleFacts {
  /** Wallets other than the creator that bought in the launch slot/block. */
  wallets: number;
  /** Share of total supply those wallets bought there, in percent. */
  supplyPct: number;
  /** Native coin (SOL / ETH) they spent, in whole units. */
  nativeSpent: number;
  /** The creator's own launch buy plus the bundle, in percent of supply. */
  launchPct: number;
  /** 'slot' = same Solana slot as the creation; 'block' = same EVM block as the launch. */
  method: 'slot' | 'block';
  checkedAt: number;
}

/** The scanner's red BUNDLE chip: two or more outside wallets in the launch block, or a real slice of supply. */
export const isBundled = (b: BundleFacts | null | undefined): boolean => !!b && (b.wallets >= 2 || b.supplyPct >= 3);

export type ListingSource = 'coingecko' | 'coinmarketcap';
export type ListingVerdict = 'ACT' | 'WATCH' | 'REJECT';

/** What the listing intelligence knows: the coin was newly recognised by CoinGecko and/or CoinMarketCap. */
export interface ListingFacts {
  sources: ListingSource[];
  /** Seen on both catalogues, matched by contract, inside the confirmation window. */
  confirmed: boolean;
  /** 0..100, explainable. */
  score: number;
  verdict: ListingVerdict;
  reasons: string[];
  detectedAt: number;
  urls: Partial<Record<ListingSource, string>>;
}

export interface Candidate {
  chain: Chain;
  /** Token address (mint on Solana). */
  address: string;
  pairAddress: string;
  dexId: string;
  symbol: string;
  name: string;
  quoteSymbol: string;
  /** Pair creation time, ms since epoch; null when the source did not say. */
  createdAt: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  priceUsd: number | null;
  priceNative: number | null;
  volumeUsd: WindowNumbers;
  priceChangePct: WindowNumbers;
  txns: WindowTxns;
  hasSocials: boolean;
  boosted: boolean;
  /** How the hub found it: new-pool, boosts, profiles, pons-launch, graduation, manual */
  source: string;
  safety: SafetyEvidence | null;
  /** Present only for pons v2 launches on Robinhood Chain. */
  pons?: PonsFacts | null;
  /** Present only for pump.fun launches on Solana. */
  pump?: PumpFacts | null;
  /** Present when the coin came through (or was later matched to) a CoinGecko / CoinMarketCap listing. */
  listing?: ListingFacts | null;
  /** Present once the hub has read the launch block; null/absent = not checked. */
  bundle?: BundleFacts | null;
  /** When the hub last refreshed this snapshot. */
  updatedAt: number;
}

/** Every way the hub finds a token, for filters and the "found via" column. */
export const CANDIDATE_SOURCES = ['pons-launch', 'pump-launch', 'new-pool', 'boosts', 'profiles', 'listing', 'graduation', 'manual'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];
export const SOURCE_LABEL: Record<CandidateSource, string> = {
  'pons-launch': 'pons launch', 'pump-launch': 'pump.fun launch', 'new-pool': 'new pool', boosts: 'DexScreener boost',
  profiles: 'DexScreener profile', listing: 'new listing', graduation: 'graduation', manual: 'added by hand',
};

export const emptyWindows = (): WindowNumbers => ({ m5: null, h1: null, h6: null, h24: null });
export const emptyTxns = (): WindowTxns => ({ m5: null, h1: null, h6: null, h24: null });

export function ageMinutes(c: Candidate, now = Date.now()): number | null {
  return c.createdAt === null ? null : Math.max(0, (now - c.createdAt) / 60_000);
}

export function buySellRatio(c: Candidate, w: Window): number | null {
  const t = c.txns[w];
  if (!t) return null;
  if (t.sells === 0) return t.buys > 0 ? Infinity : null;
  return t.buys / t.sells;
}

export function txnCount(c: Candidate, w: Window): number | null {
  const t = c.txns[w];
  return t ? t.buys + t.sells : null;
}
