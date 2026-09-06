// The short path: sign in → create the bot wallet → save 12 words → pick a bot → dashboard.
// One decision per screen, one primary button, the smallest amount of text that is still honest.

import { useEffect, useState } from 'preact/hooks';
import { CHAINS, PRESET_NAMES, describeStrategy, preset, presetBlurb, type Chain, type HubInfo, type PresetName, type SessionUser, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { deriveKeys, isValidMnemonic, newMnemonic } from '../botwallet/derive.js';
import { createVault, markBackedUp, unlockVault, type VaultBlob } from '../botwallet/vault.js';
import { unlockWithMnemonic, unlockedMnemonic } from '../botwallet/wallet.js';
import { CHAIN_LABEL, NATIVE, copyText } from './helpers.js';
import { SignInButtons } from './SignIn.jsx';
import { toast } from './toast.js';

export function Step({ n, of }: { n: number; of: number }) {
  return <div class="step">Step {n} of {of}</div>;
}

type TeaserRow = { rank: number; handle: string; chain: string; chainClass: string; ret: string; trades: number };

/** Example rows for the public Welcome teaser — /api/board requires a session. */
const EXAMPLE_BOARD: TeaserRow[] = [
  { rank: 1, handle: 'curve_sniper', chain: 'RH', chainClass: 'robinhood', ret: '+42.8%', trades: 14 },
  { rank: 2, handle: 'pump_monk', chain: 'SOL', chainClass: 'solana', ret: '+31.2%', trades: 22 },
  { rank: 3, handle: 'glass_ladder', chain: 'SOL', chainClass: 'solana', ret: '+24.1%', trades: 18 },
  { rank: 4, handle: 'rh_relay', chain: 'RH', chainClass: 'robinhood', ret: '+18.6%', trades: 11 },
  { rank: 5, handle: 'degen_vault', chain: 'SOL', chainClass: 'solana', ret: '+9.4%', trades: 31 },
];

function BoardTeaser() {
  const [rows, setRows] = useState<TeaserRow[] | null>(null);
  const [mode, setMode] = useState<'loading' | 'live' | 'example' | 'empty'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Board is session-gated on the hub; try anyway in case that changes.
        const b = await api.board('robinhood', 'current');
        if (!alive) return;
        const top = (b.entries ?? []).slice(0, 5).map((e, i) => ({
          rank: e.rank ?? i + 1,
          handle: e.handle,
          chain: 'RH',
          chainClass: 'robinhood',
          ret: `${e.returnPct > 0 ? '+' : ''}${e.returnPct.toFixed(1)}%`,
          trades: e.closedTrades,
        }));
        if (top.length === 0) { setMode('empty'); setRows([]); }
        else { setMode('live'); setRows(top); }
      } catch {
        if (!alive) return;
        setMode('example');
        setRows(EXAMPLE_BOARD);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div class="board-teaser" aria-label="This week's board">
      <div class="card ripped">
        <h2>
          <span class="slash" aria-hidden="true" />
          This week's board
          {mode === 'example' && <span class="example-tag">example</span>}
          {mode === 'live' && <span class="pill ok">live</span>}
          <span class="sticker crimson">TOP 5</span>
        </h2>
        <p class="lede">
          {mode === 'example'
            ? 'Prizes off · scored from chain · example data until you sign in'
            : mode === 'empty'
              ? 'Board goes live when bots trade'
              : mode === 'loading'
                ? 'Loading…'
                : 'Weekly return on closed on-chain trades'}
        </p>
        {mode === 'loading' ? (
          <p class="muted small">Checking the board…</p>
        ) : mode === 'empty' ? (
          <p class="muted">Board goes live when bots trade.</p>
        ) : (
          <div class="teaser-lb lb">
            <div class="lb-row head">
              <span>#</span><span>Trader</span><span>Chain</span><span class="n">Return</span><span class="n">Trades</span>
            </div>
            {(rows ?? []).map((r) => (
              <div class="lb-row" key={`${r.handle}-${r.rank}`}>
                <span class="rank">{r.rank}</span>
                <span class="who"><span class="handle">{r.handle}</span></span>
                <span><span class={`chip ${r.chainClass}`}>{r.chain}</span></span>
                <span class={`n gain`}>{r.ret}</span>
                <span class="n">{r.trades}</span>
              </div>
            ))}
          </div>
        )}
        <p class="muted small cta-note">Sign in to open the full Board.</p>
      </div>
    </div>
  );
}

