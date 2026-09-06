// pons v2 curve pricing in the protocol's integer order (mirrors PonsV2BondingCurve.buy/sell).
// Fees come off the input on a buy and off the output on a sell; the opening tax applies to
// buys only. Pure functions over a CurveState snapshot; the hub streams snapshots, the browser
// prices its own positions from them without another RPC call.

import { BPS } from './abi.js';

export interface CurveState {
  quoteReserve: bigint; // includes the phantom reserve
  tokenReserve: bigint;
  realQuoteReserve: bigint;
  sellableTokens: bigint;
  reservedTokens: bigint;
  graduationThreshold: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  openingTaxBps: bigint;
  graduated: boolean;
  readyToGraduate: boolean;
  launchedAt: number;
  readAtMs: number;
}

export const amountOut = (inAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint => (inAmount * reserveOut) / (reserveIn + inAmount);
export const amountIn = (outAmount: bigint, reserveIn: bigint, reserveOut: bigint): bigint => (outAmount * reserveIn) / (reserveOut - outAmount) + 1n;
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** The opening tax is capped so a buyer always nets at least 1% of the spend. */
export function effectiveOpeningBps(s: Pick<CurveState, 'openingTaxBps' | 'feeBps' | 'creatorTaxBps'>): bigint {
  if (s.openingTaxBps <= 0n) return 0n;
  const max = BPS - s.feeBps - s.creatorTaxBps - 100n;
  return s.openingTaxBps > max ? max : s.openingTaxBps;
}

export interface BuyQuote { tokensOut: bigint; spent: bigint; refund: bigint; totalInputBps: bigint; clamped: boolean }

export function quoteBuy(s: CurveState, quoteIn: bigint): BuyQuote {
  const openBps = effectiveOpeningBps(s);
  let spent = quoteIn;
  const fee = (spent * s.feeBps) / BPS;
  const tax = (spent * s.creatorTaxBps) / BPS;
  const opening = (spent * openBps) / BPS;
  let tokensOut = amountOut(spent - fee - tax - opening, s.quoteReserve, s.tokenReserve);
  let clamped = false;
  if (tokensOut > s.sellableTokens) {
    clamped = true;
    tokensOut = s.sellableTokens;
    const net = amountIn(s.sellableTokens, s.quoteReserve, s.tokenReserve);
    const grossed = ceilDiv(net * BPS, BPS - s.feeBps - s.creatorTaxBps - openBps);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }
  return { tokensOut, spent, refund: quoteIn - spent, totalInputBps: s.feeBps + s.creatorTaxBps + openBps, clamped };
}

export function quoteSell(s: Pick<CurveState, 'quoteReserve' | 'tokenReserve' | 'feeBps' | 'creatorTaxBps'>, tokensIn: bigint): bigint {
  const gross = amountOut(tokensIn, s.tokenReserve, s.quoteReserve);
  const fee = (gross * s.feeBps) / BPS;
  const tax = (gross * s.creatorTaxBps) / BPS;
  return gross - fee - tax;
}

/** minOut bounds the rate, not the quantity: a clamped fill at the accepted rate still settles. */
export const minOutFromRate = (quote: bigint, slippageBps: number): bigint => (quote * (BPS - BigInt(slippageBps))) / BPS;

/** Marginal price of one whole token in quote units (float, display only). */
export const spotPrice = (s: Pick<CurveState, 'quoteReserve' | 'tokenReserve'>): number => (s.tokenReserve === 0n ? 0 : Number(s.quoteReserve) / Number(s.tokenReserve));

/** 0..1 along the curve toward graduation. */
export function progress(s: Pick<CurveState, 'realQuoteReserve' | 'graduationThreshold'>): number {
  if (s.graduationThreshold === 0n) return 0;
  const p = Number(s.realQuoteReserve) / Number(s.graduationThreshold);
  return p > 1 ? 1 : p;
}

/** Rebuild a CurveState from the string form the hub streams. */
export function curveStateFromStrings(p: { quoteReserve: string; tokenReserve: string; realQuoteReserve: string; feeBps: number; creatorTaxBps: number; openingTaxBps: number; graduated: boolean; readyToGraduate: boolean }): Pick<CurveState, 'quoteReserve' | 'tokenReserve' | 'realQuoteReserve' | 'feeBps' | 'creatorTaxBps' | 'openingTaxBps' | 'graduated' | 'readyToGraduate'> {
  return { quoteReserve: BigInt(p.quoteReserve), tokenReserve: BigInt(p.tokenReserve), realQuoteReserve: BigInt(p.realQuoteReserve), feeBps: BigInt(p.feeBps), creatorTaxBps: BigInt(p.creatorTaxBps), openingTaxBps: BigInt(p.openingTaxBps), graduated: p.graduated, readyToGraduate: p.readyToGraduate };
}
