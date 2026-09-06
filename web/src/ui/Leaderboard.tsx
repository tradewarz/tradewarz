// The board. Plain language on purpose: a rank, a number, and — where someone can't win — the
// one sentence that says why, so nobody has to guess at the rules. Prizes are off until Vik
// turns them on; the board runs either way, which is the whole point of launching it early.

import { useEffect, useState } from 'preact/hooks';
import type { BoardEntryView, BoardView, Chain } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { CHAIN_LABEL } from './helpers.js';

const pct = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const usd = (n: number): string => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const weekLabel = (b: BoardView): string => {
  const d = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${d(b.startsAt)} – ${d(b.endsAt - 1)}`;
};
const countdown = (ms: number): string => {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

export function Leaderboard({ chains }: { chains: Chain[] }) {
  const [chain, setChain] = useState<Chain>('robinhood');
  const [week, setWeek] = useState('current');
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const load = async () => {
    try {
      setBusy(true);
      setBoard(await api.board(chain, week));
      setError('');
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [chain, week]);
  // A live week moves; a finished one never does.
  useEffect(() => {
    if (!board?.live) return;
    const t = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(t);
  }, [board?.live, chain, week]);

  if (error) return <div class="card"><div class="notice bad">{error}</div><div class="btnrow" style="margin-top:12px"><button class="btn" onClick={() => void load()}>Try again</button></div></div>;
  if (!board) return <div class="card muted">Loading the board…</div>;

  const anyEligible = board.entries.some((e) => e.eligible);
  return (
    <div class="stack">
      <div class="card">
        <h2>
          Weekly leaderboard
          <span class="pill">{weekLabel(board)}</span>
          {board.live ? <span class="pill ok">live · {countdown(board.endsAt)} left</span> : <span class="pill">finished</span>}
        </h2>
        <p class="lede">
          Best percent return on the money you actually put through your bot, counted only when a trade is closed
          and settled on chain. {board.prizes
            ? (board.prizeText || 'The top eligible entry each week wins the announced prize.')
            : 'Prizes are not switched on yet — the board is running so the scoring can be proven in public first.'}
        </p>

        <div class="btnrow" style="margin-bottom:14px">
          {chains.length > 1 && (
            <div class="segmented sm">
              {chains.map((c) => <button key={c} class={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{CHAIN_LABEL[c]}</button>)}
            </div>
          )}
          <select class="input sm" value={week} onChange={(e) => setWeek((e.target as HTMLSelectElement).value)}>
            {board.weeks.map((w, i) => <option key={w} value={i === 0 ? 'current' : w}>{i === 0 ? 'This week' : w}</option>)}
          </select>
          <span class="spacer" />
          <button class="btn sm" disabled={busy} onClick={() => void load()}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {!board.live && board.rollover && (
          <div class="notice">Nobody finished this week in profit, so the prize rolls into next week.</div>
        )}
        {!board.live && board.reviewEndsAt !== null && Date.now() < board.reviewEndsAt && (
          <div class="notice">The top three are provisional while they are checked by hand — about {countdown(board.reviewEndsAt)} to go.</div>
        )}

        {board.entries.length === 0
          ? <p class="muted">No closed trades yet this week. Turn a bot on and the first round trip puts you on the board.</p>
          : <div class="lb">
              <div class="lb-row head">
                <span>#</span><span>Trader</span><span class="n">Return</span><span class="n">Profit</span><span class="n">Deployed</span><span class="n">Trades</span>
              </div>
              {board.entries.map((e, i) => <Row key={`${e.wallet}-${i}`} e={e} />)}
            </div>}

        {board.you && !board.you.eligible && board.you.ineligible.length > 0 && (
          <div class="notice" style="margin-top:14px">
            <strong>You're on the board but not in the running yet.</strong>
            <ul class="reasons">{board.you.ineligible.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        {!anyEligible && board.entries.length > 0 && (
          <p class="muted small" style="margin-top:12px">Nobody has cleared the floors yet this week.</p>
        )}
      </div>

      <Rules board={board} />
    </div>
  );
}

function Row({ e }: { e: BoardEntryView }) {
  const [open, setOpen] = useState(false);
  const why = [...e.ineligible, ...e.excluded];
  return (
    <>
      <div class={`lb-row${e.you ? ' you' : ''}${e.eligible ? '' : ' dim'}`} onClick={() => why.length && setOpen(!open)} role={why.length ? 'button' : undefined}>
        <span class="rank">{e.rank ?? '—'}</span>
        <span class="who">
          <span class="handle">{e.handle}{e.you && <span class="pill" style="margin-left:8px">you</span>}</span>
          <span class="addr muted small">{e.wallet}</span>
          {e.review === 'flagged' && <span class="pill warn">in review</span>}
          {e.review === 'disqualified' && <span class="pill bad">removed</span>}
        </span>
        <span class={`n big ${e.returnPct > 0 ? 'gain' : e.returnPct < 0 ? 'loss' : ''}`}>{pct(e.returnPct)}</span>
        <span class={`n ${e.pnlUsd > 0 ? 'gain' : e.pnlUsd < 0 ? 'loss' : ''}`}>{usd(e.pnlUsd)}</span>
        <span class="n muted">{usd(e.deployedUsd)}</span>
        <span class="n muted">{e.closedTrades}{e.closedTrades > 0 && <span class="small"> · {e.wins} up</span>}</span>
      </div>
      {open && why.length > 0 && (
        <div class="lb-why">
          <ul class="reasons">{why.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </>
  );
}

function Rules({ board }: { board: BoardView }) {
  const r = board.rules;
  return (
    <details class="card">
      <summary><strong>How the scoring works</strong></summary>
      <ul class="reasons" style="margin-top:10px">
        <li>Your score is profit divided by the money you put in, as a percent. Only trades you have closed count — an open position is worth nothing to the board until you're out of it.</li>
        <li>Every number is read off the chain by the hub from your own transactions. Nothing your browser reports is taken on trust.</li>
        <li>To be in the running for a prize you need at least ${r.minDeployedUsd.toLocaleString('en-US')} deployed and {r.minClosedTrades} closed trades, and no single trade may be more than {Math.round(r.maxSingleTradeShareOfGain * 100)}% of your gain.</li>
        <li>Trades in a token you launched yourself don't count. Nor do trades where you were more than {Math.round(r.maxVolumeShare * 100)}% of the token's volume while you held it.</li>
        <li>One bot wallet per chain per week. The first trade of the week fixes which wallet you're entered with.</li>
        <li>Weeks run Monday 00:00 to Sunday 24:00 UTC. The top three are checked by hand for about {r.reviewHours} hours after a week ends{board.prizes ? `, and a prize is sent within ${r.payoutHours} hours of that` : ''}.</li>
        <li>If nobody finishes a week in profit, the prize rolls over.</li>
      </ul>
    </details>
  );
}
