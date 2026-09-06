// The Terminal: everything the hub is watching, live, in one table — pons launches on Robinhood
// Chain, pump.fun launches, new Solana pools, promoted tokens and scored CoinGecko/CoinMarketCap
// listings — each row judged on the spot by your rules for its chain (the rule that stopped it, or
// "passes", or what the bot did). Beside it: open positions and decisions from both bots, or the
// rules editor that re-judges the table as you type. Below: the two intelligence feeds for every
// chain, for looking. Click any row for every fact the hub has.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CHAINS, NATIVE_SYMBOL, SOURCE_LABEL, evaluate, isBundled, type BundleFacts, type Candidate, type CandidateSource, type Chain, type FeedInfo, type IntelView, type ListingsView, type Strategy, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { allBots, bots, type BotState, type Decision } from '../engine/bot.js';
import { hubStream } from '../engine/stream.js';
import { RulesForm, checkRules } from './Builder.jsx';
import { CHAIN_LABEL, CHAIN_SHORT, copyText, short } from './helpers.js';
import { dexscreenerUrl, explorerAddressUrl, explorerTokenUrl, ponsUrl, pumpFunUrl } from './links.js';
import { DecisionRow, OpenPositions, ago, native } from './Positions.jsx';
import { toast } from './toast.js';
import { TradeDialog, stubCandidate } from './TradeDialog.jsx';
import { alert as fireAlert, alertSettings, enableNotifications, notificationsAllowed, notificationsSupported, onAlertSettings, setAlertSettings, unlockSound } from './alerts.js';
import { openGuide } from './Guide.jsx';
import { isWatched, toggleWatch, watchlist, type Watched } from './watchlist.js';

type Filter = 'all' | 'pass' | 'acted' | 'watching' | 'bundled';
type ChainPick = 'all' | Chain;
type Verdict = { kind: 'held' | 'bought' | 'pass' | 'wait' | 'skip' | 'none'; text: string; reasons: string[]; unknown: string[] };

const usd = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);
const pct = (n: number | null | undefined, d = 1): string => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`);
const PHASE = ['curve', 'swept', 'pool', 'rescued'];
const ageOf = (ms: number | null, now = Date.now()): string => { if (ms === null) return '—'; const m = Math.max(0, (now - ms) / 60_000); return m < 1 ? `${Math.round(m * 60)}s` : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`; };
const ageText = (c: Candidate): string => ageOf(c.createdAt);
const keyOf = (c: Pick<Candidate, 'chain' | 'address'>): string => `${c.chain}:${c.chain === 'solana' ? c.address : c.address.toLowerCase()}`;

function verdictFor(c: Candidate, s: Strategy | null, held: Set<string>, bought: Set<string>): Verdict {
  const k = keyOf(c);
  if (held.has(k)) return { kind: 'held', text: 'holding', reasons: [], unknown: [] };
  if (bought.has(k)) return { kind: 'bought', text: 'traded', reasons: [], unknown: [] };
  if (!s) return { kind: 'none', text: `no ${CHAIN_LABEL[c.chain]} bot`, reasons: [], unknown: [] };
  const ev = evaluate(c, s);
  if (!ev.pass) return { kind: 'skip', text: ev.reasons[0] ?? 'does not pass', reasons: ev.reasons, unknown: ev.unknown };
  if (c.pons && c.pons.openingTaxBps > s.advanced.pons.maxOpeningTaxBps) return { kind: 'wait', text: `passes · waiting for the opening tax (${(c.pons.openingTaxBps / 100).toFixed(0)}% now, ceiling ${(s.advanced.pons.maxOpeningTaxBps / 100).toFixed(1)}%)`, reasons: [], unknown: ev.unknown };
  return { kind: 'pass', text: ev.unknown.length ? `passes · ${ev.unknown.length} check${ev.unknown.length > 1 ? 's' : ''} unknown` : 'passes every rule', reasons: [], unknown: ev.unknown };
}

/** The curve/progress cell: pons phase or pump.fun progress, whichever the row has. */
function progressText(c: Candidate): string {
  if (c.pons) return c.pons.phase === 0 ? `${Math.round(c.pons.progress * 100)}%` : PHASE[c.pons.phase] ?? String(c.pons.phase);
  if (c.pump) return c.pump.complete ? (c.pump.pool === 'raydium' ? 'raydium' : 'pool') : `${Math.round(c.pump.progress * 100)}%`;
  return '—';
}
const devShare = (c: Candidate): number | null => (c.pons ? c.pons.devSharePct : c.pump ? c.pump.devSharePct : null);

