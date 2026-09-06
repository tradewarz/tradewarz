// Does this candidate pass this strategy's discovery and safety rules? Pure, fast, and it
// explains itself: every failed rule becomes one sentence a person can read in the Bot
// panel ("liquidity $12k is under your $50k minimum"). The same function drives the
// builder's live preview, so what the preview shows is exactly what the bot would do.

import { ageMinutes, buySellRatio, txnCount, type Candidate } from './candidate.js';
import { WINDOWS, WINDOW_LABEL, type Range, type Strategy, type Window } from './strategy.js';

export interface Evaluation {
  pass: boolean;
  /** Sentences for the rules that failed. Empty when pass is true. */
  reasons: string[];
  /** Rules that could not be checked because the data was missing (informational). */
  unknown: string[];
}

const trim = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const usd = (n: number): string => (n >= 1_000_000 ? `$${trim(n / 1_000_000)}M` : n >= 1000 ? `$${trim(n / 1000)}k` : `$${n.toFixed(0)}`);
const pct = (n: number): string => `${n > 0 ? '+' : ''}${Number.isInteger(n) ? n : n.toFixed(1)}%`;
export function minutesLabel(m: number): string {
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(m < 6 * 60 ? 1 : 0)} h`;
  return `${(m / 1440).toFixed(m < 14 * 1440 ? 1 : 0)} d`;
}

function checkRange(label: string, value: number | null, r: Range, fmt: (n: number) => string, out: Evaluation): void {
  if (r.min === null && r.max === null) return;
  if (value === null) { out.unknown.push(`${label} is unknown`); return; }
  if (r.min !== null && value < r.min) out.reasons.push(`${label} ${fmt(value)} is under your ${fmt(r.min)} minimum`);
  if (r.max !== null && value > r.max) out.reasons.push(`${label} ${fmt(value)} is over your ${fmt(r.max)} maximum`);
}

export function evaluateDiscovery(c: Candidate, s: Strategy, now = Date.now()): Evaluation {
  const out: Evaluation = { pass: true, reasons: [], unknown: [] };
  const d = s.discovery;

  if (c.chain !== s.chain) out.reasons.push(`token is on ${c.chain}, this bot trades ${s.chain}`);

  checkRange('age', ageMinutes(c, now), d.ageMinutes, minutesLabel, out);
  checkRange('liquidity', c.liquidityUsd, d.liquidityUsd, usd, out);
  checkRange('market cap', c.marketCapUsd ?? c.fdvUsd, d.marketCapUsd, usd, out);
  for (const w of WINDOWS) {
    checkRange(`volume in the ${WINDOW_LABEL[w]}`, c.volumeUsd[w], d.volumeUsd[w], usd, out);
    checkRange(`price change in the ${WINDOW_LABEL[w]}`, c.priceChangePct[w], d.priceChangePct[w], pct, out);
  }
  if (d.buySellRatio.min !== null) {
    const r = buySellRatio(c, d.buySellRatio.window as Window);
    if (r === null) out.unknown.push('buys vs sells is unknown');
    else if (r < d.buySellRatio.min) out.reasons.push(`buys vs sells in the ${WINDOW_LABEL[d.buySellRatio.window as Window]} is ${r === Infinity ? 'all buys' : r.toFixed(2)}, under your ${d.buySellRatio.min} minimum`);
  }
  if (d.minTxns.min !== null) {
    const n = txnCount(c, d.minTxns.window as Window);
    if (n === null) out.unknown.push('transaction count is unknown');
    else if (n < d.minTxns.min) out.reasons.push(`${n} transactions in the ${WINDOW_LABEL[d.minTxns.window as Window]}, under your ${d.minTxns.min} minimum`);
  }
  if (d.quoteSymbols.length && !d.quoteSymbols.map((q) => q.toUpperCase()).includes(c.quoteSymbol.toUpperCase())) out.reasons.push(`paired with ${c.quoteSymbol}, you allowed ${d.quoteSymbols.join(', ')}`);
  if (d.requireSocials && !c.hasSocials) out.reasons.push('no website or socials declared');
  if (d.requireBoosted && !c.boosted) out.reasons.push('not boosted on DexScreener');

  const kw = s.advanced.keywords;
  const hay = `${c.name} ${c.symbol}`.toLowerCase();
  if (kw.include.length && !kw.include.some((k) => hay.includes(k.toLowerCase()))) out.reasons.push(`name does not contain any of: ${kw.include.join(', ')}`);
  const hit = kw.exclude.find((k) => hay.includes(k.toLowerCase()));
  if (hit) out.reasons.push(`name contains "${hit}", which you excluded`);
  if (s.advanced.blockedSources.includes(c.source)) out.reasons.push(`found via ${c.source}, which you blocked`);

  // pons v2 launches carry facts of their own; these rules only apply when the facts exist.
  const p = c.pons;
  if (p) {
    const r = s.advanced.pons;
    if (p.devSharePct > r.maxDevSharePct) out.reasons.push(`the launcher kept ${p.devSharePct.toFixed(1)}% of supply, over your ${r.maxDevSharePct}% limit`);
    if (p.exemptWallets > r.maxExemptWallets) out.reasons.push(`${p.exemptWallets} wallets were exempted from the opening tax, over your ${r.maxExemptWallets} limit (a declared bundle)`);
    if (r.requireFeeToDeployer && p.feeToDeployer === false) out.reasons.push('the creator fee goes to a wallet other than the deployer');
    if (r.curveOnly && (p.phase !== 0 || p.graduated || p.readyToGraduate)) out.reasons.push(p.phase === 0 ? 'the curve is closing (ready to graduate)' : 'already graduated off the curve');
    if (p.phase === 1 || p.phase === 3) out.reasons.push('trading is halted between sweep and pool creation');
    const prog = p.progress * 100;
    if (r.progressPct.min !== null && prog < r.progressPct.min) out.reasons.push(`the curve is only ${prog.toFixed(1)}% along, under your ${r.progressPct.min}% floor`);
    if (r.progressPct.max !== null && prog > r.progressPct.max) out.reasons.push(`the curve is ${prog.toFixed(1)}% along, past your ${r.progressPct.max}% ceiling`);
    if (r.maxDeployerPrior !== null) {
      if (p.deployerPrior === null) out.unknown.push('launcher history');
      else if (p.deployerPrior > r.maxDeployerPrior) out.reasons.push(`the launcher has ${p.deployerPrior} prior launches, over your ${r.maxDeployerPrior} limit`);
    }
    if (r.minDeployerGraduated !== null) {
      if (p.deployerGraduated === null) out.unknown.push('launcher graduations');
      else if (p.deployerGraduated < r.minDeployerGraduated) out.reasons.push(`the launcher has ${p.deployerGraduated} graduated launch${p.deployerGraduated === 1 ? '' : 'es'}, under your ${r.minDeployerGraduated} minimum`);
    }
  }

  // pump.fun launches carry their own facts; these rules only apply when the facts exist.
  const q = c.pump;
  if (q) {
    const r = s.advanced.pump;
    if (r.maxDevBuySol !== null && q.devBuySol > r.maxDevBuySol) out.reasons.push(`the creator bought ${q.devBuySol.toFixed(2)} SOL at launch, over your ${r.maxDevBuySol} SOL limit`);
    if (r.maxDevSharePct !== null) {
      if (q.devSharePct === null) out.unknown.push('creator share');
      else if (q.devSharePct > r.maxDevSharePct) out.reasons.push(`the creator holds ${q.devSharePct.toFixed(1)}% of supply, over your ${r.maxDevSharePct}% limit`);
    }
    if (r.curveOnly && q.complete) out.reasons.push('already graduated off the bonding curve');
    if (r.migratedOnly && !q.complete) out.reasons.push('still on the bonding curve; you only buy after graduation');
    const prog = q.progress * 100;
    if (!q.complete) {
      if (r.progressPct.min !== null && prog < r.progressPct.min) out.reasons.push(`the curve is only ${prog.toFixed(1)}% along, under your ${r.progressPct.min}% floor`);
      if (r.progressPct.max !== null && prog > r.progressPct.max) out.reasons.push(`the curve is ${prog.toFixed(1)}% along, past your ${r.progressPct.max}% ceiling`);
    }
    if (r.marketCapSol.min !== null || r.marketCapSol.max !== null) {
      if (q.marketCapSol === null) out.unknown.push('market cap in SOL is unknown');
      else {
        if (r.marketCapSol.min !== null && q.marketCapSol < r.marketCapSol.min) out.reasons.push(`market cap ${q.marketCapSol.toFixed(1)} SOL is under your ${r.marketCapSol.min} SOL minimum`);
        if (r.marketCapSol.max !== null && q.marketCapSol > r.marketCapSol.max) out.reasons.push(`market cap ${q.marketCapSol.toFixed(1)} SOL is over your ${r.marketCapSol.max} SOL maximum`);
      }
    }
    if (r.maxCreatorPrior !== null) {
      if (q.creatorPrior === null) out.unknown.push('creator history');
      else if (q.creatorPrior > r.maxCreatorPrior) out.reasons.push(`the creator has ${q.creatorPrior} prior launches, over your ${r.maxCreatorPrior} limit`);
    }
  }

  // Listing intelligence: how CoinGecko / CoinMarketCap see the coin, when they have seen it at all.
  const l = s.advanced.listing;
  const li = c.listing;
  if (l.onlyListed && !li) out.reasons.push('not a CoinGecko or CoinMarketCap listing; you only trade listings');
  if (li) {
    if (l.minScore !== null && li.score < l.minScore) out.reasons.push(`listing score ${li.score} is under your ${l.minScore} minimum`);
    if (l.requireConfirmed && !li.confirmed) out.reasons.push(`listed on ${li.sources.length === 1 ? (li.sources[0] === 'coingecko' ? 'CoinGecko' : 'CoinMarketCap') + ' only' : 'one catalogue'}; you require both`);
    if (l.verdicts.length && !l.verdicts.includes(li.verdict)) out.reasons.push(`listing verdict is ${li.verdict}, you allowed ${l.verdicts.join(', ')}`);
  }
  evaluateBundle(c, s, out);

  out.pass = out.reasons.length === 0;
  return out;
}

/** The launch-block (bundle) rule. Only launches have a launch block, so it never touches a pool listing. */
export function evaluateBundle(c: Candidate, s: Strategy, out: Evaluation): void {
  const limit = s.advanced.maxBundlePct;
  if (limit === null || !(c.pump || c.pons)) return;
  const b = c.bundle;
  if (!b) {
    if (s.advanced.bundleUnknown === 'wait') out.reasons.push('the launch-block check has not come back yet (your setting waits for it)');
    else out.unknown.push('launch bundle');
    return;
  }
  if (b.supplyPct > limit) out.reasons.push(`${b.wallets} wallet${b.wallets === 1 ? '' : 's'} bought ${b.supplyPct.toFixed(1)}% of supply in the launch ${b.method}, over your ${limit}% limit (a bundle)`);
}

export function evaluateSafety(c: Candidate, s: Strategy): Evaluation {
  const out: Evaluation = { pass: true, reasons: [], unknown: [] };
  const f = s.safety;
  const ev = c.safety;
  const unknown = (what: string) => {
    if (f.onUnknown === 'skip') out.reasons.push(`${what} could not be checked (your safety setting skips unknowns)`);
    else out.unknown.push(`${what} could not be checked`);
  };
  const need = (flag: boolean, value: boolean | null, what: string, bad: string) => {
    if (!flag) return;
    if (value === null || value === undefined) unknown(what);
    else if (!value) out.reasons.push(bad);
  };
  if (!ev) {
    if (f.requireMintRenounced || f.requireFreezeRenounced || f.rejectHoneypot || f.requireLpBurnedOrLocked || f.maxTop10HoldersPct !== null || f.maxSellTaxPct !== null) unknown('safety');
  } else {
    need(f.requireMintRenounced, ev.mintRenounced, 'mint authority', 'the team can still mint more tokens');
    need(f.requireFreezeRenounced, ev.freezeRenounced, 'freeze authority', 'the team can still freeze wallets');
    need(f.requireLpBurnedOrLocked, ev.lpBurnedOrLocked, 'LP lock', 'the liquidity is not burned or locked');
    if (f.rejectHoneypot) { if (ev.honeypot === null) unknown('honeypot status'); else if (ev.honeypot) out.reasons.push('looks like a honeypot: buys work, sells do not'); }
    if (f.maxTop10HoldersPct !== null) { if (ev.top10HoldersPct === null) unknown('holder concentration'); else if (ev.top10HoldersPct > f.maxTop10HoldersPct) out.reasons.push(`top 10 holders own ${ev.top10HoldersPct.toFixed(0)}%, over your ${f.maxTop10HoldersPct}% limit`); }
    if (f.maxSellTaxPct !== null) { if (ev.sellTaxPct === null) unknown('sell tax'); else if (ev.sellTaxPct > f.maxSellTaxPct) out.reasons.push(`sell tax is ${ev.sellTaxPct}%, over your ${f.maxSellTaxPct}% limit`); }
  }
  out.pass = out.reasons.length === 0;
  return out;
}

/** Discovery and safety together: the single answer the bot and the preview use. */
export function evaluate(c: Candidate, s: Strategy, now = Date.now()): Evaluation {
  const a = evaluateDiscovery(c, s, now);
  const b = evaluateSafety(c, s);
  return { pass: a.pass && b.pass, reasons: [...a.reasons, ...b.reasons], unknown: [...a.unknown, ...b.unknown] };
}