export function Welcome({ info, onSignedIn }: { info: HubInfo; onSignedIn: (me: SessionUser) => void }) {
  return (
    <section class="screen landing">
      <div class="hero welcome">
        <img class="welcome-mark" src="/avatar.png" alt="" width="104" height="104" />
        <p class="eyebrow">Token-gated · non-custodial</p>
        <h1 class="wordmark">TradeWar<span class="warz">Z</span></h1>
        <p class="tagline">Build a trading bot in plain language.</p>
        <div class="gate-pill" role="status"><span>{info.gateRequired.toLocaleString('en-US')}</span> TRADEWARZ to enter</div>
        <p class="big">Run it in this tab. Keep your keys. Sign in with the wallet that holds the gate, pick a bot, and it trades from a wallet that exists only in your browser.</p>
        <SignInButtons onSignedIn={onSignedIn} />
        <p class="muted small sig-note">Signing in is a <strong>signature, not a transaction</strong>: it costs nothing and moves nothing.</p>
      </div>
      <BoardTeaser />
    </section>
  );
}

export function CreateWallet({ onDone, onRestore }: { onDone: (v: VaultBlob) => void; onRestore: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: Event) => {
    e.preventDefault();
    if (pw.length < 8) return toast('Use a password of at least 8 characters.', 'bad');
    if (pw !== pw2) return toast('The two passwords differ.', 'bad');
    setBusy(true);
    try {
      const mnemonic = newMnemonic();
      const keys = deriveKeys(mnemonic);
      const v = await createVault(mnemonic, pw, keys.addresses);
      unlockWithMnemonic(mnemonic);
      onDone(v);
    } catch (err) { toast(describeError(err), 'bad'); } finally { setBusy(false); }
  };
  return (
    <section class="screen">
      <Step n={1} of={3} />
      <h1>Create your bot wallet</h1>
      <p class="big">Your bot trades from its own wallet, made right here in your browser. Choose a password for it. The password is not stored anywhere and cannot be reset.</p>
      <form class="stack" onSubmit={go}>
        <input class="input lg" type="password" autocomplete="new-password" placeholder="Password (8+ characters)" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        <input class="input lg" type="password" autocomplete="new-password" placeholder="Repeat it" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} />
        <button class="btn primary lg" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create wallet'}</button>
      </form>
      <p class="muted small">Already have 12 words from before? <a href="#" onClick={(e) => { e.preventDefault(); onRestore(); }}>Restore that wallet</a></p>
    </section>
  );
}

export function RestoreWallet({ onDone, onBack }: { onDone: (v: VaultBlob) => void; onBack: () => void }) {
  const [words, setWords] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: Event) => {
    e.preventDefault();
    if (!isValidMnemonic(words)) return toast('That is not a valid 12-word phrase (check spelling and order).', 'bad');
    if (pw.length < 8) return toast('Use a password of at least 8 characters.', 'bad');
    setBusy(true);
    try {
      const mnemonic = words.trim().toLowerCase().split(/\s+/).join(' ');
      const keys = deriveKeys(mnemonic);
      const v = await markBackedUp(await createVault(mnemonic, pw, keys.addresses));
      unlockWithMnemonic(mnemonic);
      onDone(v);
    } catch (err) { toast(describeError(err), 'bad'); } finally { setBusy(false); }
  };
  return (
    <section class="screen">
      <h1>Restore your bot wallet</h1>
      <p class="big">Type the 12 words in order, then choose a password for this computer.</p>
      <form class="stack" onSubmit={go}>
        <input class="input lg mono" autocomplete="off" spellcheck={false} placeholder="word word word …" value={words} onInput={(e) => setWords((e.target as HTMLInputElement).value)} />
        <input class="input lg" type="password" autocomplete="new-password" placeholder="Password (8+ characters)" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        <button class="btn primary lg" type="submit" disabled={busy}>{busy ? 'Restoring…' : 'Restore'}</button>
      </form>
      <p class="muted small"><a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Back</a></p>
    </section>
  );
}

