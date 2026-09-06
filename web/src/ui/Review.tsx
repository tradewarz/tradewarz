// Vik's console: the top three of a finished week, each with the trades behind the number and
// the things worth a second look. Nothing here changes a score — the rules already did that.
// This decides one thing: does this entry get paid. Clear, flag, or remove, with a note.

import { useEffect, useState } from 'preact/hooks';
import type { Chain } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { CHAIN_LABEL } from './helpers.js';
import { explorerTxUrl, dexscreenerUrl } from './links.js';
import { toast } from './toast.js';
import { OpsPanel } from './Ops.jsx';

interface ReviewTrade {
  symbol: string; token: string; openedAt: number; closedAt: number;
  costUsd: number; proceedsUsd: number; pnlUsd: number;
  volumeShare: number | null; selfDeployed: boolean;
  entryTx: string; exitTx: string; counted: boolean; reason: string | null;
}
interface ReviewEntry {
  userId: string; handle: string; wallet: string; rank: number | null;
  returnPct: number; pnlUsd: number; deployedUsd: number; closedTrades: number;
  bestTradeUsd: number; bestTradeShare: number;
  eligible: boolean; ineligible: string[]; review: string; reviewNote: string;
  flags: string[]; trades: ReviewTrade[];
}
export interface ReviewData {
  week: string; chain: Chain; live: boolean;
  reviewEndsAt: number | null; payBy: number | null; rollover: boolean; prizes: boolean;
  entries: ReviewEntry[]; weeks: string[];
  indexer?: { indexed: number; skipped: number; failed: number; open?: number; stuck?: number; lastError?: string };
}

const usd = (n: number): string => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const held = (a: number, b: number): string => { const s = Math.round((b - a) / 1000); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };

export function Review({ chains }: { chains: Chain[] }) {
  const [chain, setChain] = useState<Chain>('robinhood');
  const [week, setWeek] = useState('current');
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await api.review(chain, week)); setError(''); }
    catch (e) { setError(describeError(e)); }
  };
  useEffect(() => { void load(); }, [chain, week]);

  const decide = async (userId: string, state: string, note: string) => {
    setBusy(true);
    try { setData({ ...(await api.setReview(userId, state, note, chain, week)), indexer: data?.indexer }); toast(`marked ${state}`); }
    catch (e) { toast(describeError(e), 'bad'); }
    finally { setBusy(false); }
  };
  const rebuild = async (userId: string) => {
    setBusy(true);
    try { const r = await api.rebuildEntry(userId, chain, week); toast(`re-read the chain: ${r.trades} closed trades`); await load(); }
    catch (e) { toast(describeError(e), 'bad'); }
    finally { setBusy(false); }
  };

  if (error) return <div class="card"><div class="notice bad">{error}</div></div>;
  if (!data) return <div class="card muted">Loading…</div>;

  return (
    <div class="stack">
      <OpsPanel />
      <div class="card">
        <h2>Review {data.live && <span class="pill warn">week still running</span>}</h2>
        <p class="lede">
          The top three by score, with every trade behind the number. {data.prizes ? 'A prize only moves after this.' : 'Prizes are off, so this is a dry run of the check.'}
        </p>
        <div class="btnrow">
          {chains.length > 1 && (
            <div class="segmented sm">{chains.map((c) => <button key={c} class={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{CHAIN_LABEL[c]}</button>)}</div>
          )}
          <select class="input sm" value={week} onChange={(e) => setWeek((e.target as HTMLSelectElement).value)}>
            {data.weeks.map((w, i) => <option key={w} value={i === 0 ? 'current' : w}>{i === 0 ? 'This week' : w}</option>)}
          </select>
          <span class="spacer" />
          <button class="btn sm" onClick={() => void load()}>Refresh</button>
        </div>
        {data.indexer && (
          <p class="muted small" style="margin-top:10px">
            Indexer: {data.indexer.indexed} transactions read, {data.indexer.skipped} skipped, {data.indexer.failed} failed
            {data.indexer.open ? `, ${data.indexer.open} waiting` : ''}{data.indexer.stuck ? `, ${data.indexer.stuck} given up on` : ''}
            {data.indexer.lastError ? ` · last error: ${data.indexer.lastError}` : ''}
          </p>
        )}
        {data.rollover && <div class="notice" style="margin-top:12px">Nobody finished in profit — the prize rolls over.</div>}
        {data.payBy && data.reviewEndsAt && <p class="muted small">Review closes {when(data.reviewEndsAt)}; pay by {when(data.payBy)}.</p>}
      </div>

      {data.entries.length === 0
        ? <div class="card muted">Nothing to review: no entry has cleared the floors in profit this week.</div>
        : data.entries.map((e) => <EntryCard key={e.userId} e={e} busy={busy} onDecide={decide} onRebuild={rebuild} chain={chain} />)}
    </div>
  );
}

