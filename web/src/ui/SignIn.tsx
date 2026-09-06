import { useState } from 'preact/hooks';
import type { Chain, SessionUser } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { connectEvm, signEvmMessage } from '../wallets/metamask.js';
import { connectSolana, signSolanaMessage } from '../wallets/phantom.js';
import { toast } from './toast.js';
import { WALLET_APP } from './helpers.js';

/** Sign in (no session) or link another gate wallet (with a session). Same flow either way. */
export async function signInWith(chain: Chain): Promise<SessionUser> {
  const address = chain === 'solana' ? await connectSolana() : await connectEvm();
  const { nonce, message } = await api.nonce({ chain, address, purpose: 'sign-in' });
  const signature = chain === 'solana' ? await signSolanaMessage(message) : await signEvmMessage(address, message);
  const out = await api.verify(nonce, signature);
  return out.me;
}

export function SignInButtons({ onSignedIn, compact = false, linking = false, only }: { onSignedIn: (me: SessionUser) => void; compact?: boolean; linking?: boolean; only?: Chain[] }) {
  const show = (c: Chain) => !only || only.includes(c);
  const [busy, setBusy] = useState<Chain | null>(null);
  const go = async (chain: Chain) => {
    setBusy(chain);
    try {
      const me = await signInWith(chain);
      onSignedIn(me);
      toast(linking ? `${WALLET_APP[chain]} wallet linked` : 'Signed in');
    } catch (e) {
      toast(describeError(e), 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="btnrow">
      {show('solana') && <button class={`btn ${compact ? 'sm' : 'primary'}`} disabled={busy !== null} onClick={() => go('solana')}>
        {busy === 'solana' ? 'Waiting for Phantom…' : linking ? 'Link Phantom' : 'Sign in with Phantom'}
      </button>}
      {show('robinhood') && <button class={`btn ${compact ? 'sm' : 'ghost'}`} disabled={busy !== null} onClick={() => go('robinhood')}>
        {busy === 'robinhood' ? 'Waiting for MetaMask…' : linking ? 'Link MetaMask' : 'Sign in with MetaMask'}
      </button>}
    </div>
  );
}
