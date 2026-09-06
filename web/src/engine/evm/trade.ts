// Base and BNB Chain execution from the tab, signed by the bot's EVM key (the same one it uses on
// Robinhood Chain). Routes come from the KyberSwap aggregator, which quotes across every DEX on
// the chain and hands back calldata for its router; we set the slippage, sign and send through
// our own RPC, and read the fill from the receipt — token Transfer logs for what arrived, the
// wallet's balance either side of the block for what a sale fetched.

import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, type Address, type Chain as ViemChain, type Hex, type PublicClient, type WalletClient } from 'viem';
import { base, bsc } from 'viem/chains';
import type { Chain } from '@tradewarz/shared';
import { unlockedKeys } from '../../botwallet/wallet.js';

export type EvmChain = 'base' | 'bsc';
// Typed as plain chains on purpose: Base's OP-stack formatters would otherwise give each client a different type.
const CHAINS: Record<EvmChain, ViemChain> = { base, bsc };
const rpcUrls: Record<EvmChain, string> = { base: 'https://mainnet.base.org', bsc: 'https://bsc-dataseed.binance.org' };
const pubs: Partial<Record<EvmChain, PublicClient>> = {};

export function setEvmRpc(chain: EvmChain, url: string): void { rpcUrls[chain] = url; delete pubs[chain]; }
export function evmPublic(chain: EvmChain): PublicClient {
  return (pubs[chain] ??= createPublicClient({ chain: CHAINS[chain], transport: http(rpcUrls[chain], { timeout: 20_000, retryCount: 2 }) }));
}
function evmWallet(chain: EvmChain): WalletClient {
  const k = unlockedKeys();
  if (!k) throw new Error('the bot wallet is locked');
  return createWalletClient({ account: k.evm, chain: CHAINS[chain], transport: http(rpcUrls[chain], { timeout: 20_000 }) });
}
export function botEvmAddress(): Address {
  const k = unlockedKeys();
  if (!k) throw new Error('the bot wallet is locked');
  return k.evm.address;
}

const KYBER = 'https://aggregator-api.kyberswap.com';
const NATIVE: Address = '0xEeeeeEeeeEeEeeEeEeEeEEEeeeeEeeeeeeeEEeE';
const headers = { 'content-type': 'application/json', 'x-client-id': 'tradewarz' };

interface RouteResponse { data?: { routeSummary: { amountOut?: string } & Record<string, unknown>; routerAddress: Address }; message?: string }
interface BuildResponse { data?: { data: Hex; routerAddress: Address; amountIn: string; amountOut: string; transactionValue?: string }; message?: string }

/** A quote only (no calldata): how much of tokenOut the aggregator can get for amountIn right now. */
async function quote(chain: EvmChain, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString(), gasInclude: 'true' });
  const r = await fetch(`${KYBER}/${chain}/api/v1/routes?${q}`, { headers: { 'x-client-id': 'tradewarz' }, signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as RouteResponse;
  if (!r.ok || !j.data) throw new Error(`no route on ${chain}: ${j.message ?? r.status}`);
  const out = j.data.routeSummary?.amountOut;
  if (!out) throw new Error(`KyberSwap returned no amount for the route on ${chain}`);
  return BigInt(out);
}

export interface RoundTrip { tokensOut: bigint; nativeBack: bigint; lossPct: number }

/**
 * The sell-side check before a buy: quote the buy, then quote selling exactly what it would return.
 * A token with no sell route, a heavy sell tax or a pool too thin to exit shows up as a round trip
 * that loses far more than two swaps' worth of fees. Quotes only - nothing is signed.
 */
export async function roundTrip(chain: EvmChain, token: Address, nativeIn: bigint): Promise<RoundTrip> {
  const tokensOut = await quote(chain, NATIVE, token, nativeIn);
  if (tokensOut === 0n) throw new Error('the buy would return no tokens');
  let nativeBack: bigint;
  try { nativeBack = await quote(chain, token, NATIVE, tokensOut); } catch (e) { throw new Error(`no way to sell it back: ${(e as Error).message}`); }
  const lossPct = nativeIn === 0n ? 0 : Math.max(0, (1 - Number(nativeBack) / Number(nativeIn)) * 100);
  return { tokensOut, nativeBack, lossPct };
}

/** Ask KyberSwap for the best route and its calldata, with our slippage baked in. */
async function route(chain: EvmChain, tokenIn: Address, tokenOut: Address, amountIn: bigint, slippageBps: number): Promise<{ to: Address; data: Hex; value: bigint; amountOut: bigint }> {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString(), gasInclude: 'true' });
  const r1 = await fetch(`${KYBER}/${chain}/api/v1/routes?${q}`, { headers: { 'x-client-id': 'tradewarz' }, signal: AbortSignal.timeout(15_000) });
  const j1 = (await r1.json().catch(() => ({}))) as RouteResponse;
  if (!r1.ok || !j1.data) throw new Error(`no route on ${chain}: ${j1.message ?? r1.status}`);
  const sender = botEvmAddress();
  const r2 = await fetch(`${KYBER}/${chain}/api/v1/route/build`, {
    method: 'POST', headers, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ routeSummary: j1.data.routeSummary, sender, recipient: sender, slippageTolerance: Math.max(1, Math.round(slippageBps)), deadline: Math.floor(Date.now() / 1000) + 300, source: 'tradewarz' }),
  });
  const j2 = (await r2.json().catch(() => ({}))) as BuildResponse;
  if (!r2.ok || !j2.data) throw new Error(`KyberSwap would not build the swap: ${j2.message ?? r2.status}`);
  return { to: j2.data.routerAddress, data: j2.data.data, value: tokenIn === NATIVE ? amountIn : 0n, amountOut: BigInt(j2.data.amountOut) };
}

