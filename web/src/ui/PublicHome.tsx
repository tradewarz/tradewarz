// The front door, open to everyone: the live scanner, the leaderboard and the Guide, no account
// needed. Trading is what the token unlocks - buying, bots, positions - so a visitor sees exactly
// the product, judged by the Balanced preset, and the sign-in is the step that turns it on.
// A signed-in account that does not hold the gate lands here too, with the gate screen on top.

import { useEffect, useState } from 'preact/hooks';
import { CHAINS, preset, type HubInfo, type SessionUser, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { Guide, REPO_URL, type GuideSection } from './Guide.jsx';
import { CHAIN_LABEL, copyText, short } from './helpers.js';
import { Leaderboard } from './Leaderboard.jsx';
import { ponsUrl, pumpFunUrl } from './links.js';
import { Welcome } from './Onboarding.jsx';
import { SignInButtons } from './SignIn.jsx';
import { Terminal } from './Terminal.jsx';
import { toast } from './toast.js';

type PublicTab = 'scanner' | 'board' | 'guide';

/** Every chain judged by its Balanced preset, so a visitor sees verdicts without an account. */
const previewStrategies = (): StrategyRecord[] => {
  const now = Date.now();
  return CHAINS.map((c) => ({ id: `preview:${c}`, chain: c, strategy: preset('balanced', c), active: false, createdAt: now, updatedAt: now }));
};

export function PublicHome({ info, me, onSignedIn, onGuide, guideSection, onSignOut, onManage }: {
  info: HubInfo; me: SessionUser | null; onSignedIn: (me: SessionUser) => void; onGuide: () => void; guideSection: GuideSection | null; onSignOut?: () => void;
  /** Set when this browser holds a bot wallet: lets a person behind a closed gate in to sell and withdraw what they already hold. */
  onManage?: () => void;
}) {
  const [tab, setTab] = useState<PublicTab>(guideSection ? 'guide' : 'scanner');
  // The header's Guide link (and #guide links) open the Guide tab here.
  useEffect(() => { if (guideSection) setTab('guide'); }, [guideSection]);
  const [preview] = useState(previewStrategies);
  const signIn = () => { document.querySelector('.hero.welcome, .gate-screen')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <div class="public-home">
      {me ? <GateScreen info={info} me={me} onChange={onSignedIn} onSignOut={onSignOut} onManage={onManage} /> : <Welcome info={info} onSignedIn={onSignedIn} onGuide={onGuide} teaser={false} />}
      <div class="dash-shell wide public">
        <div class="dash-tabs" role="tablist">
          {(['scanner', 'board', 'guide'] as PublicTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} class={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t === 'scanner' ? 'Live scanner' : t === 'board' ? 'Leaderboard' : 'Guide'}</button>
          ))}
          <span class="spacer" />
          <span class="muted small statusline">{me ? 'view only until a linked wallet holds the gate' : 'view only — sign in to trade'}</span>
        </div>
        {tab === 'scanner' && <Terminal strategies={preview} onSaved={() => undefined} readOnly onSignIn={signIn} />}
        {tab === 'board' && <Leaderboard chains={info.chains} />}
        {tab === 'guide' && <Guide section={guideSection} />}
      </div>
    </div>
  );
}

/** Signed in, but no linked wallet holds the gate yet: balances, the way in, and where the token lives. */
export function GateScreen({ info, me, onChange, onSignOut, onManage }: { info: HubInfo; me: SessionUser; onChange: (me: SessionUser) => void; onSignOut?: () => void; onManage?: () => void }) {
  const [busy, setBusy] = useState(false);
  const gates = me.wallets.filter((w) => w.role === 'gate');
  const missing = (['solana', 'robinhood'] as const).filter((c) => !gates.some((w) => w.chain === c));
  const need = info.gateRequired.toLocaleString('en-US');
  const recheck = async () => {
    setBusy(true);
    try { const r = await api.refreshGate(); onChange(r.me); toast(r.me.gate.passed ? 'You are in' : 'Still under the gate'); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  const tokens = Object.entries(info.tokens).filter(([, a]) => !!a) as Array<[keyof typeof info.tokens, string]>;
  return (
    <section class="screen gate-screen">
      <div class="card">
        <h1>{info.gateMode === 'closed' ? 'Trading opens when TRADEWARZ launches' : `Hold ${need} TRADEWARZ to enter`}</h1>
        <p class="big">{info.gateMode === 'closed'
          ? `You're signed in. Trading — bots, buying, positions — is switched off on this hub until the TRADEWARZ token exists; once it does, holding ${need} in a linked wallet lets you in. Until then everything below is yours to watch.`
          : `You're signed in. Trading — bots, buying, positions — unlocks once one of your linked wallets holds ${need} TRADEWARZ. Until then everything below is yours to watch.`}</p>
        <div class="rows">
          {gates.map((w) => {
            const b = me.gate.balances.find((x) => x.address === w.address);
            return (
              <div class="row" key={w.chain + w.address}>
                <div class="k">{CHAIN_LABEL[w.chain]}</div>
                <div class="v"><span class="addr">{short(w.address, 6)}</span> <span class={`muted small ${b && b.balance !== null && b.balance >= info.gateRequired ? 'gain' : ''}`}>· {b ? (b.balance === null ? (b.error ? 'balance unavailable' : 'not checked') : `${Math.floor(b.balance).toLocaleString('en-US')} TRADEWARZ`) : 'no TRADEWARZ contract on this chain yet'}</span></div>
              </div>
            );
          })}
          {missing.length > 0 && (
            <div class="row"><div class="k">Also link</div><div class="v"><SignInButtons compact linking only={missing} onSignedIn={onChange} /><div class="muted small" style="margin-top:6px">TRADEWARZ held in a {missing.map((c) => CHAIN_LABEL[c]).join(' or ')} wallet counts too.</div></div></div>
          )}
          <div class="row"><div class="k">Get TRADEWARZ</div><div class="v">
            {tokens.length === 0 ? <span class="muted">The token has not launched yet — the contract address will appear here, and nowhere else. Anything claiming to be TRADEWARZ before that is not.</span> : tokens.map(([chain, address]) => (
              <div key={chain} class="small" style="margin-bottom:4px"><b>{CHAIN_LABEL[chain]}</b> <span class="addr mono">{address}</span> <a href="#" onClick={async (e) => { e.preventDefault(); toast((await copyText(address)) ? 'Address copied' : 'Copy blocked'); }}>copy</a>
                {' · '}<a href={chain === 'solana' ? pumpFunUrl(address) : ponsUrl(address)} target="_blank" rel="noopener noreferrer">{chain === 'solana' ? 'pump.fun' : 'pons'}</a></div>
            ))}
          </div></div>
        </div>
        <div class="btnrow" style="margin-top:14px">
          <button class="btn primary" disabled={busy} onClick={() => void recheck()}>{busy ? 'Checking…' : 'Check again'}</button>
          {onManage && <button class="btn" onClick={onManage} title="This browser has a bot wallet: open it to sell what it holds and withdraw. Nothing new can be bought while the gate is closed.">Manage what you already hold</button>}
          {onSignOut && <button class="btn" onClick={onSignOut}>Sign out</button>}
          <span class="muted small">{me.gate.reason}</span>
        </div>
        <p class="muted small" style="margin-top:10px">The token is access to this site, nothing more. The code that reads these balances is public: <a href={REPO_URL} target="_blank" rel="noopener noreferrer">github.com/tradewarz/tradewarz</a>.</p>
      </div>
    </section>
  );
}
