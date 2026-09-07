// The unlocked bot wallet: keys in memory for this tab only, plus the few on-chain
// actions the wallet tab needs (balances, withdraw to the gate wallet, sign the registration
// message). The trading engine signs through the same keys.
//
// One phrase, two keys: an ed25519 keypair for Solana and one EVM account that is the bot's
// address on every EVM chain we trade (Robinhood Chain, Base, BNB Chain).

import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from 'viem';
import { EVM_CHAIN_ID, EXPLORER, CHAIN_NAME, NATIVE_SYMBOL, type Chain } from '@tradewarz/shared';
import { deriveKeys, type DerivedKeys } from './derive.js';

let keys: DerivedKeys | null = null;
let mnemonicInMemory: string | null = null; // shown once on the backup screen; never stored
const listeners = new Set<() => void>();

export function unlockedKeys(): DerivedKeys | null { return keys; }
export function unlockedMnemonic(): string | null { return mnemonicInMemory; }
export function isUnlocked(): boolean { return keys !== null; }
export function onWalletChange(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
function notify(): void { for (const l of listeners) l(); }

export function unlockWithMnemonic(mnemonic: string): DerivedKeys {
  keys = deriveKeys(mnemonic);
  mnemonicInMemory = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
  notify();
  return keys;
}
export function lock(): void { keys = null; mnemonicInMemory = null; notify(); }

/** The bot's address on a chain. Every EVM chain shares one address. */
export function botAddress(chain: Chain): string | null {
  if (!keys) return null;
  return chain === 'solana' ? keys.addresses.solana : keys.addresses.robinhood;
}

/** Sign the hub's registration message with the bot key. */
export async function signWithBot(chain: Chain, message: string): Promise<string> {
  if (!keys) throw new Error('Unlock the bot wallet first.');
  if (chain === 'solana') return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keys.solana.secretKey));
  return keys.evm.signMessage({ message });
}

