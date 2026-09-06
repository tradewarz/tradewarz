// What differs between chains, and nothing else: how to price a size, read a balance, buy, sell,
// and which liquidity figure the drain exit watches. The engine in bot.ts is the same for both.

import { formatEther, parseEther, type Address } from 'viem';
import { NATIVE_SYMBOL, pumpQuoteSell, type Candidate, type Chain, type NativeSymbol, type Strategy } from '@tradewarz/shared';
import type { Position } from './store.js';
import { hubStream } from './stream.js';
import { botEvmAddress, buyAnywhere, nativeBalanceWei, openingTaxFor, resolveCurve, sellAnywhere, setRobinhoodRpc } from './rh/trade.js';
import { botSolAddress, buySolana, sellSolana, setJupiterKey, setSolanaRpc, solBalanceLamports, tokenBalanceRaw, type SolVenue } from './sol/trade.js';
import { buyEvm, evmBalanceWei, roundTrip, sellEvm, setEvmRpc, type EvmChain } from './evm/trade.js';

export type Venue = 'curve' | 'pool' | 'none';

export interface BuyOutcome { hash: string; tokens: bigint; venue: Venue; note: string }
export interface SellOutcome { hash: string; nativeOut: bigint; venue: Venue }

export interface ChainAdapter {
  readonly chain: Chain;
  readonly native: NativeSymbol;
  readonly decimals: number;
  /** Kept back for fees so an exit can always be paid for. */
  readonly gasReserve: bigint;
  setRpc(url: string): void;
  address(): string;
  balance(): Promise<bigint>;
  nativeUsd(): number | null;
  format(x: bigint, d?: number): string;
  parse(n: number): bigint;
  /** Right before spending: a reason to wait, or nothing. */
  preBuy(c: Candidate, s: Strategy): Promise<string | null>;
  buy(c: Candidate, size: bigint, s: Strategy): Promise<BuyOutcome>;
  sell(pos: Position, tokens: bigint, s: Strategy): Promise<SellOutcome>;
  /** The liquidity high-water mark to start a position at, from the candidate's own facts. */
  liquidityPeak(c: Candidate): string | null;
  /** The venue-specific account a position remembers (pons curve / bonding curve). */
  curveOf(c: Candidate): string | null;
  tokensLabel(tokens: bigint): string;
}

// ---- Robinhood Chain: pons v2 -----------------------------------------------------------------

const GAS_RESERVE_WEI = parseEther('0.0002');

/** The curve to trade on: from the hub's facts when it has them, from the factory for a pasted address. */
async function rhCurve(c: Candidate): Promise<Address> {
  if (c.pons?.curve) return c.pons.curve as Address;
  if (c.pairAddress && c.dexId !== 'unknown') return c.pairAddress as Address;
  return (await resolveCurve(c.address as Address)).curve;
}

export const robinhoodAdapter: ChainAdapter = {
  chain: 'robinhood', native: 'ETH', decimals: 18, gasReserve: GAS_RESERVE_WEI,
  setRpc: (url) => setRobinhoodRpc(url),
  address: () => botEvmAddress(),
  balance: () => nativeBalanceWei(botEvmAddress()),
  nativeUsd: () => hubStream.ethUsd,
  format: (x, d = 4) => Number(formatEther(x)).toFixed(d),
  parse: (n) => parseEther(String(n)),
  async preBuy(c, s) {
    // A graduated launch has no opening tax; only a live curve is checked. The hub's tax figure is
    // for a neutral wallet; check ours right before spending.
    const onCurve = c.pons ? c.pons.phase === 0 && !c.pons.graduated : true;
    if (!onCurve) return null;
    const curve = await rhCurve(c);
    const tax = await openingTaxFor(curve, botEvmAddress());
    const ceiling = s.advanced.pons.maxOpeningTaxBps;
    if (tax > BigInt(ceiling)) return `opening tax for our wallet is ${(Number(tax) / 100).toFixed(1)}%, above your ${(ceiling / 100).toFixed(1)}% ceiling; will retry`;
    (c as Candidate & { _taxNow?: number })._taxNow = Number(tax) / 100;
    return null;
  },
  async buy(c, size, s) {
    // Wherever it trades: the curve while open, the v4 pool once graduated. The rules decide
    // whether the bot may buy off-curve (advanced.pons.curveOnly); a manual buy goes where the token is.
    const curve = c.pons?.curve ? (c.pons.curve as Address) : null;
    const res = await buyAnywhere(c.address as Address, curve, size, Math.round(s.entry.slippagePct * 100));
    const tax = (c as Candidate & { _taxNow?: number })._taxNow;
    return { hash: res.hash, tokens: res.tokensOut, venue: res.venue, note: `on the ${res.venue} (${(Number(res.tokensOut) / 1e24).toFixed(2)}M tokens)${res.venue === 'curve' && tax !== undefined ? ` at ${tax.toFixed(2)}% opening tax` : ''}` };
  },
  async sell(pos, tokens, s) {
    const res = await sellAnywhere(pos.token as Address, pos.curve as Address | null, tokens, Math.round(s.entry.slippagePct * 100));
    return { hash: res.hash, nativeOut: res.ethOut, venue: res.venue };
  },
  liquidityPeak: (c) => (c.pons ? c.pons.realQuoteReserve : null),
  curveOf: (c) => c.pons?.curve ?? c.pairAddress ?? null,
  tokensLabel: (tokens) => `${(Number(tokens) / 1e24).toFixed(2)}M tokens`,
};

