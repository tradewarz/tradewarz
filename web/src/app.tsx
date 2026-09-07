import { useEffect, useState } from 'preact/hooks';
import type { HubInfo, SessionUser, StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from './api.js';
import { registerBotWallets } from './botwallet/register.js';
import { destroyVault, loadVault, type VaultBlob } from './botwallet/vault.js';
import { isUnlocked, lock, onWalletChange, setWithdrawTargets } from './botwallet/wallet.js';
import { Boundary } from './ui/Boundary.jsx';
import { Dashboard } from './ui/Dashboard.jsx';
import { CreateWallet, PickBot, RestoreWallet, SaveWords, UnlockScreen, Welcome } from './ui/Onboarding.jsx';
import { Guide, guideFromHash, openGuide, TG_CHANNEL_URL, TG_CHAT_URL, X_URL, type GuideSection } from './ui/Guide.jsx';
import { Privacy, privacyFromHash } from './ui/Privacy.jsx';
import { PublicHome } from './ui/PublicHome.jsx';
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from './ui/install.js';
import { hubStream } from './engine/stream.js';
import { REPO_URL } from './ui/Guide.jsx';
import type { HubControl } from '@tradewarz/shared';

/** The owner's notice and pause, shown on every screen; follows the heartbeat once the stream is up. */
function ControlBanner({ initial }: { initial: HubControl | undefined }) {
  const [c, setC] = useState<HubControl>(initial ?? { paused: false, notice: '' });
  useEffect(() => { if (initial) setC(initial); }, [initial?.paused, initial?.notice]);
  // The stream is what carries a pause to an open tab; start it here so every screen hears it, not just the dashboard.
  useEffect(() => { hubStream.start(); return hubStream.on((m) => { if ((m.kind === 'tick' || m.kind === 'hello') && m.control) setC(m.control); }); }, []);
  if (!c.paused && !c.notice) return null;
  return (
    <div class={`notice ${c.paused ? 'bad' : 'warn'} control-banner`}>
      {c.paused && <b>Buying is paused on the hub. </b>}{c.paused && !c.notice && 'Bots are not entering and Buy is off everywhere; positions stay priced, and selling and withdrawing work as normal. '}
      {c.notice}
    </div>
  );
}
import { toast } from './ui/toast.js';

/** "Install app" while the browser offers it (or, on iOS, a pointer to the Guide); nothing once installed. */
function InstallLink({ onGuide }: { onGuide: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);
  if (isStandalone()) return null;
  const prompt = canPromptInstall();
  if (!prompt && !isIOS()) return null;
  const click = async (e: Event) => {
    e.preventDefault();
    if (!prompt) { onGuide(); return; }
    const r = await promptInstall();
    if (r === 'accepted') toast('TradeWarz is installed. It opens in its own window from now on.');
  };
  return <a class="head-link" href="#guide/app" title="Use TradeWarz as an app" onClick={(e) => { void click(e); }}>Install app</a>;
}

/**
 * One path, in order: sign in → create (or unlock) the bot wallet → save the 12 words →
 * pick a bot → dashboard. Each screen shows only what that step needs.
 */
export function App() {
  const [info, setInfo] = useState<HubInfo | null>(null);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [hub, setHub] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [vault, setVault] = useState<VaultBlob | null | undefined>(undefined);
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const [restoring, setRestoring] = useState(false);
  const [strategies, setStrategies] = useState<StrategyRecord[] | null>(null);
  const [skippedPick, setSkippedPick] = useState(false);
  const [registering, setRegistering] = useState(false);
  // The Guide for people who have not signed in: opened from the header, the welcome screen, or a #guide link.
  const [guide, setGuide] = useState<GuideSection | null>(() => guideFromHash());
  // Privacy notice from the footer / #privacy — shown without unmounting the dashboard (bots keep running).
  const [privacy, setPrivacy] = useState(() => privacyFromHash());
  useEffect(() => {
    const onHash = () => { setGuide(guideFromHash()); setPrivacy(privacyFromHash()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Behind a closed gate with a bot wallet on this device: in to sell and withdraw, not to buy.
  const [windDown, setWindDown] = useState(false);
  // The dashboard (with its own Guide tab) is on screen only once every step before it is done.
  const throughGate = !!me && (info?.gateMode === 'open' || me.gate.passed);
  const dashboardMounted = hub === 'ready' && (throughGate || windDown) && !!vault && unlocked && !!vault.backedUp && strategies !== null && !registering && (strategies.length > 0 || skippedPick);
  const showGuide = (section: GuideSection = 'what') => {
    if (privacy) setPrivacy(false);
    if (dashboardMounted) { openGuide(section); return; } // the dashboard has a Guide tab
    setGuide(section);
    history.replaceState(null, '', section === 'what' ? '#guide' : `#guide/${section}`);
  };
  const closeGuide = () => { setGuide(null); history.replaceState(null, '', '/'); };
  const showPrivacy = () => {
    setPrivacy(true);
    history.replaceState(null, '', '#privacy');
  };
  const closePrivacy = () => { setPrivacy(false); history.replaceState(null, '', '/'); };

  useEffect(() => {
    (async () => {
      try {
        const [i, m, v] = await Promise.all([api.info(), api.me(), loadVault()]);
        let who = m.me;
        // Opened from a "use it on another device" link: the code in the hash signs this device in.
        const link = /^#link\/([A-Za-z0-9-]{6,24})$/.exec(window.location.hash);
        if (link) {
          history.replaceState(null, '', '/');
          if (!who) { try { who = (await api.claimHandoff(link[1]!)).me; toast('Signed in on this device'); } catch (e) { toast(describeError(e), 'bad'); } }
        }
        setInfo(i); setMe(who); setVault(v); setHub('ready');
      } catch (e) { setHub('offline'); toast(describeError(e), 'bad'); }
    })();
    return onWalletChange(() => setUnlocked(isUnlocked()));
  }, []);

  // Withdrawals may only go to the sign-in wallets on the account; the wallet module checks this on every send.
  useEffect(() => { setWithdrawTargets((me?.wallets ?? []).filter((w) => w.role === 'gate').map((w) => w.address)); }, [me]);

  // Strategies follow the account.
  useEffect(() => {
    if (!me) { setStrategies(null); return; }
    let alive = true;
    api.strategies().then((r) => { if (alive) setStrategies(r.strategies); }).catch(() => { if (alive) setStrategies([]); });
    return () => { alive = false; };
  }, [me?.id]);

  // As soon as a backed-up wallet is unlocked, make sure the hub knows both bot addresses.
  useEffect(() => {
    if (!me || !unlocked || !vault?.backedUp) return;
    let alive = true;
    setRegistering(true);
    registerBotWallets(me).then((m) => { if (alive && m) setMe(m); }).finally(() => { if (alive) setRegistering(false); });
    return () => { alive = false; };
  }, [me?.id, unlocked, vault?.backedUp]);

  const signOut = async () => { try { await api.logout(); } catch { /* cookie gone either way */ } lock(); setMe(null); setSkippedPick(false); };
  const forgetWallet = async () => { await destroyVault(); lock(); setVault(null); setRestoring(false); toast('Wallet forgotten on this computer. Your funds are still on-chain under the 12 words.'); };

  let body;
  if (hub === 'loading' || (me && vault === undefined)) body = <p class="muted">Connecting…</p>;
  else if (hub === 'offline') body = <div class="notice bad">The hub is not answering. If you run it yourself: <code>npm run dev:hub</code>, then reload.</div>;
  else if (!me) body = <PublicHome info={info!} me={null} onSignedIn={setMe} onGuide={() => showGuide('what')} guideSection={guide} />;
  else if (!throughGate && !windDown) body = <PublicHome info={info!} me={me} onSignedIn={setMe} onGuide={() => showGuide('what')} guideSection={guide} onSignOut={signOut} onManage={vault ? () => setWindDown(true) : undefined} />;
  // Signed in but between steps (wallet locked, words not saved yet): the Guide still opens, on its own.
  else if (guide && !dashboardMounted) body = <Guide section={guide} onBack={closeGuide} />;
  else if (vault === null) body = restoring ? <RestoreWallet onDone={(v) => { setVault(v); setRestoring(false); }} onBack={() => setRestoring(false)} /> : <CreateWallet onDone={setVault} onRestore={() => setRestoring(true)} />;
  else if (!unlocked) body = <UnlockScreen vault={vault!} onDone={() => setUnlocked(true)} onForget={forgetWallet} />;
  else if (!vault!.backedUp) body = <SaveWords vault={vault!} onDone={setVault} />;
  else if (strategies === null || registering) body = <p class="muted">Preparing your wallets…</p>;
  else if (strategies.length === 0 && !skippedPick) {
    const gateChain = me.wallets.find((w) => w.role === 'gate')?.chain ?? 'solana';
    body = <PickBot me={me} defaultChain={gateChain} onDone={setStrategies} onSkip={() => setSkippedPick(true)} />;
  } else body = <Dashboard me={me} info={info!} vault={vault!} strategies={strategies} onMe={setMe} onStrategies={setStrategies} onLocked={() => setUnlocked(false)} onSignOut={signOut} tradingAllowed={throughGate} />;

  return (
    <>
      <header class="topbar">
        <div class="in">
          <a class="brand" href="/">
            <span class="mark" aria-hidden="true"><img src="/avatar.png?v=pixel5" alt="" width="76" height="76" /></span>
            <span class="wordmark">TradeWar<span class="warz">z</span></span>
          </a>
          <span class="spacer" />
          <a class="head-link" href="#guide" onClick={(e) => { e.preventDefault(); showGuide('what'); }}>Guide</a>
          <a class="head-link" href={TG_CHANNEL_URL} target="_blank" rel="noopener noreferrer">Telegram</a>
          <a class="head-link" href={X_URL} target="_blank" rel="noopener noreferrer">X</a>
          <InstallLink onGuide={() => showGuide('app')} />
          {info && <span class={`pill gate-pill ${info.gateMode === 'open' ? 'warn' : me?.gate.passed ? 'ok' : ''}`} title={me?.gate.reason ?? ''}>{info.gateMode === 'open' ? 'gate open · setup' : info.gateMode === 'closed' ? 'trading opens at token launch' : <><span>{info.gateRequired.toLocaleString('en-US')}</span> TRADEWARZ to enter</>}</span>}
          {me && <button class="btn sm signout" onClick={signOut}>Sign out</button>}
        </div>
      </header>
      <ControlBanner initial={info?.control} />
      <main>
        <div style={privacy ? 'display:none' : undefined} aria-hidden={privacy || undefined}>
          <Boundary>{body}</Boundary>
        </div>
        {privacy && <Boundary><Privacy onBack={closePrivacy} /></Boundary>}
      </main>
      <footer>TradeWarz is software you run yourself. It is not investment advice, and trading these markets can lose everything you put in. {info ? <>Hub v{info.version}{info.build ? <> · build <a href={`${REPO_URL}/commit/${info.build}`} target="_blank" rel="noopener noreferrer" title="the exact code this hub runs, on GitHub">{info.build.slice(0, 7)}</a></> : null}.</> : ''} · <a href="#privacy" onClick={(e) => { e.preventDefault(); showPrivacy(); }}>Privacy</a> · <a href={TG_CHANNEL_URL} target="_blank" rel="noopener noreferrer">Channel</a> · <a href={TG_CHAT_URL} target="_blank" rel="noopener noreferrer">Chat</a> · <a href={X_URL} target="_blank" rel="noopener noreferrer">X</a></footer>
    </>
  );
}
