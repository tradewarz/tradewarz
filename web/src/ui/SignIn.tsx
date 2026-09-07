import { useState } from 'preact/hooks';
import type { Chain, SessionUser } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { connectEvm, evmProvider, signEvmMessage } from '../wallets/metamask.js';
import { connectSolana, signSolanaMessage, solanaProvider } from '../wallets/phantom.js';
import { isMobile, metamaskBrowseUrl, phantomBrowseUrl } from '../wallets/mobile.js';
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

/** A one-time code made on a signed-in device signs this one in; the hub checks and burns it. */
export async function signInWithCode(code: string): Promise<SessionUser> {
  const out = await api.claimHandoff(code.replace(/[^a-z0-9]/gi, '').toUpperCase());
  return out.me;
}

export function SignInButtons({ onSignedIn, compact = false, linking = false, only }: { onSignedIn: (me: SessionUser) => void; compact?: boolean; linking?: boolean; only?: Chain[] }) {
  const show = (c: Chain) => !only || only.includes(c);
  const [busy, setBusy] = useState<Chain | null>(null);
  // On a phone nothing injects a wallet: offer the wallet apps' own browsers (which do) and the device code instead.
  const mobile = isMobile();
  const hasSol = !!solanaProvider(), hasEvm = !!evmProvider();
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
  const openIn = mobile && !linking;
  return (
    <div class="signin">
      <div class="btnrow">
        {show('solana') && (!mobile || hasSol
          ? <button class={`btn ${compact ? 'sm' : 'primary'}`} disabled={busy !== null} onClick={() => go('solana')}>{busy === 'solana' ? 'Waiting for Phantom…' : linking ? 'Link Phantom' : 'Sign in with Phantom'}</button>
          : openIn ? <a class={`btn ${compact ? 'sm' : 'primary'}`} href={phantomBrowseUrl()}>Open in the Phantom app</a> : null)}
        {show('robinhood') && (!mobile || hasEvm
          ? <button class={`btn ${compact ? 'sm' : 'ghost'}`} disabled={busy !== null} onClick={() => go('robinhood')}>{busy === 'robinhood' ? 'Waiting for MetaMask…' : linking ? 'Link MetaMask' : 'Sign in with MetaMask'}</button>
          : openIn ? <a class={`btn ${compact ? 'sm' : 'ghost'}`} href={metamaskBrowseUrl()}>Open in the MetaMask app</a> : null)}
      </div>
      {mobile && !hasSol && !hasEvm && (linking
        ? <div class="muted small" style="margin-top:6px">Wallets do not plug into a phone's browser. Link the other wallet from a computer, or open this page inside the wallet app.</div>
        : <div class="muted small" style="margin-top:6px">Wallets do not plug into a phone's browser the way they do on a computer, so this page opens inside your wallet app instead — sign in there as usual. Or enter a code from a computer that is already signed in.</div>)}
      {!linking && <CodeEntry onSignedIn={onSignedIn} open={mobile && !hasSol && !hasEvm} />}
    </div>
  );
}

/** "Have a code from another device?" — the Account tab on a signed-in device makes one. */
export function CodeEntry({ onSignedIn, open: openAtStart = false }: { onSignedIn: (me: SessionUser) => void; open?: boolean }) {
  const [open, setOpen] = useState(openAtStart);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (code.replace(/[^a-z0-9]/gi, '').length < 6) return;
    setBusy(true);
    try { onSignedIn(await signInWithCode(code)); toast('Signed in on this device'); }
    catch (err) { toast(describeError(err), 'bad'); } finally { setBusy(false); }
  };
  if (!open) return <p class="muted small" style="margin-top:8px"><a href="#" onClick={(e) => { e.preventDefault(); setOpen(true); }}>Have a code from another device?</a></p>;
  return (
    <form class="code-entry" onSubmit={(e) => { void submit(e); }}>
      <input class="input mono" placeholder="XXXX-XXXX" autocapitalize="characters" autocomplete="one-time-code" maxLength={12} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
      <button class="btn" type="submit" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 6}>{busy ? 'Checking…' : 'Sign in with the code'}</button>
      <div class="muted small">Made in the Account tab on a device that is signed in (Account → "Use it on another device"). Codes last five minutes and work once.</div>
    </form>
  );
}