export function Terminal({ strategies, onSaved }: { strategies: StrategyRecord[]; onSaved: (r: StrategyRecord) => void }) {
  const [chainPick, setChainPick] = useState<ChainPick>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState<'all' | CandidateSource>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [, bump] = useState(0);
  const snapshot = (): Record<Chain, BotState> => Object.fromEntries(CHAINS.map((c) => [c, bots[c].state()])) as Record<Chain, BotState>;
  const [states, setStates] = useState<Record<Chain, BotState>>(snapshot);
  const firstSeen = useRef(new Map<string, number>());
  // Tuning: an unsaved copy of one chain's rules that the table judges by as you type.
  const [tuneChain, setTuneChain] = useState<Chain | null>(null);
  const [draft, setDraft] = useState<Strategy | null>(null);
  const [saving, setSaving] = useState(false);
  // Buying by hand: the dialog's target, and the paste-an-address form.
  const [trade, setTrade] = useState<Candidate | null>(null);
  const [addrForm, setAddrForm] = useState(true);
  const [addrChain, setAddrChain] = useState<Chain>('solana');
  const [addr, setAddr] = useState('');
  const [resolving, setResolving] = useState(false);
  const [, bumpWatch] = useState(0);

  useEffect(() => {
    hubStream.start();
    let pending = false;
    const schedule = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; bump((n) => n + 1); }, 400); };
    const refresh = () => setStates(snapshot());
    // New decisions since the last look become alerts: buys and sells as trades, errors as errors.
    const lastSeen = new Map<Chain, number>(CHAINS.map((c) => [c, Date.now()]));
    const announce = () => {
      for (const b of allBots()) {
        const st = b.state();
        const since = lastSeen.get(st.chain) ?? Date.now();
        let newest = since;
        for (const d of st.decisions) {
          if (d.at <= since) continue;
          newest = Math.max(newest, d.at);
          if (d.verdict === 'buy' || d.verdict === 'exit') fireAlert('trade', `${st.chain}:${d.token}:${d.at}`, `${d.verdict === 'buy' ? 'Bought' : 'Sold'} ${d.symbol} on ${CHAIN_LABEL[st.chain]}`, d.reasons[0] ?? '');
          else if (d.verdict === 'error') fireAlert('error', `${st.chain}:${d.token}`, `${CHAIN_SHORT[st.chain]} bot: ${d.symbol}`, d.reasons[0] ?? 'error');
        }
        lastSeen.set(st.chain, newest);
      }
    };
    const offs = [hubStream.on(schedule), ...allBots().map((b) => b.onChange(() => { refresh(); announce(); schedule(); }))];
    const t = setInterval(() => { refresh(); bump((n) => n + 1); }, 5000);
    return () => { for (const off of offs) off(); clearInterval(t); };
  }, []);

  const recordFor = (chain: Chain): StrategyRecord | null => strategies.find((s) => s.chain === chain && s.active) ?? strategies.find((s) => s.chain === chain) ?? null;
  const check = useMemo(() => (draft ? checkRules(draft) : null), [draft]);
  const tuneRecord = tuneChain ? recordFor(tuneChain) : null;
  const tuning = draft !== null && tuneRecord !== null;
  const strategyFor = (chain: Chain): Strategy | null => {
    const r = recordFor(chain);
    if (tuning && tuneChain === chain) return check?.strategy ?? r?.strategy ?? null;
    return r?.strategy ?? null;
  };
  const startTuning = (chain: Chain) => { const r = recordFor(chain); if (r) { setTuneChain(chain); setDraft(structuredClone(r.strategy)); } };
  const discard = () => { setDraft(null); setTuneChain(null); };
  const save = async () => {
    if (!tuneRecord || !check?.ok || !check.strategy) return;
    setSaving(true);
    try { const r = await api.saveStrategy(check.strategy, tuneRecord.id); onSaved(r.strategy); discard(); toast('Rules saved: the bot judges by them from now on'); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setSaving(false); }
  };

  const now = Date.now();
  const all = [...hubStream.candidates.values()].filter((c) => chainPick === 'all' || c.chain === chainPick);
  for (const c of all) { const k = keyOf(c); if (!firstSeen.current.has(k)) firstSeen.current.set(k, now); }
  const open = CHAINS.flatMap((c) => states[c].open).sort((a, b) => b.openedAt - a.openedAt);
  const closed = CHAINS.flatMap((c) => states[c].closed);
  const decisions: Array<Decision & { chain: Chain }> = CHAINS.flatMap((c) => states[c].decisions.map((d) => ({ ...d, chain: c }))).sort((a, b) => b.at - a.at);
  const held = new Set(open.map((p) => keyOf({ chain: p.chain, address: p.token })));
  const bought = new Set([...closed.map((p) => keyOf({ chain: p.chain, address: p.token })), ...decisions.filter((d) => d.verdict === 'buy').map((d) => keyOf({ chain: d.chain, address: d.token }))]);
  const rows = all.map((c) => ({ c, v: verdictFor(c, strategyFor(c.chain), held, bought) })).sort((a, b) => (b.c.createdAt ?? b.c.updatedAt) - (a.c.createdAt ?? a.c.updatedAt));
  const needle = q.trim().toLowerCase();
  const sources = [...new Set(all.map((c) => c.source))] as CandidateSource[];
  const watched = watchlist().filter((w) => chainPick === 'all' || w.chain === chainPick);
  const watchedKeys = new Set(watched.map((w) => keyOf({ chain: w.chain, address: w.address })));
  const shown = rows.filter(({ c, v }) =>
    (filter === 'all' || (filter === 'pass' ? v.kind === 'pass' || v.kind === 'wait' : filter === 'watching' ? watchedKeys.has(keyOf(c)) : filter === 'bundled' ? isBundled(c.bundle) : v.kind === 'held' || v.kind === 'bought'))
    && (source === 'all' || c.source === source)
    && (!needle || c.symbol.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || c.address.toLowerCase().includes(needle)),
  ).slice(0, 250);
  // Alerts from the judged table: a pass on a chain whose bot is off, and a bundle on something you hold or watch.
  const alerted = useRef(new Set<string>());
  for (const { c, v } of rows) {
    const k = keyOf(c);
    if ((v.kind === 'pass' || v.kind === 'wait') && !states[c.chain].running && !alerted.current.has(`pass:${k}`)) {
      alerted.current.add(`pass:${k}`);
      fireAlert('pass', k, `${c.symbol || short(c.address, 4)} passes your ${CHAIN_LABEL[c.chain]} rules`, `${v.text} · the ${CHAIN_SHORT[c.chain]} bot is off, so nothing was bought`);
    }
    if (isBundled(c.bundle) && (held.has(k) || watchedKeys.has(k)) && !alerted.current.has(`bundle:${k}`)) {
      alerted.current.add(`bundle:${k}`);
      fireAlert('bundle', k, `Bundle on ${c.symbol || short(c.address, 4)}`, `${c.bundle!.wallets} wallets took ${c.bundle!.supplyPct.toFixed(1)}% of supply in the launch ${c.bundle!.method}`);
    }
  }
  // Starred coins the hub has stopped streaming: still listed, still buyable by address.
  const gone: Watched[] = filter === 'watching' ? watched.filter((w) => !hubStream.candidates.has(keyOf({ chain: w.chain, address: w.address }))) : [];

  /** Buy by pasted address: use the hub's copy when it has one, ask it to start tracking otherwise. */
  const buyAddress = async () => {
    const a = addr.trim();
    if (a.length < 20) { toast('Paste a token address', 'bad'); return; }
    setResolving(true);
    try {
      let c = hubStream.candidate(addrChain, a) ?? null;
      if (!c) {
        const r = await api.track(addrChain, a).catch(() => null);
        c = r?.candidate ?? null;
        if (!c && addrChain !== 'robinhood') { await new Promise((r2) => setTimeout(r2, 2500)); c = hubStream.candidate(addrChain, a) ?? null; }
      }
      setTrade(c ?? stubCandidate(addrChain, a));
      setAddrForm(false);
    } finally { setResolving(false); }
  };
  const passing = rows.filter((r) => r.v.kind === 'pass' || r.v.kind === 'wait').length;
  const traded = rows.filter((r) => r.v.kind === 'held' || r.v.kind === 'bought').length;
  const bundled = rows.filter((r) => isBundled(r.c.bundle)).length;
  const lastHour = all.filter((c) => c.createdAt !== null && now - c.createdAt < 3_600_000).length;
  const onCurve = all.filter((c) => (c.pons && c.pons.phase === 0) || (c.pump && !c.pump.complete)).length;

  const feed = hubStream.feed;
  const silence = hubStream.silenceSec();
  const live = hubStream.connected && silence < 35;
  const selected = sel ? [...hubStream.candidates.values()].find((c) => keyOf(c) === sel) ?? null : null;
  const pick = (c: Candidate) => setSel(keyOf(c));
  /** Open the drawer for a token from the listing panels. When the hub is not tracking it yet, ask it to, wait a
   *  moment for the candidate to arrive on the stream, and fall back to the buy dialog on a bare address. */
  const pickMint = async (chain: Chain, address: string, hint: { symbol?: string; name?: string } = {}) => {
    const k = keyOf({ chain, address });
    if (hubStream.candidates.has(k)) { setSel(k); return; }
    try {
      const r = await api.track(chain, address);
      if (r.candidate) { hubStream.inject(r.candidate); setSel(k); return; }
      for (let i = 0; i < 8 && !hubStream.candidates.has(k); i++) await new Promise((res) => setTimeout(res, 500));
      if (hubStream.candidates.has(k)) { setSel(k); return; }
      toast(`The hub has no price for ${hint.symbol ?? 'this token'} yet — you can still buy it by address`);
      setTrade(stubCandidate(chain, address, hint));
    } catch (e) {
      toast(describeError(e), 'bad');
    }
  };
  const showChainCol = chainPick === 'all';
  const today = CHAINS.filter((c) => strategies.some((s) => s.chain === c) || states[c].open.length || states[c].realizedToday !== 0n);

  return (
    <div class="terminal">
      <div class="term-top">
        <span class={`dot ${live ? 'ok' : 'bad'}`} />
        <span class="feedtext">{!live ? (silence === Infinity ? 'connecting to the hub…' : `no word from the hub for ${Math.round(silence)}s`) : 'live'}</span>
        <FeedChips feed={feed} />
        <AlertsMenu />
        <span class="spacer" />
        {hubStream.solUsd && <span class="muted small mono">SOL ${hubStream.solUsd.toFixed(2)}</span>}
        {hubStream.ethUsd && <span class="muted small mono">ETH ${hubStream.ethUsd.toFixed(0)}</span>}
        {hubStream.bnbUsd && <span class="muted small mono">BNB ${hubStream.bnbUsd.toFixed(0)}</span>}
        <div class="segmented sm">{(['all', ...CHAINS] as const).map((c) => <button key={c} class={chainPick === c ? 'on' : ''} title={c === 'all' ? 'every chain' : CHAIN_LABEL[c]} onClick={() => { setChainPick(c); setSel(null); }}>{c === 'all' ? 'All' : CHAIN_SHORT[c]}</button>)}</div>
        {CHAINS.filter((c) => recordFor(c)).map((c) => { const r = recordFor(c)!; return <span key={c} class={`pill ${r.active ? 'ok' : ''}`} title={CHAIN_LABEL[c]}>{CHAIN_SHORT[c]} · {r.strategy.name} {r.active ? 'on' : 'off'}</span>; })}
      </div>

      <div class="stats flex">
        <div><div class="k">watching</div><div class="v">{all.length}</div></div>
        <div><div class="k">last hour</div><div class="v">{lastHour}</div></div>
        <div><div class="k">on a curve</div><div class="v">{onCurve}</div></div>
        <div><div class="k">pass now</div><div class={`v ${passing ? 'gain' : ''}`}>{passing}</div></div>
        <div><div class="k">open</div><div class="v">{open.length}</div></div>
        {today.map((c) => { const st = states[c]; return <div key={c}><div class="k">today · {NATIVE_SYMBOL[c]}{c === 'base' ? ' (Base)' : ''}</div><div class={`v ${st.realizedToday > 0n ? 'gain' : st.realizedToday < 0n ? 'loss' : ''}`}>{st.realizedToday >= 0n ? '+' : ''}{native(c, st.realizedToday, c === 'solana' ? 3 : 4)}</div></div>; })}
      </div>

      <div class={`term-grid${tuning ? ' tuning' : ''}`}>
        <div class="term-main term-chrome">
          <div class="term-bar">
            <div class="segmented sm">{(['all', 'pass', 'acted', 'watching', 'bundled'] as const).map((f) => <button key={f} class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? `All (${rows.length})` : f === 'pass' ? `Passing (${passing})` : f === 'acted' ? `Traded (${traded})` : f === 'bundled' ? `Bundled (${bundled})` : `★ Watching (${watched.length})`}</button>)}</div>
            <button class="btn sm" onClick={() => setAddrForm(!addrForm)}>Buy by address</button>
            <select class="input sm" value={source} onChange={(e) => setSource((e.target as HTMLSelectElement).value as 'all' | CandidateSource)} title="how the hub found it">
              <option value="all">every source</option>
              {sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}
            </select>
            <input class="input sm search" placeholder="symbol, name or address" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <span class="spacer" />
            <span class="muted small">{tuning && tuneRecord ? `judged by your unsaved changes to ${tuneRecord.strategy.name}` : chainPick === 'all' ? 'each row judged by its chain’s bot' : recordFor(chainPick) ? `judged by ${recordFor(chainPick)!.strategy.name}${recordFor(chainPick)!.active ? '' : ' (off)'}` : 'add a bot for this chain to see verdicts'}</span>
            {!tuning && (chainPick === 'all'
              ? CHAINS.filter((c) => recordFor(c)).map((c) => <button key={c} class="btn sm" onClick={() => startTuning(c)}>Tune {CHAIN_SHORT[c]} rules</button>)
              : recordFor(chainPick) && <button class="btn sm" onClick={() => startTuning(chainPick)}>Tune rules</button>)}
          </div>
          {addrForm && (
            <div class="term-bar addr">
              <select class="input sm" value={addrChain} onChange={(e) => setAddrChain((e.target as HTMLSelectElement).value as Chain)}>
                {CHAINS.map((c) => <option key={c} value={c}>{CHAIN_LABEL[c]}</option>)}
              </select>
              <input class="input sm mono" style="flex:1;min-width:260px" placeholder={addrChain === 'solana' ? 'token mint address' : addrChain === 'robinhood' ? '0x token address (a pons launch)' : '0x token address'} value={addr} onInput={(e) => setAddr((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void buyAddress(); }} />
              <button class="btn sm primary" disabled={resolving} onClick={() => void buyAddress()}>{resolving ? 'Looking it up…' : 'Open buy'}</button>
              <span class="muted small">The hub is asked to price it; if it has never seen the token, the order is routed by asking the chain.</span>
            </div>
          )}
          <div class="tablewrap">
            <table class="launches">
              <thead>
                <tr>
                  <th title="star to keep it in Watching">★</th><th>age</th>{showChainCol && <th>chain</th>}<th>token</th><th>via</th><th>verdict</th>
                  <th class="n">liquidity</th><th class="n">mcap</th><th class="n">curve</th><th class="n">dev</th><th title="other wallets that bought in the launch block">bundle</th>
                  <th class="n">5m Δ</th><th class="n">vol 5m</th><th class="n">b/s 5m</th><th class="n" title="the 0–100 listing score for coins that came through CoinGecko / CoinMarketCap; see the Guide">score</th><th>socials</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && gone.length === 0 && <tr><td colSpan={16} class="muted small empty">{filter === 'watching' ? 'Nothing starred yet. Click ★ on a row to keep an eye on it; starred coins stay here even after the hub stops streaming them.' : all.length === 0 ? (live ? 'Waiting for the first launch…' : 'Nothing yet.') : 'Nothing matches this filter.'}</td></tr>}
                {gone.map((w) => (
                  <tr key={`gone-${w.chain}-${w.address}`} class="none gone" onClick={() => setTrade(hubStream.candidate(w.chain, w.address) ?? stubCandidate(w.chain, w.address))}>
                    <td class="star on" onClick={(e) => { e.stopPropagation(); toggleWatch({ chain: w.chain, address: w.address, symbol: w.symbol, name: w.name }); bumpWatch((n) => n + 1); }}>★</td>
                    <td class="age">{ageOf(w.at, now)} ago</td>{showChainCol && <td><span class={`chip ${w.chain}`}>{CHAIN_SHORT[w.chain]}</span></td>}
                    <td class="tok"><b>{w.symbol}</b><span class="muted small"> {w.name}</span></td>
                    <td class="via muted small">starred</td>
                    <td class="verdict none" colSpan={10}><span class="vtag">·</span> <span class="vtext">no longer in the hub’s feed — click to buy by address</span></td>
                  </tr>
                ))}
                {shown.map(({ c, v }) => {
                  const k = keyOf(c);
                  const fresh = now - (firstSeen.current.get(k) ?? 0) < 4000;
                  const t5 = c.txns.m5;
                  const s = strategyFor(c.chain);
                  const dev = devShare(c);
                  const devMax = s ? (c.pons ? s.advanced.pons.maxDevSharePct : s.advanced.pump.maxDevSharePct) : null;
                  const li = c.listing;
                  return (
                    <tr key={k} class={`${v.kind}${fresh ? ' fresh' : ''}${sel === k ? ' sel' : ''}`} onClick={() => pick(c)}>
                      <td class={`star${watchedKeys.has(k) ? ' on' : ''}`} title={watchedKeys.has(k) ? 'stop watching' : 'watch this coin'} onClick={(e) => { e.stopPropagation(); toggleWatch(c); bumpWatch((n) => n + 1); }}>{watchedKeys.has(k) ? '★' : '☆'}</td>
                      <td class="age">{ageText(c)}</td>
                      {showChainCol && <td><span class={`chip ${c.chain}`}>{CHAIN_SHORT[c.chain]}</span></td>}
                      <td class="tok"><b>{c.symbol || short(c.address, 4)}</b><span class="muted small"> {c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name}</span></td>
                      <td class="via muted small">{SOURCE_LABEL[c.source as CandidateSource] ?? c.source}</td>
                      <td class={`verdict ${v.kind}`}><span class="vtag">{v.kind === 'skip' ? 'no' : v.kind === 'pass' ? 'PASS' : v.kind === 'wait' ? 'wait' : v.kind === 'held' ? 'HELD' : v.kind === 'bought' ? 'traded' : '·'}</span> <span class="vtext">{v.text}</span></td>
                      <td class="n">{usd(c.liquidityUsd)}</td>
                      <td class="n">{usd(c.marketCapUsd)}</td>
                      <td class="n">{progressText(c)}</td>
                      <td class={`n${dev !== null && devMax !== null && dev > devMax ? ' warn' : ''}`}>{dev === null ? '—' : `${dev.toFixed(1)}%`}</td>
                      <td><BundleChip c={c} limit={s?.advanced.maxBundlePct ?? null} /></td>
                      <td class={`n ${(c.priceChangePct.m5 ?? 0) > 0 ? 'gain' : (c.priceChangePct.m5 ?? 0) < 0 ? 'loss' : ''}`}>{pct(c.priceChangePct.m5)}</td>
                      <td class="n">{usd(c.volumeUsd.m5)}</td>
                      <td class="n">{t5 ? `${t5.buys}/${t5.sells}` : '—'}</td>
                      <td class="n">{li ? <span class={`vtag score ${li.verdict.toLowerCase()}`} title={li.reasons.join('; ')}>{li.score}</span> : '—'}</td>
                      <td>{c.hasSocials ? 'yes' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {tuning && draft && tuneRecord ? (
          <aside class="term-side tune">
            <div class="tune-head">
              <div>
                <h3 style="margin:0">Tune rules <span class="muted small">{CHAIN_LABEL[tuneRecord.chain]} · {tuneRecord.strategy.name}</span></h3>
                <div class={`match ${passing > 0 ? 'ok' : ''}`}><b>{rows.filter((r) => r.c.chain === tuneRecord.chain && (r.v.kind === 'pass' || r.v.kind === 'wait')).length}</b> of {rows.filter((r) => r.c.chain === tuneRecord.chain).length} {CHAIN_LABEL[tuneRecord.chain]} tokens pass with these rules</div>
              </div>
              <div class="btnrow">
                <button class="btn sm" onClick={discard} disabled={saving}>Discard</button>
                <button class="btn sm primary" onClick={save} disabled={!check?.ok || saving}>{saving ? 'Saving…' : 'Save rules'}</button>
              </div>
            </div>
            {check && check.problems.length > 0 && <div class="notice bad small">{check.problems.join(' ')}</div>}
            <p class="muted small" style="margin:0">Every change re-judges the table on the left at once. Nothing the bot does changes until you save.</p>
            <RulesForm draft={draft} onChange={setDraft} />
          </aside>
        ) : (
          <aside class="term-side">
            <h3>Open positions <span class="muted small">{open.length}</span></h3>
            <OpenPositions open={open} compact />
            <h3>Decisions <span class="muted small">every bot · newest first</span></h3>
            {decisions.length === 0 && <div class="muted small">{strategies.some((s) => s.active) ? 'The bots have not judged anything yet.' : 'Switch a bot on and its decisions land here.'}</div>}
            <div class="declist">{decisions.slice(0, 40).map((d, i) => <DecisionRow key={i} d={d} chain={d.chain} onPick={(t) => pickMint(d.chain, t)} />)}</div>
          </aside>
        )}
      </div>

      <ListingsPanel onPick={pickMint} />
      <IntelPanel onPick={pickMint} />

      {selected && <Drawer c={selected} v={verdictFor(selected, strategyFor(selected.chain), held, bought)} onClose={() => setSel(null)} onBuy={() => setTrade(selected)} watched={isWatched(selected.chain, selected.address)} onToggleWatch={() => { toggleWatch(selected); bumpWatch((n) => n + 1); }} />}
      {trade && <TradeDialog target={trade} strategies={strategies} onClose={() => setTrade(null)} onBought={() => { setFilter('acted'); }} />}
    </div>
  );
}

/** The bell: sound and desktop notifications for passes, trades, bundles and errors. Opt-in, remembered in this browser. */
function AlertsMenu() {
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => onAlertSettings(() => bump((n) => n + 1)), []);
  const s = alertSettings();
  const on = s.sound || (s.notify && notificationsAllowed());
  const toggleNotify = async () => {
    if (s.notify) { setAlertSettings({ notify: false }); return; }
    const ok = await enableNotifications();
    setAlertSettings({ notify: ok });
    if (!ok) toast(notificationsSupported() ? 'The browser refused notifications for this site; allow them in the address-bar settings' : 'This browser cannot show notifications', 'bad');
  };
  const Check = ({ k, label }: { k: 'onPass' | 'onTrade' | 'onBundle' | 'onError'; label: string }) => (
    <label class="check small"><input type="checkbox" checked={s[k]} onChange={(e) => setAlertSettings({ [k]: (e.target as HTMLInputElement).checked })} /> {label}</label>
  );
  return (
    <span class="alerts">
      <button class={`btn sm${on ? ' on' : ''}`} title="alerts" onClick={() => { unlockSound(); setOpen(!open); }}>{on ? '● ' : '○ '}alerts</button>
      {open && (
        <div class="alerts-pop" onClick={(e) => e.stopPropagation()}>
          <label class="check small"><input type="checkbox" checked={s.sound} onChange={(e) => { unlockSound(); setAlertSettings({ sound: (e.target as HTMLInputElement).checked }); }} /> sound</label>
          <label class="check small"><input type="checkbox" checked={s.notify && notificationsAllowed()} onChange={() => void toggleNotify()} /> desktop notifications <span class="muted">(when this tab is in the background)</span></label>
          <div class="muted small" style="margin-top:6px">alert me when</div>
          <Check k="onPass" label="a token passes my rules while that chain's bot is off" />
          <Check k="onTrade" label="a bot buys or sells" />
          <Check k="onBundle" label="a bundle turns up on something I hold or watch" />
          <Check k="onError" label="a bot hits an error" />
        </div>
      )}
    </span>
  );
}

/** One chip per source: a dot for health and a word for what it is. */
function FeedChips({ feed }: { feed: FeedInfo | null }) {
  if (!feed) return null;
  const chip = (label: string, mode: string | undefined, at: number | undefined, note: string | undefined) => {
    const ok = mode === 'websocket' || mode === 'polling';
    return <span class={`feedchip ${ok ? 'ok' : 'bad'}`} title={note ?? ''}><span class={`dot ${ok ? 'ok' : 'bad'}`} />{label}{at ? <span class="muted"> {ago(at)}</span> : null}</span>;
  };
  return (
    <span class="feedchips">
      {chip('pons', feed.robinhood.mode, feed.robinhood.lastLaunchAt, feed.robinhood.note)}
      {feed.solana && chip('pump.fun', feed.solana.mode, feed.solana.lastEventAt, feed.solana.note)}
      {feed.listings && chip('pools', feed.listings.mode, feed.listings.lastEventAt, feed.listings.note)}
      {feed.intel && chip('listings', feed.intel.mode, feed.intel.lastEventAt, feed.intel.note)}
    </span>
  );
}

// ---- recently listed: every chain, newest first ------------------------------------------------

function usePolled<T>(load: () => Promise<T>, everyMs: number): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const d = await load(); if (alive) { setData(d); setError(''); } } catch (e) { if (alive) setError(describeError(e)); } };
    void tick();
    const t = setInterval(() => void tick(), everyMs);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { data, error };
}

