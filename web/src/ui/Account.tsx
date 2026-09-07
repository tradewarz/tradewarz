import { useState } from 'preact/hooks';
import type { HubInfo, SessionUser } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { SignInButtons } from './SignIn.jsx';
import { toast } from './toast.js';
import { CHAIN_LABEL, copyText, short } from './helpers.js';

export function Account({ me, info, onChange, onSignOut }: { me: SessionUser; info: HubInfo; onChange: (me: SessionUser) => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const gates = me.wallets.filter((w) => w.role === 'gate');
  // Sign-in (gate) wallets are one per key: Phantom for Solana, MetaMask for every EVM chain (one address covers them all).
  const missing = (['solana', 'robinhood'] as const).filter((c) => !gates.some((w) => w.chain === c));
  const g = me.gate;

  const refresh = async () => {
    setBusy(true);
    try { onChange((await api.refreshGate()).me); toast('Gate re-checked'); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  const signOut = async () => {
    try { await api.logout(); } catch { /* the cookie is gone either way */ }
    onSignOut();
  };

  return (
    <section class="card">
      <h2>
        Your account
        <span class={`pill ${g.passed ? 'ok' : 'bad'}`}>{g.mode === 'open' ? 'gate open (setup)' : g.passed ? `holds ${info.gateRequired.toLocaleString('en-US')}+ TRADEWARZ` : 'gate closed'}</span>
      </h2>
      <p class="lede">The wallets you sign in with prove you hold TRADEWARZ. They never trade; the bot wallet below does.</p>
      <div class="rows">
        {gates.map((w) => (
          <div class="row" key={w.chain + w.address}>
            <div class="k">{CHAIN_LABEL[w.chain]}</div>
            <div class="v"><span class="addr" title={w.address}>{short(w.address, 6)}</span>{' '}
              {g.balances.filter((b) => b.address === w.address).map((b) => (
                <span class="muted small" key={b.address}> · {b.balance === null ? (b.error ? 'balance unavailable' : 'not checked') : `${Math.floor(b.balance).toLocaleString('en-US')} TRADEWARZ`}</span>
              ))}
            </div>
          </div>
        ))}
        {missing.length > 0 && (
          <div class="row">
            <div class="k">Also link</div>
            <div class="v">
              <SignInButtons compact linking only={missing} onSignedIn={onChange} />
              <div class="muted small" style="margin-top:6px">One wallet per chain. Linking {missing.map((c) => CHAIN_LABEL[c]).join(' and ')} lets the gate count TRADEWARZ held there too.</div>
            </div>
          </div>
        )}
      </div>
      {g.mode === 'open' ? (
        <div class="notice" style="margin-top:12px">{g.reason}</div>
      ) : !g.passed ? (
        <div class="notice bad" style="margin-top:12px">{g.reason}</div>
      ) : null}
      <div class="btnrow" style="margin-top:14px">
        <button class="btn sm" disabled={busy} onClick={refresh}>{busy ? 'Checking…' : 'Re-check the gate'}</button>
        <span class="muted small">{g.checkedAt ? `checked ${new Date(g.checkedAt).toLocaleTimeString()}` : ''}</span>
        <span class="spacer" />
        <button class="btn sm" onClick={signOut}>Sign out</button>
      </div>
      <HandleField me={me} onChange={onChange} />
      <DeviceCode />
    </section>
  );
}

/** A one-time code that signs another device into this account: a phone, or a computer without wallet extensions. */
function DeviceCode() {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { setCode(await api.handoff()); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  const pretty = code ? `${code.code.slice(0, 4)}-${code.code.slice(4)}` : '';
  const link = code ? `${location.origin}/#link/${code.code}` : '';
  const left = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 60_000)) : 0;
  return (
    <div class="field" style="margin-top:18px; padding-top:14px; border-top:1px solid var(--line)">
      <label>Use it on another device</label>
      <div class="muted small">Phones have no wallet extensions, so a phone cannot sign in with Phantom or MetaMask. Make a code here, type it (or open the link) on the other device, and it is signed into this account — for watching, the Terminal, the board and the coach. To trade there too it would need your bot wallet restored from the 12 words.</div>
      <div class="inline" style="margin-top:8px">
        <button class="btn" disabled={busy} onClick={() => void make()}>{busy ? 'Making…' : code ? 'Make a new code' : 'Make a code'}</button>
        {code && (<>
          <span class="mono" style="font-size:20px; letter-spacing:.12em">{pretty}</span>
          <button class="btn sm" onClick={async () => { toast((await copyText(link)) ? 'Link copied' : 'Copy blocked'); }}>Copy link</button>
        </>)}
      </div>
      {code && <div class="muted small" style="margin-top:6px">Works once, for about {left} more minute{left === 1 ? '' : 's'}. Anyone with the code can sign into your account until then — read it out, don't post it.</div>}
    </div>
  );
}

/** The name the leaderboard shows. Without one it shows a shortened bot wallet. */
function HandleField({ me, onChange }: { me: SessionUser; onChange: (me: SessionUser) => void }) {
  const [handle, setHandle] = useState(me.handle);
  const [busy, setBusy] = useState(false);
  const dirty = handle.trim() !== me.handle;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.setHandle(handle.trim());
      onChange({ ...me, handle: r.handle });
      toast(`You'll appear on the board as ${r.handle}`);
    } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <div class="field" style="margin-top:18px; padding-top:14px; border-top:1px solid var(--line)">
      <label>Your name on the leaderboard</label>
      <div class="inline">
        <input class="input" value={handle} maxLength={20} placeholder={me.handle || 'shown as your bot wallet until you pick one'} onInput={(e) => setHandle((e.target as HTMLInputElement).value)} />
        <button class="btn" disabled={busy || !dirty || handle.trim().length < 2} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <div class="muted small">2–20 characters: letters, numbers, spaces, dot, dash, underscore. Your bot wallet is shown next to it either way.</div>
    </div>
  );
}
