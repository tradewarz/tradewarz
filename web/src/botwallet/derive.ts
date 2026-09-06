// One backup phrase, two bot keys. Standard derivation so the phrase also restores in
// Phantom (m/44'/501'/0'/0') and MetaMask (m/44'/60'/0'/0/0) if someone ever needs to
// get their funds out without this site.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { Keypair } from '@solana/web3.js';
import { mnemonicToAccount, type HDAccount } from 'viem/accounts';

export interface DerivedKeys {
  solana: Keypair;
  evm: HDAccount;
  addresses: { solana: string; robinhood: string };
}

export function newMnemonic(): string {
  return generateMnemonic(wordlist, 128); // 12 words
}

export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(m.trim().toLowerCase().split(/\s+/).join(' '), wordlist);
}

// SLIP-0010 ed25519 derivation (hardened steps only), the way Phantom derives Solana keys.
function slip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  for (const index of path) {
    const hardened = (index | 0x80000000) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, hardened, false);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

export function deriveKeys(mnemonic: string): DerivedKeys {
  const clean = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
  const seed = mnemonicToSeedSync(clean);
  const solSeed = slip10Ed25519(seed, [44, 501, 0, 0]);
  const solana = Keypair.fromSeed(solSeed);
  const evm = mnemonicToAccount(clean); // m/44'/60'/0'/0/0
  return { solana, evm, addresses: { solana: solana.publicKey.toBase58(), robinhood: evm.address } };
}
