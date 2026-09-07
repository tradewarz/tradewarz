// Robinhood Chain execution from the tab: pons curve buys/sells and v4 pool sells, signed by
// the bot wallet held in memory. The only adaptation is that the
// signer is the unlocked in-browser account and the RPC is the public endpoint the hub named.

import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import {
  BPS, MULTICALL3, PONS, ROBINHOOD_CHAIN_ID, ZERO_ADDRESS, curveAbi, encodeV4Swap, factoryAbi, minOutFromRate, permit2Abi, ponsPoolKey, quoteBuy, quoteSell, tokenAbi, v4QuoterAbi,
  type CurveState, type PoolKey, type RouterLayout,
} from '@tradewarz/shared';
import { unlockedKeys } from '../../botwallet/wallet.js';

let rpcUrl = 'https://rpc.mainnet.chain.robinhood.com';
export function setRobinhoodRpc(url: string): void { rpcUrl = url; pub = null; }

const chain = () => defineChain({ id: ROBINHOOD_CHAIN_ID, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } }, contracts: { multicall3: { address: MULTICALL3 } } });
let pub: PublicClient | null = null;
export function publicClient(): PublicClient { if (!pub) pub = createPublicClient({ chain: chain(), transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) }); return pub; }
function wallet(): WalletClient {
  const k = unlockedKeys();
  if (!k) throw new Error('the bot wallet is locked');
  return createWalletClient({ account: k.evm, chain: chain(), transport: http(rpcUrl, { timeout: 20_000 }) });
}
export function botEvmAddress(): Address { const k = unlockedKeys(); if (!k) throw new Error('the bot wallet is locked'); return k.evm.address; }

export async function readCurveState(curve: Address, recipient: Address): Promise<CurveState> {
  const c = { address: curve, abi: curveAbi } as const;
  const r = await publicClient().multicall({
    allowFailure: true,
    contracts: [
      { ...c, functionName: 'getReserves' }, { ...c, functionName: 'realQuoteReserve' }, { ...c, functionName: 'sellableTokens' }, { ...c, functionName: 'reservedTokens' },
      { ...c, functionName: 'graduationThreshold' }, { ...c, functionName: 'feeBps' }, { ...c, functionName: 'creatorTaxBps' }, { ...c, functionName: 'currentSnipeTaxBps', args: [recipient] },
      { ...c, functionName: 'graduated' }, { ...c, functionName: 'readyToGraduate' }, { ...c, functionName: 'launchedAt' },
    ],
  });
  // Every read that can move money has to have actually come back. Defaulting a failed call to
  // zero used to price a sell off an empty curve — the transaction then reverted with a custom
  // error, and the same zero told the bot the pool had drained. Unknown is not zero. (2026-09-06)
  const REQUIRED: Array<[number, string]> = [
    [0, 'reserves'], [1, 'the real quote reserve'], [2, 'sellable tokens'], [3, 'reserved tokens'],
    [5, 'the fee'], [6, 'the creator tax'], [7, 'the opening tax'], [8, 'graduated'], [9, 'ready to graduate'],
  ];
  const missing = REQUIRED.filter(([i]) => r[i]?.status !== 'success').map(([, name]) => name);
  if (missing.length) throw new Error(`could not read the curve (${missing.join(', ')}); not trading on a half-read state`);
  const ok = <T,>(i: number, d: T): T => (r[i]?.status === 'success' ? (r[i]!.result as T) : d);
  const reserves = ok<readonly [bigint, bigint]>(0, [0n, 0n]);
  return {
    quoteReserve: reserves[0], tokenReserve: reserves[1], realQuoteReserve: ok(1, 0n), sellableTokens: ok(2, 0n), reservedTokens: ok(3, 0n), graduationThreshold: ok(4, 0n),
    feeBps: ok(5, 100n), creatorTaxBps: ok(6, 0n), openingTaxBps: ok(7, 0n), graduated: ok(8, false), readyToGraduate: ok(9, false), launchedAt: Number(ok(10, 0n)), readAtMs: Date.now(),
  };
}

export async function openingTaxFor(curve: Address, recipient: Address): Promise<bigint> {
  try { return await publicClient().readContract({ address: curve, abi: curveAbi, functionName: 'currentSnipeTaxBps', args: [recipient] }); } catch { return 0n; }
}

export interface BuyResult { venue: 'curve' | 'pool'; ethIn: bigint; tokensOut: bigint; hash: Hex; gasUsed: bigint }
export interface SellResult { venue: 'curve' | 'pool'; tokensIn: bigint; ethOut: bigint; hash: Hex; gasUsed: bigint }

