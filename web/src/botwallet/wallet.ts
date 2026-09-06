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

/** Withdraw from the bot wallet to `to` (the page only ever passes a linked gate wallet). "all" leaves a fee reserve. */
export async function withdraw(chain: Chain, to: string, amount: number | 'all', rpcUrl: string): Promise<{ hash: string; amount: number }> {
  if (!keys) throw new Error('Unlock the bot wallet first.');
  if (chain === 'solana') {
    const conn = new Connection(rpcUrl, 'confirmed');
    const from = keys.solana.publicKey;
    const balance = await conn.getBalance(from, 'confirmed');
    const reserve = 0.002 * LAMPORTS_PER_SOL; // fee + rent headroom
    const lamports = amount === 'all' ? balance - reserve : Math.round(amount * LAMPORTS_PER_SOL);
    if (lamports <= 0) throw new Error('Nothing to withdraw after the fee reserve.');
    if (lamports > balance - reserve) throw new Error(`At most ${((balance - reserve) / LAMPORTS_PER_SOL).toFixed(4)} SOL can leave (a small fee reserve stays).`);
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
  const balance = await pub.getBalance({ address: keys.evm.address });
  const gasPrice = await pub.getGasPrice();
  const gasWei = 21_000n * gasPrice * 2n;
  const reserve = parseEther('0.0005');
  const value = amount === 'all' ? balance - gasWei - reserve : parseEther(String(amount));
  if (value <= 0n) throw new Error('Nothing to withdraw after gas.');
  if (value > balance - gasWei) throw new Error(`At most ${formatEther(balance - gasWei - reserve)} ${symbol} can leave (gas stays behind).`);
  const hash = await wallet.sendTransaction({ to: to as `0x${string}`, value, gas: 21_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('The transaction reverted on-chain.');
  return { hash, amount: Number(formatEther(value)) };
}

export const explorerTx = (chain: Chain, hash: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].tx}/${hash}`;
export const explorerAddress = (chain: Chain, a: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].address}/${a}`;