function EntryCard({ e, busy, chain, onDecide, onRebuild }: {
  e: ReviewEntry; busy: boolean; chain: Chain;
  onDecide: (userId: string, state: string, note: string) => void | Promise<void>;
  onRebuild: (userId: string) => void | Promise<void>;
}) {
  const [note, setNote] = useState(e.reviewNote);
  const [showAll, setShowAll] = useState(false);
  const trades = showAll ? e.trades : e.trades.slice(0, 12);
  return (
    <div class="card">
      <h2>
        <span class="rank">#{e.rank}</span> {e.handle}
        <span class="addr muted small">{e.wallet}</span>
        {e.review === 'clear' && <span class="pill ok">cleared</span>}
        {e.review === 'flagged' && <span class="pill warn">flagged</span>}
        {e.review === 'disqualified' && <span class="pill bad">removed</span>}
      </h2>

      <div class="stats">
        <div><div class="k">Return</div><div class={`v ${e.returnPct > 0 ? 'gain' : 'loss'}`}>{e.returnPct.toFixed(2)}%</div></div>
        <div><div class="k">Profit</div><div class={`v ${e.pnlUsd > 0 ? 'gain' : 'loss'}`}>{usd(e.pnlUsd)}</div></div>
        <div><div class="k">Deployed</div><div class="v">{usd(e.deployedUsd)}</div></div>
        <div><div class="k">Best trade</div><div class="v">{Math.round(e.bestTradeShare * 100)}%</div></div>
      </div>

      {e.flags.length > 0 && (
        <div class="notice"><strong>Worth a look</strong><ul class="reasons">{e.flags.map((f) => <li key={f}>{f}</li>)}</ul></div>
      )}
      {!e.eligible && <div class="notice bad"><ul class="reasons">{e.ineligible.map((r) => <li key={r}>{r}</li>)}</ul></div>}

      <div class="lb rtable" style="margin-top:12px">
        <div class="lb-row head"><span>Token</span><span class="n">Cost</span><span class="n">Out</span><span class="n">P/L</span><span class="n">Held</span><span class="n">Vol %</span><span>Links</span></div>
        {trades.map((t) => (
          <div key={t.entryTx + t.exitTx} class={`lb-row${t.counted ? '' : ' dim'}`}>
            <span class="who">
              <span class="handle">{t.symbol || t.token.slice(0, 8)}</span>
              {!t.counted && <span class="muted small">{t.reason}</span>}
              {t.selfDeployed && <span class="pill bad">launched it</span>}
            </span>
            <span class="n muted">{usd(t.costUsd)}</span>
            <span class="n muted">{usd(t.proceedsUsd)}</span>
            <span class={`n ${t.pnlUsd > 0 ? 'gain' : 'loss'}`}>{usd(t.pnlUsd)}</span>
            <span class="n muted">{held(t.openedAt, t.closedAt)}</span>
            <span class={`n ${t.volumeShare === null ? 'muted' : t.volumeShare > 0.15 ? 'loss' : ''}`}>{t.volumeShare === null ? '—' : `${Math.round(t.volumeShare * 100)}%`}</span>
            <span class="small">
              <a href={dexscreenerUrl(chain, t.token)} target="_blank" rel="noreferrer noopener">chart</a>
              {t.entryTx && <> · <a href={explorerTxUrl(chain, t.entryTx)} target="_blank" rel="noreferrer noopener">in</a></>}
              {t.exitTx && <> · <a href={explorerTxUrl(chain, t.exitTx)} target="_blank" rel="noreferrer noopener">out</a></>}
            </span>
          </div>
        ))}
      </div>
      {e.trades.length > 12 && <button class="btn sm" style="margin-top:8px" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${e.trades.length}`}</button>}

      <div class="field" style="margin-top:14px">
        <label>Note (kept with the decision)</label>
        <input class="input" value={note} onInput={(ev) => setNote((ev.target as HTMLInputElement).value)} placeholder="what you checked, and what you concluded" />
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn primary" disabled={busy} onClick={() => void onDecide(e.userId, 'clear', note)}>Clear for payout</button>
        <button class="btn" disabled={busy} onClick={() => void onDecide(e.userId, 'flagged', note)}>Flag</button>
        <button class="btn danger" disabled={busy} onClick={() => void onDecide(e.userId, 'disqualified', note)}>Remove</button>
        <span class="spacer" />
        <button class="btn sm" disabled={busy} onClick={() => void onRebuild(e.userId)}>Re-read the chain</button>
      </div>
    </div>
  );
}
