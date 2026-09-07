// Open positions and the decision log, shared by the Bot panel and the Terminal. The token
// name is a link: DexScreener first, the explorer beside it. Works for either chain: a position
// knows its chain, and the numbers are formatted in that chain's coin.

import { useState } from 'preact/hooks';
import type { Chain } from '@tradewarz/shared';
import { describeError } from '../api.js';
import { botFor, type Decision } from '../engine/bot.js';
import type { Position } from '../engine/store.js';
import { CHAIN_LABEL, NATIVE, short } from './helpers.js';
import { dexscreenerUrl, explorerTokenUrl, explorerTxUrl } from './links.js';
import { toast } from './toast.js';

/** A smallest-unit amount (wei / lamports) as a decimal in the chain's coin. */
export const native = (chain: Chain, x: bigint, d = 4): string => (Number(x) / (chain === 'solana' ? 1e9 : 1e18)).toFixed(d);
/** Same, with the coin's name. */
export const money = (chain: Chain, x: bigint, d = 4): string => `${native(chain, x, d)} ${NATIVE[chain]}`;
export const ago = (t: number): string => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };
export const gainPct = (p: Position): number => {
  const basis = (BigInt(p.entryWei) * BigInt(p.tokens)) / BigInt(p.tokensAtEntry || p.tokens || '1');
  return basis > 0n ? Number(((BigInt(p.lastWei) - basis) * 10_000n) / basis) / 100 : 0;
};
export const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function OpenPositions({ open, compact }: { open: Position[]; compact?: boolean }) {
  const [selling, setSelling] = useState<string | null>(null);
  const sellNow = async (p: Position) => {
    if (!confirm(`Sell all ${p.symbol} now at the current price?`)) return;
    setSelling(p.id);
    try { await botFor(p.chain).sellNow(p.id); toast(`${p.symbol} sold`); } catch (e) { toast(describeError(e), 'bad'); } finally { setSelling(null); }
  };
  const remove = async (p: Position) => {
    if (!confirm(`Remove ${p.symbol} from your open positions?\n\nNothing is sold: the tokens stay in the bot wallet, and the ${money(p.chain, BigInt(p.entryWei))} you put in is booked as a loss today. Use this when a token has no market left.`)) return;
    try { await botFor(p.chain).writeOff(p.id, 'removed by hand'); toast(`${p.symbol} removed`); } catch (e) { toast(describeError(e), 'bad'); }
  };
  const manage = async (p: Position, on: boolean) => {
    const bot = botFor(p.chain);
    if (on && !bot.running) { toast('Switch the bot on first; until then this stays hand-held', 'bad'); return; }
    try { await bot.setManaged(p.id, on); } catch (e) { toast(describeError(e), 'bad'); }
  };
  if (open.length === 0) return compact ? <div class="muted small">No open positions.</div> : null;
  return (
    <div class="positions">
      {!compact && <h3>Open positions</h3>}
      {open.map((p) => {
        const g = gainPct(p);
        return (
          <div class="pos" key={p.id}>
            <div class="sym">
              <a href={dexscreenerUrl(p.chain, p.token)} target="_blank" rel="noopener" title="Open on DexScreener">{p.symbol}</a>
              <span class="muted small"> · {CHAIN_LABEL[p.chain]} · {ago(p.openedAt)} · {p.venue}</span>
              {p.manual && <span class="pill" title="bought by hand from the Terminal" style="margin-left:6px">by hand</span>}
              {p.copiedFrom && <span class="pill" title={`copied from ${p.copiedFrom}`} style="margin-left:6px">copied {p.copyLabel || `${p.copiedFrom.slice(0, 4)}…${p.copiedFrom.slice(-4)}`}</span>}
              {p.managed === false && <span class="pill warn" title="the bot prices it but will not sell it; only you do" style="margin-left:4px">hand-held</span>}
            </div>
            <div class={`pnl ${g > 0 ? 'gain' : g < 0 ? 'loss' : ''}`}>{g >= 0 ? '+' : ''}{g.toFixed(1)}%</div>
            <div class="meta">in {money(p.chain, BigInt(p.entryWei))} · now {money(p.chain, BigInt(p.lastWei))} · peak {money(p.chain, BigInt(p.peakWei))}{p.ladderDone.length ? ` · ladder ${p.ladderDone.length} step${p.ladderDone.length > 1 ? 's' : ''} done` : ''}
              <span class="spacer" />
              <a class="small" href={dexscreenerUrl(p.chain, p.token)} target="_blank" rel="noopener">DexScreener</a>
              <a class="small" href={explorerTokenUrl(p.chain, p.token)} target="_blank" rel="noopener">explorer</a>
              {p.managed === false
                ? <a class="small" href="#" title="hand it to the bot's exits (stop loss, ladder, take profit)" onClick={(e) => { e.preventDefault(); void manage(p, true); }}>let the bot manage</a>
                : <a class="small" href="#" title="the bot will stop selling this one; you decide" onClick={(e) => { e.preventDefault(); void manage(p, false); }}>hold by hand</a>}
              <button class="btn sm danger" disabled={selling === p.id} onClick={() => sellNow(p)}>{selling === p.id ? 'Selling…' : 'Sell now'}</button>
              <a class="small" href="#" title="take it off the books without selling (for a token that has no market left)" onClick={(e) => { e.preventDefault(); void remove(p); }}>remove</a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DecisionRow({ d, chain, onPick }: { d: Decision; chain: Chain; onPick?: (token: string) => void }) {
  // "skip" on purpose: an earlier build said "pass" here, which read as "passes the rules".
  const label = d.verdict === 'buy' ? 'BUY' : d.verdict === 'exit' ? 'SELL' : d.verdict === 'hold' ? 'wait' : d.verdict === 'error' ? 'error' : d.verdict === 'info' ? '·' : 'skip';
  return (
    <div class={`dec ${d.verdict}`}>
      <span class="t">{clock(d.at)}</span>
      <span class={`tag ${d.verdict}`}>{label}</span>
      {onPick && d.token ? <a class="sym" href="#" onClick={(e) => { e.preventDefault(); onPick(d.token); }}>{d.symbol}</a> : <span class="sym">{d.symbol}</span>}
      <span class="why">{d.reasons.join('; ')}{d.tx ? <> · <a href={explorerTxUrl(chain, d.tx)} target="_blank" rel="noopener">tx {short(d.tx, 4)}</a></> : null}</span>
    </div>
  );
}
