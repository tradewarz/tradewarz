// The sign-in message. Human-readable on purpose: it is what Phantom and MetaMask show
// the person before they sign. Signing it moves no funds and grants no permission; it
// only proves the person controls the wallet. The hub builds it, the wallet signs it,
// the hub verifies the signature against the exact same text.

import type { Chain } from './strategy.js';

export const AUTH_PURPOSES = ['sign-in', 'register-bot-wallet'] as const;
export type AuthPurpose = (typeof AUTH_PURPOSES)[number];

export interface SignInFields {
  domain: string;
  chain: Chain;
  address: string;
  purpose: AuthPurpose;
  nonce: string;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
}

export function buildSignInMessage(f: SignInFields): string {
  const what = f.purpose === 'sign-in' ? 'wants you to sign in with this wallet.' : 'is registering this bot wallet to your account.';
  return [
    `TradeWarz ${what}`,
    '',
    `Wallet: ${f.address}`,
    `Chain: ${f.chain === 'solana' ? 'Solana' : 'Robinhood Chain'}`,
    `Purpose: ${f.purpose}`,
    `Nonce: ${f.nonce}`,
    `Issued at: ${f.issuedAt}`,
    `Expires: ${f.expiresAt}`,
    `Domain: ${f.domain}`,
    '',
    'This request does not move funds or grant any permission.',
  ].join('\n');
}

export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddressForChain(chain: Chain, address: string): boolean {
  return chain === 'solana' ? SOLANA_ADDRESS_RE.test(address) : EVM_ADDRESS_RE.test(address);
}

/** Addresses compare case-insensitively on EVM and exactly on Solana. */
export function normalizeAddress(chain: Chain, address: string): string {
  return chain === 'solana' ? address : address.toLowerCase();
}
