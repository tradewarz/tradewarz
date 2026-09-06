// Buy by hand. Open it on a row the hub is showing, on a coin you starred, or on a pasted address.
// You choose the amount and the slippage; the bot wallet signs; and you decide whether the running
// bot manages the exits or you hold it yourself. The same guardrails as the bot's own buys apply:
// a fee reserve stays in the wallet and one buy can't be more than 2% of the pool's liquidity.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { GUARDRAILS, buyWithinPoolLimit, emptyTxns, emptyWindows, pumpQuoteBuy, quoteBuy, type Candidate, type Chain, type StrategyRecord } from '@tradewarz/shared';
import { describeError } from '../api.js';
import { botFor } from '../engine/bot.js';
import { hubStream } from '../engine/stream.js';
import { CHAIN_LABEL, NATIVE, short } from './helpers.js';
import { dexscreenerUrl } from './links.js';
import { toast } from './toast.js';

/** A candidate for an address the hub knows nothing about. The adapters route it by asking the chain. */
export function stubCandidate(chain: Chain, address: string, hint: { symbol?: string; name?: string } = {}): Candidate {
  return {
    chain, address, pairAddress: '', dexId: 'unknown', symbol: hint.symbol || short(address, 4), name: hint.name ?? '', quoteSymbol: NATIVE[chain],
    createdAt: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, priceUsd: null, priceNative: null,
    volumeUsd: emptyWindows(), priceChangePct: emptyWindows(), txns: emptyTxns(), hasSocials: false, boosted: false,
    source: 'manual', safety: null, updatedAt: Date.now(),
  };
}

const usd = (n: number | null): string => (n === null ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);

