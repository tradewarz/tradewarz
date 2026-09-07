// What a bot is doing right now and why: connection, wallet vs buy size, what it is watching,
// open positions with live PnL and a Sell now, today's budget, the decision log. One per chain.

import { useEffect, useState } from 'preact/hooks';
import type { Chain } from '@tradewarz/shared';
import { botFor, type BotState } from '../engine/bot.js';
import { CHAIN_LABEL } from './helpers.js';
import { DecisionRow, OpenPositions, native } from './Positions.jsx';
import { CopyCard } from './CopyCard.jsx';

export function BotPanel({ chain, active, onTerminal }: { chain: Chain; active: boolean; onTerminal?: () => void }) {
  const bot = botFor(chain);
  const [st, setSt] = useState<BotState>(() => bot.state());
  useEffect(() => { const off = bot.onChange(() => setSt(bot.state())); const t = setInterval(() => setSt(bot.state()), 5000); return () => { off(); clearInterval(t); }; }, [chain]);

  const what = chain === 'robinhood' ? 'launches' : 'tokens';
  const health = !st.running ? { cls: '', text: 'off' } : !st.connected || st.silenceSec > 35 ? { cls: 'bad', text: st.silenceSec === Infinity ? 'connecting to the hub…' : `no word from the hub for ${Math.round(st.silenceSec)}s: throttled or offline` } : { cls: 'ok', text: `live · ${st.candidatesSeen} ${what} watched · ${st.passingNow} pass your rules right now` };
  const short_ = st.balance !== null && st.balance < st.need;
  const n = (x: bigint, d?: number) => native(chain, x, d);

  return (
    <div class="botpanel">
      <div class={`health ${health.cls}`}>
        <span class={`dot ${health.cls}`} />
        <span>{health.text}</span>
        {st.running && document.visibilityState === 'visible' && !st.wakeLock && <span class="muted small"> · screen may sleep</span>}
        <span class="spacer" />
        {st.balance !== null && <span class={`small ${short_ ? 'warn' : 'muted'}`}>wallet {n(st.balance)} {st.native}{short_ ? ` · a buy needs ${n(st.need)} ${st.native}` : ''}</span>}
        {onTerminal && <a class="small" href="#" onClick={(e) => { e.preventDefault(); onTerminal(); }}>open the terminal →</a>}
      </div>
      {!active && <div class="notice" style="margin-top:10px">Switch the bot on to start watching {what}. Nothing trades while it is off.</div>}
      {short_ && active && <div class="notice bad" style="margin-top:10px">The bot wallet cannot cover one buy plus fees. Deposit more in the Wallet tab, or lower the buy size below. It keeps watching but will not enter.</div>}
      {st.breakerTripped && <div class="notice bad" style="margin-top:10px">Daily loss breaker tripped: no new entries until tomorrow 00:00 UTC. Exits still run.</div>}

      <div class="stats">
        <div><div class="k">open</div><div class="v">{st.open.length}</div></div>
        <div><div class="k">spent today</div><div class="v">{n(st.spentToday, 3)} {st.native}</div></div>
        <div><div class="k">realized today</div><div class={`v ${st.realizedToday > 0n ? 'gain' : st.realizedToday < 0n ? 'loss' : ''}`}>{st.realizedToday >= 0n ? '+' : ''}{n(st.realizedToday, 4)} {st.native}</div></div>
        <div><div class="k">{st.native}</div><div class="v">{st.nativeUsd ? `$${st.nativeUsd.toFixed(st.native === 'SOL' ? 2 : 0)}` : '—'}</div></div>
      </div>

      <OpenPositions open={st.open} />

      <CopyCard chain={chain} wallets={st.copyWallets} signals={st.signals} running={st.running} />

      <div class="decisions">
        <h3>Decisions <span class="muted small">newest first · why the bot did or did not act</span></h3>
        {st.decisions.length === 0 && <div class="muted small">Nothing yet. {chain === 'solana' ? 'pump.fun mints a token every few seconds' : chain === 'robinhood' ? 'Launches arrive every few seconds on Robinhood Chain' : `New pools open on ${CHAIN_LABEL[chain]} every minute or so`}; each one will show here with the rule that stopped it or the buy it caused.</div>}
        {st.decisions.slice(0, 40).map((d, i) => <DecisionRow key={i} d={d} chain={chain} />)}
      </div>
    </div>
  );
}
