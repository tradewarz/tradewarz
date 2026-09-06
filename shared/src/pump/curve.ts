// pump.fun's bonding curve, as pure maths. Shared so the hub prices marks and the tab prices its
// own position with the same numbers. Constants and the account layout are the ones pumpsniper
// verified live against the pumpdotfun SDK (2026-08); nothing here talks to a network.
//
// Account layout (sha256("account:BondingCurve")[..8] = 17 b7 f8 37 60 d8 ac 60):
//   0x00 discriminator (8)  0x08 virtualTokenReserves u64  0x10 virtualSolReserves u64
//   0x18 realTokenReserves u64  0x20 realSolReserves u64  0x28 tokenTotalSupply u64  0x30 complete u8
// Token amounts have 6 decimals, SOL amounts 9.

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_TOTAL_SUPPLY = 1_000_000_000;
export const PUMP_INITIAL_VSOL = 30;
export const PUMP_INITIAL_VTOKENS = 1_073_000_000;
export const PUMP_INITIAL_REAL_TOKENS = 793_100_000;
/** Real SOL in the curve when it completes. */
export const PUMP_GRADUATION_SOL = 85;
export const PUMP_FEE_BPS = 100;
export const PUMP_TOKEN_DECIMALS = 6;
export const LAMPORTS = 1_000_000_000;

export interface PumpCurveState {
  vSol: number;
  vTokens: number;
  realSol: number;
  /** Tokens still for sale on the curve; null when only the event numbers are known. */
  realTokens: number | null;
  complete: boolean;
}

/** Tokens out for `solIn` SOL, after the 1% fee. Constant product on the virtual reserves. */
export function pumpQuoteBuy(s: PumpCurveState, solIn: number): number {
  if (solIn <= 0 || s.vSol <= 0 || s.vTokens <= 0) return 0;
  const net = solIn * (1 - PUMP_FEE_BPS / 10_000);
  return s.vTokens - (s.vSol * s.vTokens) / (s.vSol + net);
}

/** SOL out for `tokensIn` tokens, after the 1% fee. */
export function pumpQuoteSell(s: PumpCurveState, tokensIn: number): number {
  if (tokensIn <= 0 || s.vSol <= 0 || s.vTokens <= 0) return 0;
  const gross = s.vSol - (s.vSol * s.vTokens) / (s.vTokens + tokensIn);
  return Math.max(0, gross * (1 - PUMP_FEE_BPS / 10_000));
}

export const pumpPriceSol = (s: PumpCurveState): number => (s.vTokens > 0 ? s.vSol / s.vTokens : 0);
export const pumpMarketCapSol = (s: PumpCurveState): number => pumpPriceSol(s) * PUMP_TOTAL_SUPPLY;

/** 0..1 toward graduation: tokens sold when the real reserve is known, SOL raised otherwise. */
export function pumpProgress(s: PumpCurveState): number {
  if (s.complete) return 1;
  if (s.realTokens !== null) return clamp01((PUMP_INITIAL_REAL_TOKENS - s.realTokens) / PUMP_INITIAL_REAL_TOKENS);
  return clamp01(s.realSol / PUMP_GRADUATION_SOL);
}

/** The creator's share of supply from a creation-time buy of this many whole tokens. */
export const pumpDevSharePct = (initialBuyTokens: number): number => (initialBuyTokens / PUMP_TOTAL_SUPPLY) * 100;

/** A state from a PumpPortal event: virtual reserves only, real SOL inferred from the starting offset. */
export function pumpStateFromEvent(vSol: number, vTokens: number, complete = false): PumpCurveState {
  return { vSol, vTokens, realSol: Math.max(0, vSol - PUMP_INITIAL_VSOL), realTokens: null, complete };
}

/** Decode a bonding-curve account. Throws when the bytes are not one. */
export function decodePumpCurve(data: Uint8Array): PumpCurveState {
  if (data.length < 0x31) throw new Error(`bonding curve account is ${data.length} bytes; need 49`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (off: number): number => Number(view.getBigUint64(off, true));
  const vTokens = u64(0x08) / 10 ** PUMP_TOKEN_DECIMALS;
  const vSol = u64(0x10) / LAMPORTS;
  const realTokens = u64(0x18) / 10 ** PUMP_TOKEN_DECIMALS;
  const realSol = u64(0x20) / LAMPORTS;
  const complete = data[0x30] !== 0;
  return { vSol, vTokens, realSol, realTokens, complete };
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