export async function buyOnCurve(curve: Address, ethIn: bigint, slippageBps: number, state?: CurveState): Promise<BuyResult> {
  const recipient = botEvmAddress();
  const s = state ?? (await readCurveState(curve, recipient));
  const q = quoteBuy(s, ethIn);
  const minOut = minOutFromRate(q.tokensOut, slippageBps);
  const w = wallet();
  const hash = await w.writeContract({ account: w.account!, chain: w.chain, address: curve, abi: curveAbi, functionName: 'buy', args: [ethIn, minOut, recipient], value: ethIn });
  const rc = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error(`buy reverted: ${hash}`);
  const buys = parseEventLogs({ abi: curveAbi, logs: rc.logs, eventName: 'CurveBuy' });
  return { venue: 'curve', ethIn, tokensOut: buys.reduce((a, b) => a + b.args.tokensOut, 0n), hash, gasUsed: rc.gasUsed };
}

async function ensureAllowance(token: Address, spender: Address, amount: bigint): Promise<void> {
  const owner = botEvmAddress();
  const current = await publicClient().readContract({ address: token, abi: tokenAbi, functionName: 'allowance', args: [owner, spender] });
  if (current >= amount) return;
  const w = wallet();
  const hash = await w.writeContract({ account: w.account!, chain: w.chain, address: token, abi: tokenAbi, functionName: 'approve', args: [spender, (1n << 256n) - 1n] });
  await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
}

export async function sellOnCurve(curve: Address, token: Address, tokensIn: bigint, slippageBps: number): Promise<SellResult> {
  const me = botEvmAddress();
  const s = await readCurveState(curve, me);
  if (s.graduated || s.readyToGraduate) throw new Error('curve closed');
  const minOut = minOutFromRate(quoteSell(s, tokensIn), slippageBps);
  await ensureAllowance(token, curve, tokensIn);
  const w = wallet();
  const hash = await w.writeContract({ account: w.account!, chain: w.chain, address: curve, abi: curveAbi, functionName: 'sell', args: [tokensIn, minOut, me] });
  const rc = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error(`sell reverted: ${hash}`);
  const sells = parseEventLogs({ abi: curveAbi, logs: rc.logs, eventName: 'CurveSell' });
  return { venue: 'curve', tokensIn, ethOut: sells.reduce((a, b) => a + b.args.quoteOut, 0n), hash, gasUsed: rc.gasUsed };
}

const MAX_UINT160 = (1n << 160n) - 1n, MAX_UINT48 = Number((1n << 48n) - 1n);
let detectedLayout: RouterLayout | null = null;
async function detectRouterLayout(key: PoolKey): Promise<RouterLayout> {
  if (detectedLayout) return detectedLayout;
  const probeFrom: Address = '0x000000000000000000000000000000000000bEEF';
  for (const layout of ['current', 'legacy'] as RouterLayout[]) {
    const call = encodeV4Swap(key, true, 100_000_000_000_000n, 0n, layout);
    try {
      await publicClient().call({ account: probeFrom, to: call.to, data: call.data, value: call.value, stateOverride: [{ address: probeFrom, balance: 10n ** 18n }] });
      detectedLayout = layout;
      return layout;
    } catch { /* try the other layout */ }
  }
  throw new Error('the router did not accept either parameter layout');
}

async function quoteV4(key: PoolKey, zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const { result } = await publicClient().simulateContract({ address: PONS.v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }] });
  return result[0];
}

