// The owner's research view: every strategy anyone has traded with, ranked by what it made, with
// the exact rules behind each version readable as sentences, and one-click exports of the raw
// trades, fills and strategy versions for a spreadsheet. Aggregates only - nothing here scores.

import { useEffect, useState } from 'preact/hooks';
import { CHAINS, describeStrategy, parseStrategy, type Chain } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { CHAIN_LABEL, CHAIN_SHORT, short } from './helpers.js';

export interface StrategyStat {
  chain: Chain; userId: string; handle: string | null;
  strategyId: string; versionId: string | null; name: string; savedAt: number | null; strategy: unknown; manual: boolean;
  trades: number; wins: number; deployedUsd: number; pnlUsd: number; returnPct: number; avgHoldMin: number; bestUsd: number; worstUsd: number;
  firstAt: number; lastAt: number;
}
export interface ResearchView { chain: Chain | 'all'; week: string; rows: StrategyStat[] }

const usd = (n: number): string => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function ResearchPanel({ weeks }: { weeks: string[] }) {
  const [chain, setChain] = useState<Chain | 'all'>('all');
  const [week, setWeek] = useState<string>('all');
  const [sort, setSort] = useState<'pnlUsd' | 'returnPct' | 'trades' | 'wins'>('pnlUsd');
  const [data, setData] = useState<ResearchView | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.research(chain, week).then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => { if (alive) setError(describeError(e)); });
    return () => { alive = false; };
  }, [chain, week]);
  const rows = [...(data?.rows ?? [])].sort((a, b) => (sort === 'wins' ? b.wins / Math.max(1, b.trades) - a.wins / Math.max(1, a.trades) : b[sort] - a[sort]));
  const key = (r: StrategyStat) => `${r.userId}|${r.strategyId}|${r.versionId ?? ''}|${r.manual ? 1 : 0}`;
  return (
    <div class="card research">
      <h2>Research <span class="muted small">owner only · every trade anyone made, by the rules that made it</span></h2>
      <div class="btnrow wrap">
        <div class="segmented sm">{(['all', ...CHAINS] as const).map((c) => <button key={c} class={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{c === 'all' ? 'All chains' : CHAIN_SHORT[c]}</button>)}</div>
        <select class="input sm" value={week} onChange={(e) => setWeek((e.target as HTMLSelectElement).value)}>
          <option value="all">all weeks</option>
          {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select class="input sm" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as typeof sort)}>
          <option value="pnlUsd">by profit</option><option value="returnPct">by return %</option><option value="trades">by trades</option><option value="wins">by win rate</option>
        </select>
        <span class="spacer" />
        <a class="btn sm" href="/api/research/export?what=trades&format=csv">Trades CSV</a>
        <a class="btn sm" href="/api/research/export?what=fills&format=csv">Fills CSV</a>
        <a class="btn sm" href="/api/research/export?what=strategies&format=json">Strategies JSON</a>
      </div>
      {error && <div class="notice bad small">{error}</div>}
      {data && rows.length === 0 && <p class="muted small">No closed trades yet{week !== 'all' ? ' in that week' : ''}. Trades appear here once a round trip has been read from the chain; hand buys are grouped as "by hand".</p>}
      {rows.length > 0 && (
        <div class="tablewrap">
          <table class="launches">
            <thead><tr><th>strategy</th><th>chain</th><th>trader</th><th class="n">trades</th><th class="n">win rate</th><th class="n">return</th><th class="n">profit</th><th class="n">deployed</th><th class="n">avg hold</th><th class="n">best / worst</th><th>rules saved</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const k = key(r);
                const parsed = r.strategy ? parseStrategy(r.strategy) : null;
                const sentences = parsed?.ok ? describeStrategy(parsed.strategy) : [];
                return (
                  <>
                    <tr key={k} class={`tradable${open === k ? ' sel' : ''}`} onClick={() => setOpen(open === k ? null : k)}>
                      <td class="tok"><b>{r.name}</b>{r.manual && <span class="pill" style="margin-left:6px">by hand</span>}</td>
                      <td><span class={`chip ${r.chain}`}>{CHAIN_SHORT[r.chain]}</span></td>
                      <td class="muted small">{r.handle || short(r.userId, 4)}</td>
                      <td class="n">{r.trades}</td>
                      <td class="n">{Math.round((r.wins / Math.max(1, r.trades)) * 100)}%</td>
                      <td class={`n ${r.returnPct > 0 ? 'gain' : r.returnPct < 0 ? 'loss' : ''}`}>{r.returnPct > 0 ? '+' : ''}{r.returnPct.toFixed(1)}%</td>
                      <td class={`n ${r.pnlUsd > 0 ? 'gain' : r.pnlUsd < 0 ? 'loss' : ''}`}>{usd(r.pnlUsd)}</td>
                      <td class="n">{usd(r.deployedUsd)}</td>
                      <td class="n">{r.avgHoldMin} min</td>
                      <td class="n small">{usd(r.bestUsd)} / {usd(r.worstUsd)}</td>
                      <td class="small muted">{r.savedAt ? new Date(r.savedAt).toLocaleString() : r.manual ? '—' : 'before versioning'}</td>
                    </tr>
                    {open === k && (
                      <tr key={`${k}-rules`} class="none">
                        <td colSpan={11}>
                          {sentences.length ? <ul class="reasons small" style="margin:6px 0">{sentences.map((s, i) => <li key={i}>{s}</li>)}</ul> : <span class="muted small">{r.manual ? 'Bought by hand from the Terminal; exits managed by the bot when it was on.' : 'The rules for this version were not kept (saved before versioning existed).'}</span>}
                          <div class="muted small">{CHAIN_LABEL[r.chain]} · first trade {new Date(r.firstAt).toLocaleString()} · last {new Date(r.lastAt).toLocaleString()}</div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted small" style="margin:8px 0 0">One row per strategy version per trader: a strategy edited mid-week shows as two rows, so a change in results can be traced to the change in rules. Click a row for the rules as sentences.</p>
    </div>
  );
}
