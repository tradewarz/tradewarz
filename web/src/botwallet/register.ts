// Register the unlocked bot wallets with the hub (one signed message per chain). Runs
// right after the wallet is created or unlocked so "switch on" works from any screen.

import { CHAINS, type Chain, type SessionUser } from '@tradewarz/shared';
import { api } from '../api.js';
import { botAddress, isUnlocked, signWithBot } from './wallet.js';

let inFlight: Promise<SessionUser | null> | null = null;

export function needsRegistration(me: SessionUser, chain: Chain): boolean {
  const address = botAddress(chain);
  if (!address) return false;
  return !me.wallets.some((w) => w.role === 'bot' && w.chain === chain && w.address.toLowerCase() === address.toLowerCase());
}

/** Registers whatever is missing; resolves to the refreshed account, or null when nothing changed. */
export function registerBotWallets(me: SessionUser): Promise<SessionUser | null> {
  if (!isUnlocked()) return Promise.resolve(null);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let latest: SessionUser | null = null;
    for (const chain of CHAINS) {
      if (!needsRegistration(latest ?? me, chain)) continue;
      const address = botAddress(chain)!;
      try {
        const { nonce, message } = await api.nonce({ chain, address, purpose: 'register-bot-wallet' });
        const signature = await signWithBot(chain, message);
        latest = (await api.verify(nonce, signature)).me;
      } catch (e) {
        console.warn(`[tradewarz] could not register the ${chain} bot wallet:`, e);
      }
    }
    return latest;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