async function ensureAllowance(chain: EvmChain, token: Address, spender: Address, amount: bigint): Promise<void> {
  const pub = evmPublic(chain);
  const owner = botEvmAddress();
  const current = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
  if (current >= amount) return;
  const w = evmWallet(chain);
  const hash = await w.writeContract({ account: w.account!, chain: w.chain, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, (1n << 256n) - 1n] });
  await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
}

export interface EvmFill { hash: string; nativeIn: bigint; nativeOut: bigint; tokens: bigint; gasWei: bigint }

/** Native coin → token. Tokens received are read from the receipt's Transfer logs into our wallet. */
export async function buyEvm(chain: EvmChain, token: Address, nativeIn: bigint, slippageBps: number): Promise<EvmFill> {
  const me = botEvmAddress();
  const r = await route(chain, NATIVE, token, nativeIn, slippageBps);
  const w = evmWallet(chain);
  const pub = evmPublic(chain);
  const hash = await w.sendTransaction({ account: w.account!, chain: w.chain, to: r.to, data: r.data, value: r.value });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== 'success') throw new Error(`the swap reverted on chain (${hash})`);
  const tokens = parseEventLogs({ abi: erc20Abi, logs: rc.logs, eventName: 'Transfer' })
    .filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.args.to.toLowerCase() === me.toLowerCase())
    .reduce((a, l) => a + l.args.value, 0n);
  if (tokens <= 0n) throw new Error(`the swap confirmed but no ${token.slice(0, 8)}… arrived (${hash})`);
  return { hash, nativeIn, nativeOut: 0n, tokens, gasWei: rc.gasUsed * (rc.effectiveGasPrice ?? 0n) };
}

/** Token → native coin. What came back is the wallet's balance change with the gas added back. */
export async function sellEvm(chain: EvmChain, token: Address, tokensIn: bigint, slippageBps: number): Promise<EvmFill> {
  const me = botEvmAddress();
  const pub = evmPublic(chain);
  const held = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [me] });
  const amount = tokensIn > held ? held : tokensIn;
  if (amount <= 0n) throw new Error('the wallet holds none of this token any more');
  const r = await route(chain, token, NATIVE, amount, slippageBps);
  await ensureAllowance(chain, token, r.to, amount);
  const before = await pub.getBalance({ address: me });
  const w = evmWallet(chain);
  const hash = await w.sendTransaction({ account: w.account!, chain: w.chain, to: r.to, data: r.data, value: 0n });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== 'success') throw new Error(`the swap reverted on chain (${hash})`);
  const after = await pub.getBalance({ address: me });
  const gas = rc.gasUsed * (rc.effectiveGasPrice ?? 0n);
  const out = after - before + gas;
  if (out <= 0n) throw new Error(`the swap confirmed but nothing came back (${hash})`);
  return { hash, nativeIn: 0n, nativeOut: out, tokens: amount, gasWei: gas };
}

export async function evmBalanceWei(chain: EvmChain, address: Address): Promise<bigint> { return evmPublic(chain).getBalance({ address }); }
export const isEvmTradeChain = (c: Chain): c is EvmChain => c === 'base' || c === 'bsc';