// ---- Solana: pump.fun and everything DexScreener lists -----------------------------------------

const GAS_RESERVE_LAMPORTS = 5_000_000n; // 0.005 SOL: fees, priority fee, a token account's rent
const PRIORITY_FEE_SOL = 0.0005;

/** Where to send the order. A pasted address the hub knows nothing about goes 'auto': PumpPortal first, Jupiter second. */
const venueOf = (c: Candidate): SolVenue => (c.pump ? (c.pump.complete ? 'pump-amm' : 'pump') : c.dexId === 'pump-fun' ? 'pump' : c.dexId === 'pumpswap' || c.dexId === 'pump-amm' ? 'pump-amm' : c.dexId === 'unknown' ? 'auto' : 'other');

export const solanaAdapter: ChainAdapter = {
  chain: 'solana', native: 'SOL', decimals: 9, gasReserve: GAS_RESERVE_LAMPORTS,
  setRpc: (url) => setSolanaRpc(url),
  address: () => botSolAddress(),
  balance: () => solBalanceLamports(botSolAddress()),
  nativeUsd: () => hubStream.solUsd,
  format: (x, d = 4) => (Number(x) / 1e9).toFixed(d),
  parse: (n) => BigInt(Math.round(n * 1e9)),
  async preBuy() { return null; },
  async buy(c, size, s) {
    const venue = venueOf(c);
    const res = await buySolana(c.address, size, { venue, slippagePct: s.entry.slippagePct, priorityFeeSol: PRIORITY_FEE_SOL });
    const where = venue === 'pump' ? 'on the bonding curve' : venue === 'pump-amm' ? 'on PumpSwap' : venue === 'auto' ? 'wherever it trades' : `via Jupiter (${c.dexId})`;
    return { hash: res.hash, tokens: res.tokens, venue: res.venue, note: `${where} (${(Number(res.tokens) / 1e6 / 1e6).toFixed(2)}M tokens)` };
  },
  async sell(pos, tokens, s) {
    // Never ask the chain for more than the wallet holds: a ladder rounding error would otherwise fail the sale.
    const held = await tokenBalanceRaw(pos.token, botSolAddress()).catch(() => tokens);
    const amount = tokens > held ? held : tokens;
    if (amount <= 0n) throw new Error('the wallet holds none of this token any more');
    const live = hubStream.candidate('solana', pos.token);
    const venue: SolVenue = live ? venueOf(live) : pos.venue === 'curve' ? 'pump' : pos.curve ? 'pump-amm' : 'auto';
    let res;
    try {
      res = await sellSolana(pos.token, amount, { venue, slippagePct: s.entry.slippagePct, priorityFeeSol: PRIORITY_FEE_SOL });
    } catch (e) {
      // A curve that graduated between the mark and the sale: try the pool route once before giving up.
      if (venue === 'pump') res = await sellSolana(pos.token, amount, { venue: 'pump-amm', slippagePct: s.entry.slippagePct, priorityFeeSol: PRIORITY_FEE_SOL });
      else throw e;
    }
    return { hash: res.hash, nativeOut: res.lamports, venue: res.venue };
  },
  liquidityPeak: (c) => (c.pump ? BigInt(Math.floor(c.pump.realSol * 1e9)).toString() : c.liquidityUsd !== null && hubStream.solUsd ? BigInt(Math.floor((c.liquidityUsd / hubStream.solUsd / 2) * 1e9)).toString() : null),
  curveOf: (c) => c.pump?.curve ?? null,
  tokensLabel: (tokens) => `${(Number(tokens) / 1e6 / 1e6).toFixed(2)}M tokens`,
};

