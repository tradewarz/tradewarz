// Messages on the hub → tab live stream (server-sent events). The tab never polls: it reacts to
// these, which browsers deliver even to background tabs.

import type { Candidate } from './candidate.js';
import type { Chain } from './strategy.js';

export type FeedMode = 'websocket' | 'polling' | 'off';
export interface SourceFeed { mode: FeedMode; lastEventAt: number; candidates: number; note: string }

export interface FeedInfo {
  robinhood: { mode: FeedMode; lastLaunchAt: number; candidates: number; note: string };
  /** pump.fun creations (and, with a funded PumpPortal key, their trades). */
  solana?: SourceFeed;
  /** GeckoTerminal new pools across every chain. */
  listings?: SourceFeed;
  /** CoinGecko + CoinMarketCap new listings, scored. */
  intel?: SourceFeed;
  /** DexScreener-fed pairs on Base and BNB Chain. */
  base?: SourceFeed;
  bsc?: SourceFeed;
}

/** Native prices in USD, one per chain the hub prices. */
export interface Prices { ethUsd: number | null; solUsd: number | null; bnbUsd: number | null }

/** The owner's brake and megaphone: buying paused on every tab, and a notice everyone sees. */
export interface HubControl { paused: boolean; notice: string }

export type StreamMessage =
  | { kind: 'hello'; now: number; ethUsd: number | null; solUsd?: number | null; bnbUsd?: number | null; feed: FeedInfo; candidates: Candidate[]; control?: HubControl }
  | { kind: 'candidate'; candidate: Candidate }
  | { kind: 'drop'; chain: Chain; address: string; reason: string }
  /** A price for a position the tab asked the hub to watch: what `tokens` would sell for right now, in the chain's smallest unit (wei / lamports). */
  | { kind: 'mark'; chain: Chain; token: string; tokens: string; valueWei: string; venue: 'curve' | 'pool' | 'none'; phase: number; liquidityWei: string | null; at: number }
  | { kind: 'tick'; now: number; ethUsd: number | null; solUsd?: number | null; bnbUsd?: number | null; feed: FeedInfo; control?: HubControl }
  /**
   * A wallet this account follows just traded (later: a shared bot's rules just fired). Sent only to
   * that account's tabs; the tab decides whether to copy it. fractionPct: the share of their holding a
   * sell was, when the hub could tell. nativeAmount: SOL / ETH / BNB they spent or received, when known.
   */
  | { kind: 'signal'; chain: Chain; source: 'wallet'; from: string; side: 'buy' | 'sell'; token: string; symbol: string | null; nativeAmount: number | null; fractionPct: number | null; tx: string | null; at: number };

/** GET /api/copy — which followed wallets the hub is watching for this account, and the latest signals. */
export interface CopyStatus {
  watching: Array<{ chain: Chain; address: string; since: number; lastTradeAt: number | null; trades: number }>;
  recent: Array<Extract<StreamMessage, { kind: 'signal' }>>;
  /** Why a wallet is not being watched (over the cap, bad address, chain not supported). */
  problems: string[];
}

/** POST /api/stream/watch — ask for marks on a held token. tokens = raw units as a decimal string. */
export interface WatchRequest { chain: Chain; token: string; tokens: string }

// ---- the two intelligence panels -------------------------------------------------------------

/** One newly created pool anywhere GeckoTerminal indexes, newest first. Display data. */
export interface ListingRow {
  id: string;
  network: string;
  networkName: string;
  dex: string;
  dexName: string;
  name: string;
  symbol: string;
  tokenAddress: string;
  poolAddress: string;
  poolName: string;
  createdAt: number;
  firstSeenAt: number;
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volH1Usd: number | null;
  volH24Usd: number | null;
  chgM5Pct: number | null;
  chgH1Pct: number | null;
  buysH1: number;
  sellsH1: number;
  imageUrl: string | null;
  url: string;
  /** Set when this pool is also a TradeWarz candidate (Solana or Robinhood), so the row can link across. */
  tradable: Chain | null;
}

export interface ListingsView {
  enabled: boolean;
  source: string;
  scope: string;
  refreshSec: number;
  updatedAt: number;
  error: string | null;
  total: number;
  rows: ListingRow[];
}

/** One coin newly recognised by CoinGecko and/or CoinMarketCap, with the evidence and the score. */
export interface IntelRow {
  id: string;
  name: string;
  symbol: string;
  chain: string | null;
  address: string | null;
  solanaMint: string | null;
  firstDetectedAt: number;
  sources: Array<'coingecko' | 'coinmarketcap'>;
  urls: Partial<Record<'coingecko' | 'coinmarketcap', string>>;
  confirmed: boolean;
  score: number;
  verdict: 'ACT' | 'WATCH' | 'REJECT';
  reasons: string[];
  market: { dexId?: string; dexUrl?: string; priceUsd?: number; liquidityUsd?: number; volume24hUsd?: number; fdvUsd?: number; pairCreatedAt?: number } | null;
  security: { supported: boolean; hardFlags: string[]; warnings: string[] } | null;
  /** The chain TradeWarz can trade this coin on, and its contract there; null = view only. */
  tradable: Chain | null;
  tradableAddress: string | null;
}

export interface IntelView {
  enabled: boolean;
  sources: Array<{ name: string; enabled: boolean; note: string; baselineAt: number; baselineSize: number; lastOkAt: number; lastError: string | null; newSinceBaseline: number }>;
  updatedAt: number;
  total: number;
  rows: IntelRow[];
}
