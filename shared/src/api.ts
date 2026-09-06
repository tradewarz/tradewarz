// Request and response shapes between the browser and the hub. Kept here so both sides
// compile against the same truth.

import type { AuthPurpose } from './auth.js';
import type { Chain, Strategy } from './strategy.js';

export interface NonceRequest { chain: Chain; address: string; purpose: AuthPurpose }
export interface NonceResponse { nonce: string; message: string; expiresAt: string }
/** signature: base58 for Solana (ed25519 over the UTF-8 message), 0x-hex for EVM (EIP-191 personal_sign). */
export interface VerifyRequest { nonce: string; signature: string }

export type WalletRole = 'gate' | 'bot';
export interface LinkedWallet { chain: Chain; address: string; role: WalletRole; linkedAt: number }

export interface GateBalance { chain: Chain; address: string; balance: number | null; required: number; error?: string }
export interface GateStatus {
  /** 'open' = no token configured yet (development), everyone passes and the page says so. */
  mode: 'open' | 'token';
  passed: boolean;
  checkedAt: number | null;
  balances: GateBalance[];
  reason?: string;
}

export interface SessionUser {
  id: string;
  createdAt: number;
  wallets: LinkedWallet[];
  gate: GateStatus;
  /** True only for the accounts named in TW_OWNER_WALLETS: shows the review console. */
  owner: boolean;
  /** The name shown on the leaderboard; empty means the shortened bot wallet is used. */
  handle: string;
}

export interface StrategyRecord {
  id: string;
  chain: Chain;
  strategy: Strategy;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiError { error: string; code?: string; problems?: string[] }

export interface HubInfo {
  name: 'tradewarz';
  version: string;
  gateMode: 'open' | 'token';
  gateRequired: number;
  chains: Chain[];
  domain: string;
  /** Public RPC endpoints the page may use for balances; the hub proxies anything with a key. */
  rpc: Record<Chain, string>;
  tokens: Partial<Record<Chain, string>>;
  now: number;
}
