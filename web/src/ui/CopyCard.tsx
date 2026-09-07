// Copy trading, as the Bot panel shows it: the wallets this bot follows, whether the hub is
// watching each one (and when it last traded), and the latest signals with what the bot did
// about each - copied, skipped and why, waiting, or nothing because the bot was off.

import { useEffect, useState } from 'preact/hooks';
import type { Chain, CopyStatus, CopyWallet } from '@tradewarz/shared';
import { api } from '../api.js';
import type { BotState } from '../engine/bot.js';
import { explorerAddress } from '../botwallet/wallet.js';
import { openGuide } from './Guide.jsx';

const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;
const ago = (t: number | null): string => {
  if (!t) return 'no trade seen yet';
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
};

export function CopyCard({ chain, wallets, signals, running }: { chain: Chain; wallets: CopyWallet[]; signals: BotState['signals']; running: boolean }) {
  const [status, setStatus] = useState<CopyStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { api.copy().then((s) => { if (alive) setStatus(s); }).catch(() => undefined); };
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [chain, wallets.map((w) => w.address).join(',')]);
  if (!wallets.length) return null;
  const watched = (a: string) => status?.watching.find((w) => w.chain === chain && (chain === 'solana' ? w.address === a : w.address === a.toLowerCase()));
  return (
    <div class="copycard">
      <h3>Copy trading <span class="muted small">what the wallets you follow are doing, and what the bot did about it · <a href="#" onClick={(e) => { e.preventDefault(); openGuide('copy'); }}>how it works</a></span></h3>
      <div class="rows">
        {wallets.map((w) => {
          const st = watched(w.address);
          return (
            <div class="row" key={w.address}>
              <div class="k">{w.label || short(w.address)}</div>
              <div class="v">
                <a class="addr" href={explorerAddress(chain, w.address)} target="_blank" rel="noopener noreferrer">{short(w.address)}</a>
                {' '}<span class="muted small">· {status === null ? 'checking…' : st ? `watched · ${st.trades} trade${st.trades === 1 ? '' : 's'} seen · last ${ago(st.lastTradeAt)}` : 'not watched by the hub yet (save the bot, or wait a moment)'}</span>
              </div>
            </div>
          );
        })}
      </div>
      {status?.problems.filter((p) => !/not watched on this hub/.test(p)).map((p) => <div key={p} class="notice bad small" style="margin-top:8px">{p}</div>)}
      {!running && <div class="muted small" style="margin-top:8px">The bot is off: signals still show here, nothing is copied.</div>}
      <div class="signals">
        {signals.length === 0 && <div class="muted small">No signals yet. When a followed wallet buys or sells, it shows here within seconds.</div>}
        {signals.slice(0, 12).map((s, i) => (
          <div class="signal" key={`${s.tx ?? ''}${i}`}>
            <span class={`pill ${s.side === 'buy' ? 'ok' : 'warn'}`}>{s.side}</span>
            <span><b>{s.label}</b> {s.side === 'buy' ? 'bought' : 'sold'} {s.symbol ?? short(s.token)}{s.nativeAmount ? ` for ${s.nativeAmount}` : ''}{s.side === 'sell' && s.fractionPct !== null ? ` (${s.fractionPct}% of theirs)` : ''}</span>
            <span class="muted small">· {ago(s.at)} · <i>{s.action}</i></span>
          </div>
        ))}
      </div>
    </div>
  );
}
