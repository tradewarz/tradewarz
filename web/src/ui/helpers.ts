import { CHAIN_NAME, NATIVE_SYMBOL, type Chain } from '@tradewarz/shared';

export const CHAIN_LABEL: Record<Chain, string> = CHAIN_NAME;
export const CHAIN_SHORT: Record<Chain, string> = { solana: 'SOL', robinhood: 'RH', base: 'BASE', bsc: 'BNB' };
export const NATIVE: Record<Chain, string> = NATIVE_SYMBOL;
/** The browser wallet that signs in and funds the bot on each chain. */
export const WALLET_APP: Record<Chain, string> = { solana: 'Phantom', robinhood: 'MetaMask', base: 'MetaMask', bsc: 'MetaMask' };

export const short = (a: string, n = 4): string => (a.length > 2 * n + 3 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a);
export const fmtAmount = (n: number | null, sym: string): string => (n === null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 5 : 4 })} ${sym}`);

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
