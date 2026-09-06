// Phantom (and any wallet that speaks the same window.solana interface: Solflare,
// Backpack). Used for two things only: signing the sign-in message and sending a
// deposit to the bot wallet. It never sees the bot key.

import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

interface SolanaProvider {
  isPhantom?: boolean;
  publicKey: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction(tx: Transaction, opts?: { skipPreflight?: boolean }): Promise<{ signature: string }>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
}

export function solanaProvider(): SolanaProvider | null {
  const w = window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider; solflare?: SolanaProvider; backpack?: SolanaProvider };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? w.backpack ?? null;
}

export async function connectSolana(): Promise<string> {
  const p = solanaProvider();
  if (!p) throw new Error('No Solana wallet found. Install Phantom, then reload this page.');
  const r = await p.connect();
  return r.publicKey.toBase58();
}

/** Sign the hub's message; returns base58 (what the hub expects). */
export async function signSolanaMessage(message: string): Promise<string> {
  const p = solanaProvider();
  if (!p) throw new Error('No Solana wallet found.');
  const out = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  const sig = out instanceof Uint8Array ? out : out.signature;
  return bs58.encode(sig);
}

/** Deposit from the connected Phantom account into the bot wallet. Phantom signs and sends. */
export async function depositSolFromPhantom(rpcUrl: string, from: string, to: string, sol: number): Promise<string> {
  const p = solanaProvider();
  if (!p) throw new Error('No Solana wallet found.');
  if (!p.publicKey || p.publicKey.toBase58() !== from) await p.connect();
  const conn = new Connection(rpcUrl, 'confirmed');
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(from), blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }),
  );
  const { signature } = await p.signAndSendTransaction(tx);
  return signature;
}
