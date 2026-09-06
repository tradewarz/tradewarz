// MetaMask (EIP-1193). Sign-in message and deposits to the bot wallet on any EVM chain we trade.

import { parseEther, toHex } from 'viem';
import type { Chain } from '@tradewarz/shared';

interface Eip1193 {
  isMetaMask?: boolean;
  providers?: Eip1193[];
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
}

export interface EvmChainInfo { id: number; hex: string; name: string; rpc: string; explorer: string; symbol: string; currency: string }

/** What MetaMask needs to know about each EVM chain we trade (wallet_addEthereumChain parameters). */
export const EVM_CHAINS: Record<Exclude<Chain, 'solana'>, EvmChainInfo> = {
  robinhood: { id: 4663, hex: '0x1237', name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', symbol: 'ETH', currency: 'Ether' },
  base: { id: 8453, hex: '0x2105', name: 'Base', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', symbol: 'ETH', currency: 'Ether' },
  bsc: { id: 56, hex: '0x38', name: 'BNB Smart Chain', rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', symbol: 'BNB', currency: 'BNB' },
};
export const ROBINHOOD_CHAIN = EVM_CHAINS.robinhood;
export type EvmChain = keyof typeof EVM_CHAINS;

export function evmProvider(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193 };
  const p = w.ethereum;
  if (!p) return null;
  if (Array.isArray(p.providers) && p.providers.length) return p.providers.find((x) => x.isMetaMask) ?? p.providers[0] ?? null;
  return p;
}

export async function connectEvm(): Promise<string> {
  const p = evmProvider();
  if (!p) throw new Error('No EVM wallet found. Install MetaMask, then reload this page.');
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  const a = accounts[0];
  if (!a) throw new Error('No account selected in the wallet.');
  return a;
}

export async function signEvmMessage(address: string, message: string): Promise<string> {
  const p = evmProvider();
  if (!p) throw new Error('No EVM wallet found.');
  return (await p.request({ method: 'personal_sign', params: [toHex(new TextEncoder().encode(message)), address] })) as string;
}

/** Switch MetaMask to the given chain, adding it when the wallet does not know it yet. */
export async function ensureEvmChain(chain: EvmChain, rpcUrl?: string): Promise<void> {
  const p = evmProvider();
  if (!p) throw new Error('No EVM wallet found.');
  const c = EVM_CHAINS[chain];
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: c.hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 4902 || /unrecognized|not been added|4902/i.test(String((e as Error).message))) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: c.hex, chainName: c.name, nativeCurrency: { name: c.currency, symbol: c.symbol, decimals: 18 }, rpcUrls: [rpcUrl ?? c.rpc], blockExplorerUrls: [c.explorer] }],
      });
    } else throw e;
  }
}
export const ensureRobinhoodChain = (rpcUrl?: string): Promise<void> => ensureEvmChain('robinhood', rpcUrl);

/** Deposit the chain's native coin from MetaMask into the bot wallet. MetaMask signs and sends; returns the tx hash. */
export async function depositFromMetaMask(chain: EvmChain, from: string, to: string, amount: string, rpcUrl?: string): Promise<string> {
  const p = evmProvider();
  if (!p) throw new Error('No EVM wallet found.');
  await ensureEvmChain(chain, rpcUrl);
  const value = toHex(parseEther(amount));
  return (await p.request({ method: 'eth_sendTransaction', params: [{ from, to, value }] })) as string;
}
export const depositEthFromMetaMask = (from: string, to: string, eth: string, rpcUrl?: string): Promise<string> => depositFromMetaMask('robinhood', from, to, eth, rpcUrl);
