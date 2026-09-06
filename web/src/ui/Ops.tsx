// The owner's budget view: what each provider is costing right now, who is connected, what the
// limiter refused. Counters from the hub are cumulative; the rate column is the change since the
// previous sample, so a spike shows up within half a minute instead of at the end of the month.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, describeError } from '../api.js';

export interface OpsData {
  now: number; uptimeSec: number; memoryMb: number;
  tabs: number; watched: number;
  candidates: Record<string, number>;
  feed: Record<string, { mode: string; lastEventAt: number; candidates: number; note: string } | undefined>;
  rpc: {
    solana: { active: number; queued: number; throttled: number; calls: number; coolingDown: boolean };
    robinhood: { active: number; queued: number; throttled: number; coolingDown: boolean; endpoints?: Array<{ label: string; bad?: boolean; badUntil?: number }> };
  };
  dexscreener: { calls: number; throttled?: number; lastError: string; lastErrorAt?: number };
  sources: {
    solana?: { creations: number; trades: number; curveReads: number; bundleChecks: number; bundled: number; tracked: number; dropped: number };
    base?: { discovered: number; dexRefreshes: number; safetyChecks: number };
    bsc?: { discovered: number; dexRefreshes: number; safetyChecks: number };
    listings?: { rows: number; lastError: string | null; enabled: boolean };
    intel?: { total: number };
  };
  indexer: { indexed: number; skipped: number; failed: number; lastError: string; open: number; stuck: number };
  rateLimit: { refused: Record<string, number>; tracked: number };
}

const EVERY_MS = 15_000;

/** Per-minute rate from two cumulative samples. */
const perMin = (now: number | undefined, prev: number | undefined, dtMs: number): string => (now === undefined || prev === undefined || dtMs <= 0 ? '—' : `${Math.round(((now - prev) * 60_000) / dtMs)}/min`);

export function OpsPanel() {
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState('');
  const prev = useRef<OpsData | null>(null);
  const last = useRef<OpsData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await api.ops(); if (!alive) return; prev.current = last.current; last.current = d; setData(d); setError(''); }
      catch (e) { if (alive) setError(describeError(e)); }
    };
    void load();
    const t = setInterval(load, EVERY_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (error) return <div class="card"><h2>Ops</h2><div class="notice bad small">{error}</div></div>;
  if (!data) return <div class="card"><h2>Ops</h2><p class="muted small">Loading…</p></div>;
  const p = prev.current;
  const dt = p ? data.now - p.now : 0;
  const rows: Array<[string, string, string, string]> = [
    ['Solana RPC', `${data.rpc.solana.calls} calls`, perMin(data.rpc.solana.calls, p?.rpc.solana.calls, dt), `${data.rpc.solana.throttled} throttled${data.rpc.solana.coolingDown ? ' · cooling down now' : ''}${data.rpc.solana.queued ? ` · ${data.rpc.solana.queued} queued` : ''}`],
    ['Robinhood RPC', `${data.rpc.robinhood.active} in flight`, '—', `${data.rpc.robinhood.throttled} throttled${data.rpc.robinhood.coolingDown ? ' · cooling down now' : ''}${data.rpc.robinhood.queued ? ` · ${data.rpc.robinhood.queued} queued` : ''}`],
    ['DexScreener', `${data.dexscreener.calls} calls`, perMin(data.dexscreener.calls, p?.dexscreener.calls, dt), data.dexscreener.lastError && data.dexscreener.lastErrorAt && data.now - data.dexscreener.lastErrorAt < 120_000 ? data.dexscreener.lastError : `${data.dexscreener.throttled ?? 0} throttled`],
    ['GeckoTerminal', `${data.sources.listings?.rows ?? 0} pools listed`, '—', data.sources.listings?.lastError ?? 'ok'],
    ['CoinGecko + CMC', `${data.sources.intel?.total ?? 0} listings scored`, '—', data.feed.intel?.note ?? ''],
    ['pump.fun feed', `${data.sources.solana?.creations ?? 0} creations · ${data.sources.solana?.tracked ?? 0} tracked`, perMin(data.sources.solana?.creations, p?.sources.solana?.creations, dt), `${data.sources.solana?.bundleChecks ?? 0} bundle checks · ${data.sources.solana?.bundled ?? 0} bundled`],
    ['Base / BNB', `${data.sources.base?.discovered ?? 0} / ${data.sources.bsc?.discovered ?? 0} discovered`, '—', `GoPlus checks ${(data.sources.base?.safetyChecks ?? 0) + (data.sources.bsc?.safetyChecks ?? 0)}`],
    ['Indexer', `${data.indexer.indexed} indexed · ${data.indexer.skipped} skipped · ${data.indexer.failed} failed`, '—', data.indexer.stuck ? `${data.indexer.stuck} stuck · ${data.indexer.lastError}` : data.indexer.open ? `${data.indexer.open} queued` : 'idle'],
  ];
  const refused = Object.entries(data.rateLimit.refused);
  return (
    <div class="card ops">
      <h2>Ops <span class="muted small">owner only · refreshes every 15 s</span></h2>
      <div class="stats flex">
        <div><div class="k">tabs connected</div><div class="v">{data.tabs}</div></div>
        <div><div class="k">tokens watched</div><div class="v">{data.watched}</div></div>
        <div><div class="k">candidates</div><div class="v">{Object.values(data.candidates).reduce((a, b) => a + b, 0)}</div></div>
        <div><div class="k">hub uptime</div><div class="v">{Math.floor(data.uptimeSec / 3600)}h {Math.floor((data.uptimeSec % 3600) / 60)}m</div></div>
        <div><div class="k">memory</div><div class="v">{data.memoryMb} MB</div></div>
        <div><div class="k">rate-limit refusals</div><div class={`v ${refused.length ? 'loss' : ''}`}>{refused.reduce((a, [, n]) => a + n, 0)}</div></div>
      </div>
      <div class="tablewrap">
        <table class="launches">
          <thead><tr><th>provider</th><th>so far</th><th class="n">rate</th><th>state</th></tr></thead>
          <tbody>{rows.map(([a, b, c, d]) => <tr key={a}><td><b>{a}</b></td><td class="muted small">{b}</td><td class="n mono">{c}</td><td class="small">{d}</td></tr>)}</tbody>
        </table>
      </div>
      {refused.length > 0 && <p class="muted small" style="margin:8px 0 0">Refused by the limiter: {refused.map(([k, n]) => `${k} ×${n}`).join(' · ')}</p>}
      <p class="muted small" style="margin:8px 0 0">Per chain: {Object.entries(data.candidates).map(([c, n]) => `${c} ${n}`).join(' · ')}. The rate column compares two samples 15 s apart; a dash means the provider only reports state, not counts.</p>
    </div>
  );
}
