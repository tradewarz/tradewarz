// Where a token, pair or transaction opens when you click it. DexScreener first (its slug for
// Robinhood Chain is "robinhood"; pons v4 pools show up there once a launch has a pool), the
// chain's explorer as the fallback for anything DexScreener has not indexed yet.

import { DEXSCREENER_SLUG, EXPLORER, type Chain } from '@tradewarz/shared';

export const dexscreenerUrl = (chain: Chain, address: string): string => `https://dexscreener.com/${DEXSCREENER_SLUG[chain]}/${address}`;
export const explorerTokenUrl = (chain: Chain, address: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].token}/${address}`;
export const explorerAddressUrl = (chain: Chain, address: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].address}/${address}`;
export const explorerTxUrl = (chain: Chain, tx: string): string => `${EXPLORER[chain].base}/${EXPLORER[chain].tx}/${tx}`;
/** The pons launchpad's own page for a Robinhood Chain token - where it launched and where its creator and first buyers look. */
export const ponsUrl = (token: string): string => `https://www.ponsfamily.com/launchpad/${token}`;
/** pump.fun's own page for a Solana mint. */
export const pumpFunUrl = (mint: string): string => `https://pump.fun/coin/${mint}`;