type EvmChain = Exclude<Chain, 'solana'>;
const evmChain = (chain: EvmChain, rpcUrl: string) => defineChain({
  id: EVM_CHAIN_ID[chain], name: CHAIN_NAME[chain],
  nativeCurrency: { name: NATIVE_SYMBOL[chain] === 'BNB' ? 'BNB' : 'Ether', symbol: NATIVE_SYMBOL[chain], decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

export async function nativeBalance(chain: Chain, address: string, rpcUrl: string): Promise<number> {
  if (chain === 'solana') {
    const conn = new Connection(rpcUrl, 'confirmed');
    return (await conn.getBalance(new PublicKey(address), 'confirmed')) / LAMPORTS_PER_SOL;
  }
  const client = createPublicClient({ chain: evmChain(chain, rpcUrl), transport: http(rpcUrl) });
  return Number(formatEther(await client.getBalance({ address: address as `0x${string}` })));
}

const SOL_RESERVE_LAMPORTS = 0.002 * LAMPORTS_PER_SOL; // fee + rent headroom
const EVM_RESERVE_WEI = parseEther('0.0002');

/** What a transfer out costs right now, and what is left to send after it. */
interface Ceiling { balance: bigint; gas: bigint; reserve: bigint; max: bigint; gasLimit: bigint }

async function evmCeiling(chain: Exclude<Chain, 'solana'>, to: string, rpcUrl: string): Promise<Ceiling> {
  if (!keys) throw new Error('Unlock the bot wallet first.');
  const pub = createPublicClient({ chain: evmChain(chain, rpcUrl), transport: http(rpcUrl) });
  const balance = await pub.getBalance({ address: keys.evm.address });
  // Ask the chain what a transfer costs here: on Arbitrum-style chains (Robinhood Chain) a plain send
  // needs well over the classic 21,000 gas because the L1 data fee is charged as extra gas units.
  const gasPrice = await pub.getGasPrice();
  let gasLimit = 21_000n;
  try { gasLimit = await pub.estimateGas({ account: keys.evm.address, to: to as `0x${string}`, value: 1n }); } catch { /* fall back to the classic figure */ }
  gasLimit = (gasLimit * 13n) / 10n; // headroom: unused gas is refunded
  const gas = (gasLimit * gasPrice * 15n) / 10n; // and a little for a price move while the tx is in flight
  const max = balance - gas - EVM_RESERVE_WEI;
  return { balance, gas, reserve: EVM_RESERVE_WEI, max: max > 0n ? max : 0n, gasLimit };
}

/** The most that can leave the bot wallet right now, in whole coins - what the "All" button fills in. */
export async function maxWithdrawable(chain: Chain, to: string, rpcUrl: string): Promise<number> {
  if (!keys) throw new Error('Unlock the bot wallet first.');
  if (chain === 'solana') {
    const balance = await new Connection(rpcUrl, 'confirmed').getBalance(keys.solana.publicKey, 'confirmed');
    return Math.max(0, balance - SOL_RESERVE_LAMPORTS) / LAMPORTS_PER_SOL;
  }
  const c = await evmCeiling(chain, to, rpcUrl);
  return Number(formatEther(c.max));
}

// Where a withdrawal may go: the sign-in wallets linked to the account, set by the page from the session.
// This is not a cryptographic control - the key lives in this browser, so anything running in the tab
// could move funds - but it makes the one code path that sends out of the bot wallet check its destination,
// so a bug or a stray call cannot pick an address the person never linked.
let withdrawTargets = new Set<string>();
export function setWithdrawTargets(addresses: string[]): void { withdrawTargets = new Set(addresses.map((a) => a.toLowerCase())); }
function assertWithdrawTarget(to: string): void {
  if (!withdrawTargets.has(to.toLowerCase())) throw new Error('Withdrawals only go to a sign-in wallet linked to your account (Account tab).');
}

/**
 * Withdraw from the bot wallet to `to`, which must be a linked sign-in wallet. "all", or an amount at or
 * above the ceiling, sends everything that can leave after gas and a small reserve.
 */
export async function withdraw(chain: Chain, to: string, amount: number | 'all', rpcUrl: string): Promise<{ hash: string; amount: number }> {
  if (!keys) throw new Error('Unlock the bot wallet first.');
  assertWithdrawTarget(to);
  if (chain === 'solana') {
    const conn = new Connection(rpcUrl, 'confirmed');
    const from = keys.solana.publicKey;
    const balance = await conn.getBalance(from, 'confirmed');
    const reserve = SOL_RESERVE_LAMPORTS;
    const max = balance - reserve;
    const asked = amount === 'all' ? max : Math.round(amount * LAMPORTS_PER_SOL);
    // Asking for the ceiling (the prefilled "All" figure, or a hair over it) means "everything".
    const lamports = asked >= max - 1000 ? max : asked;
    if (lamports <= 0) throw new Error(`Nothing to withdraw after the fee reserve: the wallet holds ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL.`);
    if (lamports > max) throw new Error(`At most ${(max / LAMPORTS_PER_SOL).toFixed(4)} SOL can leave (a small fee reserve stays).`);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(to), lamports }));
    tx.sign(keys.solana);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (conf.value.err) throw new Error('The transaction failed on-chain.');
    return { hash: sig, amount: lamports / LAMPORTS_PER_SOL };
  }
  const vc = evmChain(chain, rpcUrl);
  const symbol = NATIVE_SYMBOL[chain];
  const pub = createPublicClient({ chain: vc, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account: keys.evm, chain: vc, transport: http(rpcUrl) });
  const c = await evmCeiling(chain, to, rpcUrl);
  const fmt = (x: bigint) => Number(formatEther(x)).toFixed(6);
  if (c.balance === 0n) throw new Error(`The bot wallet holds no ${symbol} on ${CHAIN_NAME[chain]}.`);
  const asked = amount === 'all' ? c.max : parseEther(String(amount));
  // Asking for the ceiling (the prefilled "All" figure, or a hair over it) means "everything".
  const value = asked >= c.max - c.max / 1000n ? c.max : asked;
  if (value <= 0n) throw new Error(`Nothing to withdraw after gas: the wallet holds ${fmt(c.balance)} ${symbol} and the transfer needs about ${fmt(c.gas)} ${symbol} of gas plus a ${fmt(c.reserve)} ${symbol} reserve.`);
  if (value > c.max) throw new Error(`At most ${fmt(c.max)} ${symbol} can leave (about ${fmt(c.gas)} ${symbol} of gas stays behind).`);
  const hash = await wallet.sendTransaction({ to: to as `0x${string}`, value, gas: c.gasLimit });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('The transaction reverted on-chain.');
  return { hash, amount: Number(formatEther(value)) };
}

export const explorerTx = (chain: Chain, hash: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].tx}/${hash}`;
export const explorerAddress = (chain: Chain, a: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].address}/${a}`;