type PickFn = (chain: Chain, address: string, hint?: { symbol?: string; name?: string }) => void;

function ListingsPanel({ onPick }: { onPick: PickFn }) {
  const { data, error } = usePolled<ListingsView>(() => api.listings(300), 30_000);
  const [net, setNet] = useState('all');
  const [openPanel, setOpenPanel] = useState(true);
  const rows = data?.rows ?? [];
  const netMap = new Map(rows.map((r) => [r.network, r.networkName]));
  for (const [id, name] of [['solana', 'Solana'], ['robinhood', 'Robinhood Chain'], ['base', 'Base'], ['bsc', 'BNB Chain']] as const) if (![...netMap.keys()].some((k) => k === id || (id === 'robinhood' && k.includes('robinhood')))) netMap.set(id, name);
  const nets = [...netMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = rows.filter((r) => net === 'all' || r.network === net).slice(0, 150);
  const now = Date.now();
  return (
    <section class="term-main term-chrome panel">
      <div class="term-bar" onClick={() => setOpenPanel(!openPanel)} style="cursor:pointer">
        <b>Recently listed</b>
        <span class="muted small">brand-new liquidity pools the moment a DEX creates them (GeckoTerminal) — nobody has vetted these · {data ? `${data.total} pools` : 'loading…'} · <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openGuide('panels'); }}>what's this?</a></span>
        {data?.error && <span class="pill warn" title={data.error}>feed paused</span>}
        {error && <span class="pill bad">{error}</span>}
        <span class="spacer" />
        <select class="input sm" value={net} onClick={(e) => e.stopPropagation()} onChange={(e) => setNet((e.target as HTMLSelectElement).value)}>
          <option value="all">all chains</option>
          {nets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <span class="muted small">{openPanel ? 'hide' : 'show'}</span>
      </div>
      {openPanel && (
        <div class="tablewrap short">
          <table class="launches">
            <thead><tr><th>age</th><th>chain</th><th>token</th><th>dex</th><th class="n">price</th><th class="n">liquidity</th><th class="n">vol 1h</th><th class="n">5m Δ</th><th class="n">1h Δ</th><th class="n">b/s 1h</th><th></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={11} class="muted small empty">{data ? 'No pools yet — the first refresh takes a moment.' : 'Loading…'}</td></tr>}
              {shown.map((r) => (
                <tr key={r.id} class={r.tradable ? 'tradable' : ''} onClick={() => { if (r.tradable) onPick(r.tradable, r.tokenAddress, { symbol: r.symbol, name: r.name }); else toast(` is on , a chain TradeWarz does not trade`); }}>
                  <td class="age">{ageOf(r.createdAt, now)}</td>
                  <td><span class={`chip ${r.network === 'solana' ? 'solana' : ''}`}>{r.networkName}</span></td>
                  <td class="tok"><a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><b>{r.symbol}</b></a><span class="muted small"> {r.name.length > 24 ? r.name.slice(0, 23) + '…' : r.name}</span></td>
                  <td class="muted small">{r.dexName}</td>
                  <td class="n">{r.priceUsd === null ? '—' : `$${r.priceUsd.toPrecision(3)}`}</td>
                  <td class="n">{usd(r.liquidityUsd)}</td>
                  <td class="n">{usd(r.volH1Usd)}</td>
                  <td class={`n ${(r.chgM5Pct ?? 0) > 0 ? 'gain' : (r.chgM5Pct ?? 0) < 0 ? 'loss' : ''}`}>{pct(r.chgM5Pct)}</td>
                  <td class={`n ${(r.chgH1Pct ?? 0) > 0 ? 'gain' : (r.chgH1Pct ?? 0) < 0 ? 'loss' : ''}`}>{pct(r.chgH1Pct)}</td>
                  <td class="n">{r.buysH1}/{r.sellsH1}</td>
                  <td>{r.tradable ? <span class="vtag judged">judged ↑</span> : <span class="muted small">view only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- new listings: CoinGecko + CoinMarketCap, scored ---------------------------------------------

function IntelPanel({ onPick }: { onPick: PickFn }) {
  const { data, error } = usePolled<IntelView>(() => api.intel(200), 60_000);
  const [verdict, setVerdict] = useState<'all' | 'ACT' | 'WATCH' | 'REJECT'>('all');
  const [chain, setChain] = useState('all');
  const [openPanel, setOpenPanel] = useState(true);
  const [why, setWhy] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  // The four chains we trade always come first, by name; anything else the catalogues mention follows.
  const seen = new Set(rows.map((r) => r.chain ?? 'unknown'));
  const chains = [...CHAINS.map((c) => c as string), ...[...seen].filter((c) => !(CHAINS as readonly string[]).includes(c)).sort()];
  const chainName = (id: string): string => (CHAINS as readonly string[]).includes(id) ? CHAIN_LABEL[id as Chain] : id === 'bsc' ? 'BNB Chain' : id === 'other' || id === 'unknown' ? 'other chains' : id.charAt(0).toUpperCase() + id.slice(1);
  const shown = rows.filter((r) => (verdict === 'all' || r.verdict === verdict) && (chain === 'all' || (r.chain ?? 'unknown') === chain)).slice(0, 150);
  const now = Date.now();
  const src = data?.sources ?? [];
  const status = src.length ? src.map((s) => `${s.name === 'coingecko' ? 'CoinGecko' : 'CoinMarketCap'}: ${!s.enabled ? 'off' : !s.baselineAt ? 'recording a baseline' : `${s.newSinceBaseline} new since ${ago(s.baselineAt)} ago`}${s.lastError ? ` · ${s.lastError}` : ''}`).join(' · ') : '';
  return (
    <section class="term-main term-chrome panel">
      <div class="term-bar" onClick={() => setOpenPanel(!openPanel)} style="cursor:pointer">
        <b>New listings</b>
        <span class="muted small">coins CoinGecko or CoinMarketCap just added to their catalogues (human-reviewed, usually days old), checked against DexScreener + GoPlus and scored 0–100 · {data ? status || 'off' : 'loading…'} · <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openGuide('score'); }}>how the score works</a></span>
        {error && <span class="pill bad">{error}</span>}
        <span class="spacer" />
        <select class="input sm" value={verdict} onClick={(e) => e.stopPropagation()} onChange={(e) => setVerdict((e.target as HTMLSelectElement).value as typeof verdict)}>
          <option value="all">all verdicts</option><option value="ACT">ACT</option><option value="WATCH">WATCH</option><option value="REJECT">REJECT</option>
        </select>
        <select class="input sm" value={chain} onClick={(e) => e.stopPropagation()} onChange={(e) => setChain((e.target as HTMLSelectElement).value)}>
          <option value="all">all chains</option>
          {chains.map((c) => <option key={c} value={c}>{chainName(c)}{seen.has(c) ? ` (${rows.filter((r) => (r.chain ?? 'unknown') === c).length})` : ''}</option>)}
        </select>
        <span class="muted small">{openPanel ? 'hide' : 'show'}</span>
      </div>
      {openPanel && (
        <div class="tablewrap short">
          <table class="launches">
            <thead><tr><th>detected</th><th>sources</th><th>token</th><th>chain</th><th>verdict</th><th class="n">score</th><th class="n">liquidity</th><th class="n">vol 24h</th><th class="n">price</th><th>why</th><th>links</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={11} class="muted small empty">{data?.enabled === false ? 'The listing feed is switched off on the hub (TW_INTEL=0).' : rows.length === 0 ? 'The first poll records a baseline of each catalogue; coins that appear after that show up here.' : 'Nothing matches this filter.'}</td></tr>}
              {shown.map((r) => (
                <tr key={r.id} class={r.tradable ? 'tradable' : ''} onClick={() => { if (r.tradable && r.tradableAddress) onPick(r.tradable, r.tradableAddress, { symbol: r.symbol, name: r.name }); else toast(` is on , which TradeWarz does not trade`); }}>
                  <td class="age">{ageOf(r.firstDetectedAt, now)}</td>
                  <td class="muted small">{r.sources.map((s) => (s === 'coingecko' ? 'CG' : 'CMC')).join(' + ')}{r.confirmed ? ' ✓' : ''}</td>
                  <td class="tok"><b>{r.symbol}</b><span class="muted small"> {r.name.length > 24 ? r.name.slice(0, 23) + '…' : r.name}</span></td>
                  <td><span class={`chip ${r.chain && (CHAINS as readonly string[]).includes(r.chain) ? r.chain : ''}`}>{r.chain ? chainName(r.chain) : '?'}</span></td>
                  <td><span class={`vtag score ${r.verdict.toLowerCase()}`}>{r.verdict}</span></td>
                  <td class="n">{r.score}</td>
                  <td class="n">{usd(r.market?.liquidityUsd)}</td>
                  <td class="n">{usd(r.market?.volume24hUsd)}</td>
                  <td class="n">{r.market?.priceUsd ? `$${r.market.priceUsd.toPrecision(3)}` : '—'}</td>
                  <td class="why small"><a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWhy(why === r.id ? null : r.id); }}>{r.reasons.length} reason{r.reasons.length === 1 ? '' : 's'}</a>{why === r.id && <ul class="reasons small">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}</td>
                  <td class="small">
                    {r.urls.coingecko && <a href={r.urls.coingecko} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>CG</a>}
                    {r.urls.coinmarketcap && <> · <a href={r.urls.coinmarketcap} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>CMC</a></>}
                    {r.market?.dexUrl && <> · <a href={r.market.dexUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>chart</a></>}
                    {r.tradable && <> · <span class="vtag judged">judged ↑</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- the drawer: every fact the hub has about one token ------------------------------------------

function Drawer({ c, v, onClose, onBuy, watched, onToggleWatch }: { c: Candidate; v: Verdict; onClose: () => void; onBuy: () => void; watched: boolean; onToggleWatch: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const p = c.pons ?? null;
  const q = c.pump ?? null;
  const li = c.listing ?? null;
  const copy = async (t: string) => { const ok = await copyText(t); toast(ok ? 'Copied' : 'Could not copy', ok ? 'ok' : 'bad'); };
  return (
    <div class="drawer" role="dialog" aria-label={`${c.symbol} details`}>
      <div class="drawer-head">
        <div><b>{c.symbol}</b> <span class="muted">{c.name}</span> <span class={`chip ${c.chain}`}>{CHAIN_LABEL[c.chain]}</span><div class="muted small mono">{short(c.address, 8)} <a href="#" onClick={(e) => { e.preventDefault(); void copy(c.address); }}>copy</a></div></div>
        <button class="btn sm" onClick={onClose}>Close</button>
      </div>
      <div class="btnrow">
        <button class="btn primary" onClick={onBuy}>Buy…</button>
        <button class={`btn${watched ? ' on' : ''}`} onClick={onToggleWatch}>{watched ? '★ Watching' : '☆ Watch'}</button>
        <span class="muted small">Buy opens a dialog for the amount; nothing is sent until you confirm there.</span>
      </div>
      <div class="btnrow wrap">
        <a class="btn sm" href={dexscreenerUrl(c.chain, c.address)} target="_blank" rel="noopener">DexScreener</a>
        <a class="btn sm" href={explorerTokenUrl(c.chain, c.address)} target="_blank" rel="noopener">Explorer</a>
        {p && <a class="btn sm" href={ponsUrl(c.address)} target="_blank" rel="noopener">pons</a>}
        {p && <a class="btn sm" href={explorerAddressUrl(c.chain, p.deployer)} target="_blank" rel="noopener">Deployer</a>}
        {p && <a class="btn sm" href={explorerAddressUrl(c.chain, p.curve)} target="_blank" rel="noopener">Curve</a>}
        {q && <a class="btn sm" href={pumpFunUrl(c.address)} target="_blank" rel="noopener">pump.fun</a>}
        {q && q.creator && <a class="btn sm" href={explorerAddressUrl(c.chain, q.creator)} target="_blank" rel="noopener">Creator</a>}
        {li?.urls.coingecko && <a class="btn sm" href={li.urls.coingecko} target="_blank" rel="noopener">CoinGecko</a>}
        {li?.urls.coinmarketcap && <a class="btn sm" href={li.urls.coinmarketcap} target="_blank" rel="noopener">CoinMarketCap</a>}
      </div>
      <div class={`notice ${v.kind === 'pass' || v.kind === 'held' ? 'ok' : v.kind === 'skip' ? 'bad' : ''} small`}>
        <b>{v.kind === 'skip' ? 'Does not pass' : v.kind === 'pass' ? 'Passes' : v.kind === 'wait' ? 'Passes, waiting' : v.kind === 'held' ? 'Holding' : v.kind === 'bought' ? 'Traded' : 'No bot'}.</b>{' '}
        {v.reasons.length ? <ul>{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : v.text}
        {v.unknown.length > 0 && <div class="muted" style="margin-top:6px">Could not check: {v.unknown.join('; ')}.</div>}
      </div>
      <dl class="facts">
        <dt>age</dt><dd>{ageText(c)} {c.createdAt ? <span class="muted small">({new Date(c.createdAt).toLocaleTimeString()})</span> : null}</dd>
        <dt>found via</dt><dd>{SOURCE_LABEL[c.source as CandidateSource] ?? c.source} · {c.dexId}</dd>
        <dt>liquidity</dt><dd>{usd(c.liquidityUsd)}</dd>
        <dt>market cap</dt><dd>{usd(c.marketCapUsd)}{c.fdvUsd !== null && c.fdvUsd !== c.marketCapUsd ? <span class="muted small"> · FDV {usd(c.fdvUsd)}</span> : null}{q?.marketCapSol !== null && q?.marketCapSol !== undefined ? <span class="muted small"> · {q.marketCapSol.toFixed(1)} SOL</span> : null}</dd>
        <dt>price</dt><dd>{c.priceUsd !== null ? `$${c.priceUsd.toPrecision(3)}` : '—'}{c.priceNative !== null ? <span class="muted small"> · {c.priceNative.toPrecision(3)} {c.quoteSymbol}</span> : null}</dd>
        <dt>volume</dt><dd>5m {usd(c.volumeUsd.m5)} · 1h {usd(c.volumeUsd.h1)} · 6h {usd(c.volumeUsd.h6)} · 24h {usd(c.volumeUsd.h24)}</dd>
        <dt>price change</dt><dd>5m {pct(c.priceChangePct.m5)} · 1h {pct(c.priceChangePct.h1)} · 6h {pct(c.priceChangePct.h6)} · 24h {pct(c.priceChangePct.h24)}</dd>
        <dt>buys / sells</dt><dd>{(['m5', 'h1', 'h6', 'h24'] as const).map((w) => `${w} ${c.txns[w] ? `${c.txns[w]!.buys}/${c.txns[w]!.sells}` : '—'}`).join(' · ')}</dd>
        <dt>socials</dt><dd>{c.hasSocials ? 'declared' : 'none declared'}{c.boosted ? ' · boosted' : ''}</dd>
        {c.safety && (<>
          <dt>safety</dt>
          <dd>mint {tri(c.safety.mintRenounced, 'renounced', 'live')} · freeze {tri(c.safety.freezeRenounced, 'renounced', 'live')} · LP {tri(c.safety.lpBurnedOrLocked, 'locked/burned', 'unlocked')} · honeypot {tri(c.safety.honeypot === null ? null : !c.safety.honeypot, 'no', 'YES')} · sell tax {c.safety.sellTaxPct !== null ? `${c.safety.sellTaxPct.toFixed(1)}%` : 'unknown'}{c.safety.top10HoldersPct !== null ? ` · top 10 hold ${c.safety.top10HoldersPct.toFixed(0)}%` : ''}<span class="muted small"> · via {c.safety.source ?? '?'}</span></dd>
        </>)}
        {p && (<>
          <dt>pons phase</dt><dd>{PHASE[p.phase] ?? p.phase}{p.phase === 0 ? ` · ${Math.round(p.progress * 100)}% to graduation` : ''}{p.readyToGraduate ? ' · ready to graduate' : ''}</dd>
          <dt>launcher</dt><dd>{short(p.deployer, 6)} bought {p.devSharePct.toFixed(2)}% of supply{p.deployerPrior !== null ? ` · ${p.deployerPrior} prior launch${p.deployerPrior === 1 ? '' : 'es'}${p.deployerGraduated !== null ? `, ${p.deployerGraduated} graduated` : ''}` : ''}</dd>
          <dt>taxes</dt><dd>opening {(p.openingTaxBps / 100).toFixed(1)}% now · creator {(p.creatorTaxBps / 100).toFixed(2)}% · curve fee {(p.feeBps / 100).toFixed(2)}% · fee to deployer {tri(p.feeToDeployer, 'yes', 'no')}</dd>
          <dt>exempt wallets</dt><dd>{p.exemptWallets}</dd>
          <dt>launch block</dt><dd>{c.bundle ? <><BundleChip c={c} limit={null} /> <span class="muted small">{bundleText(c.bundle)}</span></> : 'not read yet'}</dd>
          <dt>reserves</dt><dd>{(Number(BigInt(p.quoteReserve)) / 1e18).toFixed(4)} {c.quoteSymbol} in the curve{p.realQuoteReserve !== p.quoteReserve ? ` (${(Number(BigInt(p.realQuoteReserve)) / 1e18).toFixed(4)} real)` : ''}</dd>
        </>)}
        {q && (<>
          <dt>pump.fun</dt><dd>{q.complete ? `graduated · trades on ${q.pool === 'raydium' ? 'Raydium' : 'PumpSwap'}` : `on the bonding curve · ${Math.round(q.progress * 100)}% to graduation`}</dd>
          <dt>creator</dt><dd>{q.creator ? short(q.creator, 6) : '—'} bought {q.devBuySol.toFixed(3)} SOL at launch{q.devSharePct !== null ? ` (${q.devSharePct.toFixed(2)}% of supply)` : ''}{q.creatorPrior !== null ? ` · ${q.creatorPrior} prior launch${q.creatorPrior === 1 ? '' : 'es'} seen` : ''}</dd>
          <dt>curve</dt><dd>{q.realSol.toFixed(3)} SOL real · {q.vSol.toFixed(2)} SOL virtual · {(q.vTokens / 1e6).toFixed(1)}M tokens virtual</dd>
          <dt>launch slot</dt><dd>{c.bundle ? <><BundleChip c={c} limit={null} /> <span class="muted small">{bundleText(c.bundle)}</span></> : 'not read yet'}</dd>
        </>)}
        {li && (<>
          <dt>listing</dt><dd><span class={`vtag score ${li.verdict.toLowerCase()}`}>{li.verdict} {li.score}</span> · {li.sources.map((s) => (s === 'coingecko' ? 'CoinGecko' : 'CoinMarketCap')).join(' + ')}{li.confirmed ? ' · confirmed on both' : ''} · detected {ago(li.detectedAt)} ago</dd>
          <dt>why</dt><dd><ul class="reasons small" style="margin:0">{li.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul><a class="small" href="#" onClick={(e) => { e.preventDefault(); openGuide('score'); }}>how the score works</a></dd>
        </>)}
        <dt>updated</dt><dd>{ago(c.updatedAt)} ago</dd>
      </dl>
    </div>
  );
}
const tri = (v: boolean | null, yes: string, no: string): string => (v === null ? 'unknown' : v ? yes : no);

/** The launch-block check as a chip: red when other wallets bundled in, quiet when clean, dots until read. */
function BundleChip({ c, limit }: { c: Candidate; limit: number | null }) {
  const b = c.bundle;
  if (!b) return <span class="muted small" title={c.pump || c.pons ? 'launch block not read yet' : 'not a launch (no launch block to read)'}>{c.pump || c.pons ? '…' : '—'}</span>;
  if (!isBundled(b)) return <span class="vtag clean" title={bundleText(b)}>clean</span>;
  const over = limit !== null && b.supplyPct > limit;
  return <span class={`vtag bundle${over ? ' over' : ''}`} title={bundleText(b) + (over ? ` — over your ${limit}% limit` : '')}>BUNDLE {b.supplyPct.toFixed(b.supplyPct >= 10 ? 0 : 1)}%</span>;
}
const bundleText = (b: BundleFacts): string => b.wallets === 0
  ? `nobody else bought in the launch ${b.method}`
  : `${b.wallets} wallet${b.wallets === 1 ? '' : 's'} bought ${b.supplyPct.toFixed(1)}% of supply in the launch ${b.method} for ${b.nativeSpent} ${b.method === 'slot' ? 'SOL' : 'ETH'}; with the creator's buy, ${b.launchPct.toFixed(1)}% left the floor at once`;
