// Your data, yours to take: the trade log as CSV, and a "review pack" - your rules, your trades, the
// bots' recent decisions and open positions, written so that any AI (or a person) can read it and
// say what is working. Built in the browser from the hub's record of your trades plus what this
// tab knows; nothing here is sent anywhere unless you paste it somewhere yourself.

import { useState } from 'preact/hooks';
import { CHAINS, GUARDRAILS, describeStrategy, type Chain, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { bots } from '../engine/bot.js';
import { CHAIN_LABEL, copyText } from './helpers.js';
import { toast } from './toast.js';

export interface MyTrade {
  week: string; chain: Chain; symbol: string; token: string;
  openedAt: number; closedAt: number; holdMin: number;
  costUsd: number; proceedsUsd: number; pnlUsd: number; returnPct: number;
  strategy: string; rulesSavedAt: number | null; manual: boolean; copied?: boolean;
  volumeShare: number | null; selfDeployed: boolean; entryTx: string; exitTx: string;
}
export interface MyVersion { id: string; strategyId: string; chain: Chain; name: string; savedAt: number; strategy: unknown }
export interface MyTradesView { trades: MyTrade[]; versions: MyVersion[] }

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const when = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** The pack, as Markdown. Deterministic and plain so it pastes cleanly into any chat window. */
export function reviewPack(handle: string, strategies: StrategyRecord[], data: MyTradesView): string {
  const out: string[] = [];
  const trades = data.trades;
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const deployed = trades.reduce((a, t) => a + t.costUsd, 0);
  const pnl = trades.reduce((a, t) => a + t.pnlUsd, 0);
  out.push(`# TradeWarz review pack — ${handle} — ${when(Date.now())}`);
  out.push('');
  out.push('Paste this whole document into an AI assistant and ask, for example: "Review my trading. Tell me what is working, what is not, and suggest specific changes to my rules, using the rule names below."');
  out.push('');
  out.push('## How TradeWarz works (context for the reader)');
  out.push('- I run one automated trading bot per chain (Solana, Robinhood Chain, Base, BNB Chain). Each bot follows rules I set: discovery filters (age, liquidity, market cap, volume, price change, buy/sell ratio, transaction counts), safety checks on the token contract, entry (size, budget, style, slippage), exits (take profit, stop loss, trailing stop, ladder steps, max hold time, liquidity-drain exit) and launch rules (creator\'s share, launch-block bundle, curve progress, launcher history).');
  out.push(`- Guardrails I cannot loosen: stop loss at most ${GUARDRAILS.stopLossMaxPct}%, liquidity-drain exit at or before ${GUARDRAILS.liquidityDrainExitMaxPct}% of the pool leaving, no buy above ${GUARDRAILS.maxBuyPctOfPoolLiquidity}% of pool liquidity, a daily loss breaker, at most ${GUARDRAILS.maxOpenPositions} open positions per chain, slippage under ${GUARDRAILS.slippageMaxPct}%.`);
  out.push('- A "closed trade" is a full round trip (buy to final sell) read from the blockchain. "by hand" means I bought it manually from the scanner; "(copied)" means the bot bought it because a wallet I follow bought it (copy trading), with my own size and exits. A "write-off" is a position I removed because the token had no market left (a total loss).');
  out.push('- Decisions are the bot\'s log: "skip" = the token failed a rule (the reason names the rule), "hold" = passed but waiting, "buy"/"exit" = trades, "error" = something failed.');
  out.push('');
  out.push('## My current rules');
  for (const r of strategies) {
    out.push(`### ${CHAIN_LABEL[r.chain]} — "${r.strategy.name}" (${r.active ? 'switched on' : 'switched off'})`);
    for (const s of describeStrategy(r.strategy)) out.push(`- ${s}`);
    out.push('');
  }
  if (!strategies.length) out.push('(no bots set up yet)\n');
  out.push('## Summary');
  out.push(`- Closed trades: ${trades.length} · wins: ${wins} (${trades.length ? Math.round((wins / trades.length) * 100) : 0}%) · capital deployed: ${usd(deployed)} · net: ${usd(pnl)} · return on deployed: ${deployed ? ((pnl / deployed) * 100).toFixed(1) : '0.0'}%`);
  const byStrat = new Map<string, MyTrade[]>();
  for (const t of trades) { const k = `${CHAIN_LABEL[t.chain]} / ${t.strategy}${t.copied ? ' (copied)' : ''}`; byStrat.set(k, [...(byStrat.get(k) ?? []), t]); }
  for (const [k, list] of byStrat) {
    const w = list.filter((t) => t.pnlUsd > 0).length; const d = list.reduce((a, t) => a + t.costUsd, 0); const p = list.reduce((a, t) => a + t.pnlUsd, 0);
    out.push(`- ${k}: ${list.length} trades · ${w} wins · net ${usd(p)} · return ${d ? ((p / d) * 100).toFixed(1) : '0.0'}% · avg hold ${Math.round(list.reduce((a, t) => a + t.holdMin, 0) / list.length)} min`);
  }
  out.push('');
  out.push(`## Closed trades (${trades.length}, newest first)`);
  out.push('| closed (UTC) | chain | token | rules | in | out | net | return | held |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const t of trades.slice(0, 400)) out.push(`| ${when(t.closedAt)} | ${CHAIN_LABEL[t.chain]} | ${t.symbol || t.token.slice(0, 8)} | ${t.strategy}${t.copied ? ' (copied)' : ''} | ${usd(t.costUsd)} | ${usd(t.proceedsUsd)} | ${usd(t.pnlUsd)} | ${t.returnPct > 0 ? '+' : ''}${t.returnPct.toFixed(1)}% | ${t.holdMin} min |`);
  out.push('');
  // What this tab knows and the hub does not: why the bot did what it did, and what is still open.
  const decisions = CHAINS.flatMap((c) => bots[c].state().decisions.map((d) => ({ ...d, chain: c }))).sort((a, b) => b.at - a.at).slice(0, 200);
  out.push(`## Recent bot decisions (${decisions.length}, newest first)`);
  for (const d of decisions) out.push(`- ${when(d.at)} · ${CHAIN_LABEL[d.chain]} · ${d.verdict.toUpperCase()} ${d.symbol}: ${d.reasons.join('; ')}`);
  out.push('');
  const open = CHAINS.flatMap((c) => bots[c].state().open);
  out.push(`## Open positions (${open.length})`);
  for (const p of open) {
    const b = bots[p.chain];
    out.push(`- ${CHAIN_LABEL[p.chain]} ${p.symbol}: in ${b.state().native} ${Number(BigInt(p.entryWei)) / 10 ** b.state().decimals}, now ${Number(BigInt(p.lastWei)) / 10 ** b.state().decimals}, opened ${when(p.openedAt)}${p.manual ? ' (by hand)' : ''}${p.managed === false ? ' (hand-held)' : ''}`);
  }
  out.push('');
  out.push('## Rule versions I have saved');
  for (const v of data.versions) out.push(`- ${when(v.savedAt)} · ${CHAIN_LABEL[v.chain]} · "${v.name}"`);
  return out.join('\n');
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function MyData({ handle, strategies }: { handle: string; strategies: StrategyRecord[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const pack = async (): Promise<string> => reviewPack(handle, strategies, await api.myTrades());
  const doPack = async () => { setBusy('pack'); try { download(`tradewarz-review-${stamp}.md`, await pack(), 'text/markdown'); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); } };
  const doCopy = async () => { setBusy('copy'); try { const ok = await copyText(await pack()); toast(ok ? 'Review pack copied — paste it into any AI chat' : 'Could not copy; use the download instead', ok ? 'ok' : 'bad'); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); } };
  return (
    <section class="card mydata">
      <h2>Your data</h2>
      <p class="lede">Everything the site knows about your trading is yours to take. The review pack is written for pasting into any AI — ChatGPT, Claude, Gemini, a local model — so you can ask what is working and what to change, on whatever subscription you already have.</p>
      <div class="btnrow wrap">
        <button class="btn primary" disabled={busy !== null} onClick={() => void doCopy()}>{busy === 'copy' ? 'Building…' : 'Copy review pack for AI'}</button>
        <button class="btn" disabled={busy !== null} onClick={() => void doPack()}>{busy === 'pack' ? 'Building…' : 'Download review pack (.md)'}</button>
        <a class="btn" href="/api/me/trades?format=csv">Download trades (.csv)</a>
      </div>
      <p class="muted small" style="margin:8px 0 0">The pack holds your rules in words, every closed trade with its result, the bots' recent decisions with the rule that caused each, your open positions and your saved rule versions. It never contains keys, phrases or addresses of your wallets beyond what is already public on-chain.</p>
    </section>
  );
}
