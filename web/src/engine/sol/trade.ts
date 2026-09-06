// Solana execution from the tab, signed by the bot wallet held in memory. Two builders:
//
//   PumpPortal "local" trade API   builds a pump.fun / PumpSwap swap and hands back the bytes. Only
//                                  builds — the key never leaves this tab; we sign and send through
//                                  our own RPC. (Ported from pumpsniper's LiveProvider.)
//   Jupiter                        the same for any other token DexScreener lists (Raydium, Meteora,
//                                  Orca…): quote → swap transaction → sign → send.
//
// Fills are never assumed: after confirmation the transaction is read back and the wallet's own
// SOL and token balance changes are what we report — exactly the numbers the hub's indexer will
// read for the leaderboard, so the two can't disagree.

import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction, type VersionedTransactionResponse } from '@solana/web3.js';
import { PUMP_TOKEN_DECIMALS } from '@tradewarz/shared';
import { unlockedKeys } from '../../botwallet/wallet.js';

let rpcUrl = 'https://api.mainnet-beta.solana.com';
let conn: Connection | null = null;
let jupiterKey = '';
export function setSolanaRpc(url: string): void { rpcUrl = url; conn = null; }
export function setJupiterKey(k: string): void { jupiterKey = k; }
export function connection(): Connection { return (conn ??= new Connection(rpcUrl, { commitment: 'confirmed' })); }

function keypair() {
  const k = unlockedKeys();
  if (!k) throw new Error('the bot wallet is locked');
  return k.solana;
}
export function botSolAddress(): string { return keypair().publicKey.toBase58(); }

export interface SolFill {
  hash: string;
  venue: 'curve' | 'pool';
  /** Lamports that left (buy) or arrived (sell), the network fee excluded. */
  lamports: bigint;
  /** Raw token units received (buy) or sent (sell). */
  tokens: bigint;
  feeLamports: bigint;
}

const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local';
const JUPITER = () => (jupiterKey ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Where a token trades right now, as PumpPortal names pools: on the curve, on PumpSwap, elsewhere — or 'auto' when we don't know and PumpPortal should work it out. */
export type SolVenue = 'pump' | 'pump-amm' | 'other' | 'auto';

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
}

/** Ask PumpPortal for an unsigned transaction. `amount` is SOL for a buy, tokens (whole) for a sell. */
async function pumpPortalTx(action: 'buy' | 'sell', mint: string, amount: number, slippagePct: number, pool: 'pump' | 'pump-amm' | 'auto', priorityFeeSol: number): Promise<VersionedTransaction> {
  const res = await postJson(PUMPPORTAL, {
    publicKey: botSolAddress(), action, mint, amount, denominatedInSol: action === 'buy' ? 'true' : 'false',
    slippage: Math.max(1, Math.round(slippagePct)), priorityFee: priorityFeeSol, pool,
  });
  if (!res.ok) throw new Error(`PumpPortal would not build the ${action}: ${res.status} ${(await res.text()).slice(0, 140)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return VersionedTransaction.deserialize(bytes);
}

/** Jupiter: quote, then the swap transaction, for tokens that are not on pump.fun. */
async function jupiterTx(inputMint: string, outputMint: string, amountRaw: bigint, slippagePct: number): Promise<VersionedTransaction> {
  const headers: Record<string, string> = jupiterKey ? { 'x-api-key': jupiterKey } : {};
  const q = new URLSearchParams({ inputMint, outputMint, amount: amountRaw.toString(), slippageBps: String(Math.round(slippagePct * 100)), restrictIntermediateTokens: 'true' });
  const quoteRes = await fetch(`${JUPITER()}/quote?${q}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!quoteRes.ok) throw new Error(`Jupiter has no route: ${quoteRes.status} ${(await quoteRes.text()).slice(0, 140)}`);
  const quote = await quoteRes.json();
  const swapRes = await postJson(`${JUPITER()}/swap`, {
    quoteResponse: quote, userPublicKey: botSolAddress(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: 'high' } },
  }, headers);
  if (!swapRes.ok) throw new Error(`Jupiter would not build the swap: ${swapRes.status} ${(await swapRes.text()).slice(0, 140)}`);
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };
  return VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
}