export function TradeDialog({ target, strategies, onClose, onBought }: { target: Candidate; strategies: StrategyRecord[]; onClose: () => void; onBought?: (positionId: string) => void }) {
  const chain = target.chain;
  const bot = botFor(chain);
  const record = strategies.find((s) => s.chain === chain && s.active) ?? strategies.find((s) => s.chain === chain) ?? null;
  const [amount, setAmount] = useState<string>(String(record?.strategy.entry.sizeNative ?? (chain === 'solana' ? 0.05 : 0.005)));
  const [slippage, setSlippage] = useState<string>(String(record?.strategy.entry.slippagePct ?? (chain === 'solana' ? 8 : 3)));
  const [manage, setManage] = useState<boolean>(bot.running);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState(() => bot.state());
  useEffect(() => { const off = bot.onChange(() => setSt(bot.state())); return off; }, [chain]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, busy]);

  // The hub may still be learning about a pasted address: follow the live copy when one appears.
  const live = hubStream.candidate(chain, target.address) ?? target;
  const size = Number(amount);
  const slip = Number(slippage);
  const native = NATIVE[chain];
  const nativeUsd = chain === 'solana' ? hubStream.solUsd : hubStream.ethUsd;
  const sizeUsd = nativeUsd && size > 0 ? size * nativeUsd : null;
  const decimals = chain === 'solana' ? 1e9 : 1e18;
  const balance = st.balance === null ? null : Number(st.balance) / decimals;
  const reserve = Number(bot.a.gasReserve) / decimals;
  const tooPoor = balance !== null && size > 0 && size + reserve > balance;
  const cap = nativeUsd && live.liquidityUsd !== null && size > 0 ? buyWithinPoolLimit(size * nativeUsd, live.liquidityUsd) : null;

  const estimate = useMemo(() => {
    if (!(size > 0)) return null;
    if (live.pump && !live.pump.complete) {
      const tokens = pumpQuoteBuy({ vSol: live.pump.vSol, vTokens: live.pump.vTokens, realSol: live.pump.realSol, realTokens: null, complete: false }, size);
      return `≈ ${(tokens / 1e6).toFixed(2)}M tokens on the curve`;
    }
    if (live.pons && live.pons.phase === 0) {
      try {
        const s = { quoteReserve: BigInt(live.pons.quoteReserve), tokenReserve: BigInt(live.pons.tokenReserve), realQuoteReserve: BigInt(live.pons.realQuoteReserve), sellableTokens: 0n, reservedTokens: 0n, graduationThreshold: 0n, feeBps: BigInt(live.pons.feeBps), creatorTaxBps: BigInt(live.pons.creatorTaxBps), openingTaxBps: BigInt(live.pons.openingTaxBps), graduated: false, readyToGraduate: false, launchedAt: 0, readAtMs: Date.now() };
        const q = quoteBuy(s, BigInt(Math.round(size * 1e18)));
        return `≈ ${(Number(q.tokensOut) / 1e24).toFixed(2)}M tokens on the curve${live.pons.openingTaxBps > 0 ? ` · opening tax ${(live.pons.openingTaxBps / 100).toFixed(0)}% right now` : ''}`;
      } catch { return null; }
    }
    if (live.priceNative) return `≈ ${(size / live.priceNative).toLocaleString('en-US', { maximumFractionDigits: 0 })} tokens at the last price`;
    return null;
  }, [live, size]);

  const buy = async () => {
    if (!(size > 0)) { toast('Enter an amount', 'bad'); return; }
    if (!confirm(`Buy ${size} ${native}${sizeUsd ? ` (about $${sizeUsd.toFixed(2)})` : ''} of ${live.symbol || short(live.address, 4)} on ${CHAIN_LABEL[chain]}?${manage && bot.running ? '' : '\n\nThe bot will not sell this for you — hand-held until you press Sell.'}`)) return;
    setBusy(true);
    try {
      const pos = await bot.buyNow(live, size, { slippagePct: Number.isFinite(slip) && slip > 0 ? slip : 5, manage });
      toast(`Bought ${live.symbol || short(live.address, 4)}`);
      onBought?.(pos.id);
      onClose();
    } catch (e) {
      toast(describeError(e), 'bad');
    } finally { setBusy(false); }
  };

  return (
    <div class="modal-back" onClick={() => { if (!busy) onClose(); }}>
      <div class="modal trade" role="dialog" aria-label="Buy" onClick={(e) => e.stopPropagation()}>
        <div class="drawer-head">
          <div>
            <h3 style="margin:0">Buy {live.symbol || short(live.address, 4)} <span class={`chip ${chain}`}>{CHAIN_LABEL[chain]}</span></h3>
            <div class="muted small mono">{short(live.address, 8)}{live.name ? ` · ${live.name}` : ''}</div>
          </div>
          <button class="btn sm" onClick={onClose} disabled={busy}>Close</button>
        </div>

        <div class="tfacts muted small">
          <span>price {live.priceUsd !== null ? `$${live.priceUsd.toPrecision(3)}` : '—'}</span>
          <span>liquidity {usd(live.liquidityUsd)}</span>
          <span>mcap {usd(live.marketCapUsd ?? live.fdvUsd)}</span>
          <span>{live.dexId === 'unknown' ? 'not in the hub’s feed — routed by asking the chain' : `via ${live.source} · ${live.dexId}`}</span>
          <a href={dexscreenerUrl(chain, live.address)} target="_blank" rel="noopener">DexScreener ↗</a>
        </div>

        <div class="trow">
          <label class="field"><span>Amount ({native})</span>
            <input class="input lg" type="number" inputMode="decimal" step={chain === 'solana' ? 0.01 : 0.001} min={0} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field"><span>Slippage (%)</span>
            <input class="input lg" type="number" inputMode="decimal" step={0.5} min={0.1} max={50} value={slippage} onInput={(e) => setSlippage((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="btnrow">
          {(chain === 'solana' ? [0.02, 0.05, 0.1, 0.25, 0.5] : [0.002, 0.005, 0.01, 0.02, 0.05]).map((v) => <button key={v} class={`btn sm${Number(amount) === v ? ' primary' : ''}`} onClick={() => setAmount(String(v))}>{v}</button>)}
          {record && <button class="btn sm" onClick={() => setAmount(String(record.strategy.entry.sizeNative))}>bot size ({record.strategy.entry.sizeNative})</button>}
        </div>

        <div class="small stack" style="gap:6px">
          <div class="muted">{sizeUsd !== null ? `about $${sizeUsd.toFixed(2)}` : ''}{estimate ? ` · ${estimate}` : ''}</div>
          <div class={tooPoor ? 'loss' : 'muted'}>wallet {balance === null ? '…' : `${balance.toFixed(4)} ${native}`} · {reserve} {native} stays back for fees{tooPoor ? ' — not enough for this buy' : ''}</div>
          {cap && !cap.ok && <div class="notice bad small">This is more than {GUARDRAILS.maxBuyPctOfPoolLiquidity}% of the pool's liquidity; at most about ${cap.maxUsd.toFixed(0)} here. Lower the amount.</div>}
          {live.safety?.honeypot && <div class="notice bad small">This token looks like a honeypot: buys work, sells do not.</div>}
        </div>

        <label class="check">
          <input type="checkbox" checked={manage && bot.running} disabled={!bot.running} onChange={(e) => setManage((e.target as HTMLInputElement).checked)} />
          <span>Let the bot manage the exits{bot.running && record ? ` (${record.strategy.name}: stop loss −${record.strategy.exits.stopLossPct}%${record.strategy.exits.takeProfitPct !== null ? `, take profit +${record.strategy.exits.takeProfitPct}%` : ''}, drain exit)` : ''}{!bot.running ? ' — switch the bot on first; until then this is hand-held' : ''}</span>
        </label>

        <div class="btnrow">
          <button class="btn primary lg" disabled={busy || !(size > 0) || tooPoor || (cap !== null && !cap.ok)} onClick={buy}>{busy ? 'Buying…' : `Buy ${size > 0 ? size : ''} ${native}`}</button>
          <button class="btn lg" onClick={onClose} disabled={busy}>Cancel</button>
          <span class="spacer" />
        </div>
        {st.lastError && <div class="notice bad small" style="overflow-wrap:anywhere">Last error: {st.lastError}</div>}
        <p class="muted small" style="margin:0">Signed by your bot wallet in this tab. Counts toward today's spend and, once sold, toward your leaderboard week like any other trade.</p>
      </div>
    </div>
  );
}