/** A quick, local estimate of what tokens are worth on a pump.fun curve, for the position panel between marks. */
export function estimateCurveValueLamports(c: Candidate, tokensRaw: bigint): bigint | null {
  if (!c.pump || c.pump.complete) return null;
  const out = pumpQuoteSell({ vSol: c.pump.vSol, vTokens: c.pump.vTokens, realSol: c.pump.realSol, realTokens: null, complete: false }, Number(tokensRaw) / 1e6);
  return BigInt(Math.floor(out * 1e9));
}

// ---- Base and BNB Chain: any DEX, through the KyberSwap aggregator -------------------------------

const GAS_RESERVE_EVM = parseEther('0.0005'); // two or three swaps' worth of gas on either chain
/** Two swaps' fees plus price impact on a small pool come to a few percent; a quarter of the stake gone means a tax or no real exit. */
const MAX_ROUND_TRIP_LOSS_PCT = 25;

export function evmAdapter(chain: EvmChain): ChainAdapter {
  const usd = () => (chain === 'bsc' ? hubStream.bnbUsd : hubStream.ethUsd);
  return {
    chain, native: NATIVE_SYMBOL[chain], decimals: 18, gasReserve: GAS_RESERVE_EVM,
    setRpc: (url) => setEvmRpc(chain, url),
    address: () => botEvmAddress(),
    balance: () => evmBalanceWei(chain, botEvmAddress()),
    nativeUsd: usd,
    format: (x, d = 4) => Number(formatEther(x)).toFixed(d),
    parse: (n) => parseEther(String(n)),
    /** Prove the way out before going in: a buy-and-sell round trip quoted right now must not lose more than fees and impact explain. */
    async preBuy(c, s) {
      const size = parseEther(String(s.entry.sizeNative));
      let rt;
      try { rt = await roundTrip(chain, c.address as Address, size); }
      catch (e) { return `sell check failed (${(e as Error).message.slice(0, 120)}); not buying`; }
      if (rt.lossPct > MAX_ROUND_TRIP_LOSS_PCT) return `a buy-and-sell round trip would lose ${rt.lossPct.toFixed(0)}% right now (sell tax or a pool too thin to exit); not buying`;
      return null;
    },
    async buy(c, size, s) {
      const res = await buyEvm(chain, c.address as Address, size, Math.round(s.entry.slippagePct * 100));
      return { hash: res.hash, tokens: res.tokens, venue: 'pool', note: 'via KyberSwap' };
    },
    async sell(pos, tokens, s) {
      const res = await sellEvm(chain, pos.token as Address, tokens, Math.round(s.entry.slippagePct * 100));
      return { hash: res.hash, nativeOut: res.nativeOut, venue: 'pool' };
    },
    // No curve here: the drain exit watches the pool's liquidity, in the native coin, from DexScreener.
    liquidityPeak: (c) => { const p = usd(); return c.liquidityUsd !== null && p ? parseEther(((c.liquidityUsd / p) / 2).toFixed(6)).toString() : null; },
    curveOf: (c) => c.pairAddress || null,
    tokensLabel: (tokens) => `${(Number(tokens) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 })} tokens`,
  };
}

export const baseAdapter = evmAdapter('base');
export const bscAdapter = evmAdapter('bsc');
export const adapters: Record<Chain, ChainAdapter> = { robinhood: robinhoodAdapter, solana: solanaAdapter, base: baseAdapter, bsc: bscAdapter };
export { setJupiterKey };