export function SaveWords({ vault, onDone }: { vault: VaultBlob; onDone: (v: VaultBlob) => void }) {
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false);
  const words = unlockedMnemonic()?.split(' ') ?? null;
  const go = async () => { setBusy(true); try { onDone(await markBackedUp(vault)); } finally { setBusy(false); } };
  return (
    <section class="screen">
      <Step n={2} of={3} />
      <h1>Save these 12 words</h1>
      <p class="big">They are the only way to recover this wallet and anything in it. Write them down, in order, and keep them offline. Nobody, including us, can recover them for you.</p>
      {words ? (
        <>
          <div class="phrase">{words.map((w, i) => <span key={i}><i>{i + 1}</i>{w}</span>)}</div>
          <div class="btnrow"><button class="btn sm" onClick={async () => toast((await copyText(words.join(' '))) ? 'Copied. Paste it somewhere safe, then clear your clipboard.' : 'Copy blocked by the browser')}>Copy</button></div>
          <label class="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked((e.target as HTMLInputElement).checked)} /> I wrote them down, in order.</label>
          <button class="btn primary lg" disabled={!checked || busy} onClick={go}>Continue</button>
        </>
      ) : (
        <div class="notice bad">The words are not in memory. Reload the page and unlock the wallet to see them.</div>
      )}
    </section>
  );
}

export function UnlockScreen({ vault, onDone, onForget }: { vault: VaultBlob; onDone: (v: VaultBlob) => void; onForget: () => void }) {
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [showForget, setShowForget] = useState(false); const [confirmText, setConfirmText] = useState('');
  const go = async (e: Event) => {
    e.preventDefault(); setBusy(true);
    try { unlockWithMnemonic(await unlockVault(vault, pw)); onDone(vault); } catch (err) { toast(describeError(err), 'bad'); } finally { setBusy(false); }
  };
  return (
    <section class="screen">
      <h1>Unlock your bot wallet</h1>
      <p class="big">The wallet is on this computer. Your password opens it for this tab.</p>
      <form class="stack" onSubmit={go}>
        <input class="input lg" type="password" autocomplete="current-password" placeholder="Password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} autoFocus />
        <button class="btn primary lg" type="submit" disabled={busy || !pw}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
      <p class="muted small">Forgot the password? Your 12 words restore the wallet: <a href="#" onClick={(e) => { e.preventDefault(); setShowForget(true); }}>forget this wallet on this computer</a>, then restore.</p>
      {showForget && (
        <div class="notice bad">
          <p>Only do this if you have the 12 words or the wallet is empty. Type <code>FORGET</code> to confirm.</p>
          <div class="inline"><input class="input" value={confirmText} onInput={(e) => setConfirmText((e.target as HTMLInputElement).value)} /><button class="btn danger" disabled={confirmText !== 'FORGET'} onClick={onForget}>Forget</button></div>
        </div>
      )}
    </section>
  );
}

export function PickBot({ me, defaultChain, onDone, onSkip }: { me: SessionUser; defaultChain: Chain; onDone: (list: StrategyRecord[]) => void; onSkip: () => void }) {
  const [chain, setChain] = useState<Chain>(defaultChain);
  const [name, setName] = useState<PresetName>('balanced');
  const [busy, setBusy] = useState(false);
  const s = preset(name, chain);
  const hasBot = me.wallets.some((w) => w.role === 'bot' && w.chain === chain);
  const start = async () => {
    setBusy(true);
    try {
      const saved = await api.saveStrategy(s);
      let list = (await api.strategies()).strategies;
      if (hasBot) list = (await api.setActive(saved.strategy.id, true)).strategies;
      toast(hasBot ? `${s.name} is on for ${CHAIN_LABEL[chain]}` : `${s.name} saved`);
      onDone(list);
    } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <section class="screen wide">
      <Step n={3} of={3} />
      <h1>Pick your first bot</h1>
      <p class="big">Start from a preset. You can change every number on the dashboard afterwards.</p>
      <div class="segmented">
        {CHAINS.map((c) => <button key={c} class={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{CHAIN_LABEL[c]}</button>)}
      </div>
      <div class="presets">
        {PRESET_NAMES.map((p) => {
          const ps = preset(p, chain);
          return (
            <button key={p} class={`presetcard${name === p ? ' on' : ''}`} onClick={() => setName(p)}>
              <div class="pname">{ps.name}</div>
              <div class="pblurb">{presetBlurb(p, chain)}</div>
              <div class="pnums">{ps.entry.sizeNative} {NATIVE[chain]} per trade · stop −{ps.exits.stopLossPct}% · {ps.exits.takeProfitPct !== null ? `target +${ps.exits.takeProfitPct}%` : 'trailing only'}</div>
            </button>
          );
        })}
      </div>
      <div class="sentences compact">{describeStrategy(s).slice(0, 2).map((t, i) => <div key={i}>{t}</div>)}</div>
      <div class="btnrow">
        <button class="btn primary lg" disabled={busy} onClick={start}>{busy ? 'Saving…' : `Start with ${s.name}`}</button>
        <button class="btn lg" onClick={onSkip}>I'll do this later</button>
      </div>
    </section>
  );
}