export async function sellOnPool(token: Address, tokensIn: bigint, slippageBps: number): Promise<SellResult> {
  const rec = await publicClient().readContract({ address: PONS.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] });
  if (!rec.exists || rec.phase !== 2) throw new Error(`no pool to sell into (phase ${rec.phase})`);
  if (rec.pairToken !== ZERO_ADDRESS) throw new Error('pool is not an ETH pair');
  const key = ponsPoolKey(token, rec.pairToken, Number(rec.tickSpacing));
  const tokenIsCurrency0 = key.currency0.toLowerCase() === token.toLowerCase();
  const quoted = await quoteV4(key, tokenIsCurrency0, tokensIn);
  const minOut = (quoted * (BPS - BigInt(slippageBps))) / BPS;
  const me = botEvmAddress();
  await ensureAllowance(token, PONS.permit2, tokensIn);
  const [p2amount, p2exp] = await publicClient().readContract({ address: PONS.permit2, abi: permit2Abi, functionName: 'allowance', args: [me, token, PONS.universalRouter] });
  if (p2amount < tokensIn || p2exp < Math.floor(Date.now() / 1000) + 600) {
    const w = wallet();
    const h = await w.writeContract({ account: w.account!, chain: w.chain, address: PONS.permit2, abi: permit2Abi, functionName: 'approve', args: [token, PONS.universalRouter, MAX_UINT160, MAX_UINT48] });
    await publicClient().waitForTransactionReceipt({ hash: h, timeout: 90_000 });
  }
  const layout = await detectRouterLayout(key);
  const call = encodeV4Swap(key, tokenIsCurrency0, tokensIn, minOut, layout);
  const balBefore = await publicClient().getBalance({ address: me });
  const w = wallet();
  const hash = await w.sendTransaction({ account: w.account!, chain: w.chain, to: call.to, data: call.data, value: call.value });
  const rc = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error(`pool sell reverted: ${hash}`);
  const balAfter = await publicClient().getBalance({ address: me });
  return { venue: 'pool', tokensIn, ethOut: balAfter - balBefore + rc.gasUsed * (rc.effectiveGasPrice ?? 0n), hash, gasUsed: rc.gasUsed };
}

/** Buy a graduated pons token on its v4 pool: ETH in, tokens out, priced by the quoter with your slippage. */
export async function buyOnPool(token: Address, ethIn: bigint, slippageBps: number): Promise<BuyResult> {
  const rec = await publicClient().readContract({ address: PONS.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] });
  if (!rec.exists || rec.phase !== 2) throw new Error(`no pool to buy from (phase ${rec.phase})`);
  if (rec.pairToken !== ZERO_ADDRESS) throw new Error('pool is not an ETH pair');
  const key = ponsPoolKey(token, rec.pairToken, Number(rec.tickSpacing));
  const nativeIsCurrency0 = key.currency0.toLowerCase() === ZERO_ADDRESS.toLowerCase();
  const quoted = await quoteV4(key, nativeIsCurrency0, ethIn);
  const minOut = (quoted * (BPS - BigInt(slippageBps))) / BPS;
  const layout = await detectRouterLayout(key);
  const call = encodeV4Swap(key, nativeIsCurrency0, ethIn, minOut, layout);
  const me = botEvmAddress();
  const before = await publicClient().readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [me] });
  const w = wallet();
  const hash = await w.sendTransaction({ account: w.account!, chain: w.chain, to: call.to, data: call.data, value: call.value });
  const rc = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== 'success') throw new Error(`pool buy reverted: ${hash}`);
  const after = await publicClient().readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [me] });
  return { venue: 'pool', ethIn, tokensOut: after - before, hash, gasUsed: rc.gasUsed };
}

/** Buy wherever the token trades right now: the curve while it is open, the pool once it has graduated. */
export async function buyAnywhere(token: Address, curve: Address | null, ethIn: bigint, slippageBps: number): Promise<BuyResult> {
  const rec = await publicClient().readContract({ address: PONS.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] });
  if (!rec.exists) throw new Error('not a pons token');
  if (rec.phase === 0) return buyOnCurve(curve ?? rec.curve, ethIn, slippageBps);
  if (rec.phase === 2) return buyOnPool(token, ethIn, slippageBps);
  throw new Error('this launch is between its curve and its pool right now (being swept); try again in a minute');
}

/** Sell wherever the token trades right now. */
export async function sellAnywhere(token: Address, curve: Address | null, tokensIn: bigint, slippageBps: number): Promise<SellResult> {
  const rec = await publicClient().readContract({ address: PONS.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] });
  if (!rec.exists) throw new Error('not a pons token');
  if (rec.phase === 0) return sellOnCurve(curve ?? rec.curve, token, tokensIn, slippageBps);
  if (rec.phase === 2) return sellOnPool(token, tokensIn, slippageBps);
  throw new Error('trading is halted between sweep and pool creation; try again in a minute');
}

export async function nativeBalanceWei(address: Address): Promise<bigint> { return publicClient().getBalance({ address }); }

/** The pons curve for a token the hub isn't showing (a pasted address). Throws if it isn't a pons launch. */
export async function resolveCurve(token: Address): Promise<{ curve: Address; phase: number }> {
  const rec = await publicClient().readContract({ address: PONS.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token] });
  if (!rec.exists) throw new Error('not a pons launch: TradeWarz trades pons tokens on Robinhood Chain');
  return { curve: rec.curve, phase: Number(rec.phase) };
}
export async function tokenBalance(token: Address, owner: Address): Promise<bigint> { return publicClient().readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [owner] }); }