/** Sign, send, confirm, and read back what actually happened to this wallet. */
async function execute(tx: VersionedTransaction, mint: string): Promise<{ hash: string; tx: VersionedTransactionResponse }> {
  const kp = keypair();
  const c = connection();
  tx.sign([kp]);
  const hash = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' });
  const bh = await c.getLatestBlockhash('confirmed');
  const conf = await c.confirmTransaction({ signature: hash, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) throw new Error(`the transaction failed on chain: ${JSON.stringify(conf.value.err).slice(0, 120)} (${hash})`);
  let got: VersionedTransactionResponse | null = null;
  for (let i = 0; i < 6 && !got; i++) {
    got = await c.getTransaction(hash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!got) await new Promise((r) => setTimeout(r, 700));
  }
  if (!got?.meta) throw new Error(`confirmed but not yet readable: ${hash}`);
  void mint;
  return { hash, tx: got };
}

/** This wallet's SOL and token deltas from a confirmed transaction. */
function deltas(tx: VersionedTransactionResponse, owner: string, mint: string): { lamports: bigint; fee: bigint; tokens: bigint } {
  const m = tx.meta!;
  const fee = BigInt(m.fee);
  const lamports = BigInt(m.postBalances[0] ?? 0) - BigInt(m.preBalances[0] ?? 0); // negative on a buy
  const amount = (list: typeof m.preTokenBalances) => list?.filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n) ?? 0n;
  return { lamports, fee, tokens: amount(m.postTokenBalances) - amount(m.preTokenBalances) };
}

export interface BuyOpts { venue: SolVenue; slippagePct: number; priorityFeeSol: number }

/**
 * Build the unsigned transaction for a venue. 'auto' means "we don't know where this trades":
 * PumpPortal is asked first (it resolves pump.fun, PumpSwap and Raydium itself) and Jupiter is the
 * fallback for everything else — so a pasted address works whatever DEX it lives on.
 */
async function buildTx(action: 'buy' | 'sell', mint: string, amountRaw: bigint, opts: BuyOpts): Promise<VersionedTransaction> {
  const viaJupiter = () => (action === 'buy' ? jupiterTx(SOL_MINT, mint, amountRaw, opts.slippagePct) : jupiterTx(mint, SOL_MINT, amountRaw, opts.slippagePct));
  const viaPumpPortal = (pool: 'pump' | 'pump-amm' | 'auto') => {
    const amount = action === 'buy' ? Number(amountRaw) / LAMPORTS_PER_SOL : Number(amountRaw) / 10 ** PUMP_TOKEN_DECIMALS;
    return pumpPortalTx(action, mint, amount, opts.slippagePct, pool, opts.priorityFeeSol);
  };
  if (opts.venue === 'other') return viaJupiter();
  if (opts.venue === 'auto') {
    try { return await viaPumpPortal('auto'); } catch (e) {
      try { return await viaJupiter(); } catch (e2) { throw new Error(`${(e as Error).message}; ${(e2 as Error).message}`); }
    }
  }
  return viaPumpPortal(opts.venue === 'pump' ? 'pump' : 'auto');
}

export async function buySolana(mint: string, lamports: bigint, opts: BuyOpts): Promise<SolFill> {
  const me = botSolAddress();
  const tx = await buildTx('buy', mint, lamports, opts);
  const { hash, tx: got } = await execute(tx, mint);
  const d = deltas(got, me, mint);
  if (d.tokens <= 0n) throw new Error(`the buy confirmed but no ${mint.slice(0, 6)}… arrived (${hash})`);
  return { hash, venue: opts.venue === 'pump' ? 'curve' : 'pool', lamports: -d.lamports - d.fee, tokens: d.tokens, feeLamports: d.fee };
}

export async function sellSolana(mint: string, tokensRaw: bigint, opts: BuyOpts): Promise<SolFill> {
  const me = botSolAddress();
  const tx = await buildTx('sell', mint, tokensRaw, opts);
  const { hash, tx: got } = await execute(tx, mint);
  const d = deltas(got, me, mint);
  const out = d.lamports + d.fee;
  if (out <= 0n) throw new Error(`the sale confirmed but no SOL came back (${hash})`);
  return { hash, venue: opts.venue === 'pump' ? 'curve' : 'pool', lamports: out, tokens: -d.tokens, feeLamports: d.fee };
}

export async function solBalanceLamports(address: string): Promise<bigint> {
  return BigInt(await connection().getBalance(new PublicKey(address), 'confirmed'));
}

/** How many raw units of `mint` this wallet holds right now (so a sell never asks for more than exists). */
export async function tokenBalanceRaw(mint: string, owner: string): Promise<bigint> {
  const res = await connection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, 'confirmed');
  let total = 0n;
  for (const a of res.value) total += BigInt((a.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount);
  return total;
}
