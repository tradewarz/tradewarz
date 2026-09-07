// A strategy read back as sentences. The builder shows these live so a person can
// check that the numbers say what they meant.

import { minutesLabel } from './evaluate.js';
import { CHAIN_NAME, NATIVE_SYMBOL, WINDOWS, WINDOW_LABEL, type Range, type Strategy } from './strategy.js';

const usd = (n: number): string => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`);

function rangeWords(r: Range, fmt: (n: number) => string): string | null {
  if (r.min !== null && r.max !== null) return `between ${fmt(r.min)} and ${fmt(r.max)}`;
  if (r.min !== null) return `at least ${fmt(r.min)}`;
  if (r.max !== null) return `at most ${fmt(r.max)}`;
  return null;
}

export function describeStrategy(s: Strategy): string[] {
  const out: string[] = [];
  const d = s.discovery, native = NATIVE_SYMBOL[s.chain];
  const parts: string[] = [];
  const age = rangeWords(d.ageMinutes, minutesLabel);
  if (age) parts.push(`${age} old`);
  const liq = rangeWords(d.liquidityUsd, usd);
  if (liq) parts.push(`with ${liq} of liquidity`);
  const mc = rangeWords(d.marketCapUsd, usd);
  if (mc) parts.push(`a market cap ${mc}`);
  for (const w of WINDOWS) {
    const v = rangeWords(d.volumeUsd[w], usd);
    if (v) parts.push(`${v} traded in the ${WINDOW_LABEL[w]}`);
  }
  for (const w of WINDOWS) {
    const p = rangeWords(d.priceChangePct[w], (n) => `${n}%`);
    if (p) parts.push(`a price change ${p} in the ${WINDOW_LABEL[w]}`);
  }
  if (d.buySellRatio.min !== null) parts.push(`at least ${d.buySellRatio.min} buys per sell in the ${WINDOW_LABEL[d.buySellRatio.window]}`);
  if (d.minTxns.min !== null) parts.push(`at least ${d.minTxns.min} transactions in the ${WINDOW_LABEL[d.minTxns.window]}`);
  if (d.quoteSymbols.length) parts.push(`paired with ${d.quoteSymbols.join(' or ')}`);
  if (d.requireSocials) parts.push('that declare a website or socials');
  if (d.requireBoosted) parts.push('that are boosted on DexScreener');
  out.push(parts.length ? `Buy ${CHAIN_NAME[s.chain]} tokens ${parts.join(', ')}.` : `Buy any ${CHAIN_NAME[s.chain]} token the hub finds.`);

  const f = s.safety, safe: string[] = [];
  if (f.requireMintRenounced) safe.push('can be minted');
  if (f.requireFreezeRenounced) safe.push('can freeze wallets');
  if (f.rejectHoneypot) safe.push('cannot be sold');
  if (f.requireLpBurnedOrLocked) safe.push('has unlocked liquidity');
  if (f.maxTop10HoldersPct !== null) safe.push(`has its top 10 holders above ${f.maxTop10HoldersPct}%`);
  if (f.maxSellTaxPct !== null) safe.push(`taxes sells above ${f.maxSellTaxPct}%`);
  if (safe.length) out.push(`Skip anything that ${safe.join(', ')}${f.onUnknown === 'skip' ? ', or that cannot be checked' : ''}.`);

  const e = s.entry;
  const style = e.style === 'instant' ? 'as soon as it qualifies' : e.style === 'pullback' ? `once it has pulled back ${e.pullback.minPct}–${e.pullback.maxPct}% from its high within ${e.pullback.windowMinutes} minutes` : `when it breaks its ${e.breakout.lookbackMinutes}-minute high`;
  out.push(`Spend ${e.sizeNative} ${native} per trade ${style}, at most ${e.maxOpenPositions} open at once and ${e.dailyBudgetNative} ${native} a day, with ${e.slippagePct}% slippage. Leave a token alone for ${minutesLabel(e.reentryCooldownMinutes)} after closing it.`);

  const x = s.exits, ex: string[] = [];
  for (const step of x.ladder) ex.push(`sell ${step.sellPct}% at +${step.atGainPct}%`);
  if (x.takeProfitPct !== null) ex.push(`take profit at +${x.takeProfitPct}%`);
  if (x.trailingPct !== null) ex.push(`trail the rest ${x.trailingPct}% below the peak`);
  ex.push(`stop out at −${x.stopLossPct}%`);
  if (x.maxHoldMinutes !== null) ex.push(`get out after ${minutesLabel(x.maxHoldMinutes)} no matter what`);
  ex.push(`and dump immediately if the pool loses ${x.liquidityDrainExitPct}% of its liquidity`);
  out.push(`Then ${ex.join(', ')}.`);

  const a = s.advanced, adv: string[] = [];
  if (a.dipAdd.enabled) adv.push(`add up to ${a.dipAdd.maxAdds} more buy${a.dipAdd.maxAdds > 1 ? 's' : ''} on dips of ${a.dipAdd.bandMinPct}–${a.dipAdd.bandMaxPct}% off the peak`);
  if (a.keywords.include.length) adv.push(`only names containing ${a.keywords.include.join(', ')}`);
  if (a.keywords.exclude.length) adv.push(`never names containing ${a.keywords.exclude.join(', ')}`);
  if (adv.length) out.push(`Advanced: ${adv.join('; ')}.`);
  if (s.chain === 'robinhood') {
    const p = a.pons;
    out.push(`On pons launches: wait until the opening tax is under ${(p.maxOpeningTaxBps / 100).toFixed(p.maxOpeningTaxBps % 100 ? 1 : 0)}% (give up after ${(p.maxTaxWaitMs / 1000).toFixed(0)} s), skip launchers keeping more than ${p.maxDevSharePct}% of supply or exempting more than ${p.maxExemptWallets} wallet${p.maxExemptWallets === 1 ? '' : 's'}${p.requireFeeToDeployer ? ', require the creator fee to go to the deployer' : ''}${p.curveOnly ? ', and only buy while the token is still on the curve' : ''}.`);
    const extra: string[] = [];
    if (p.progressPct.min !== null || p.progressPct.max !== null) extra.push(p.progressPct.min !== null && p.progressPct.max !== null ? `the curve is ${p.progressPct.min}–${p.progressPct.max}% along` : p.progressPct.min !== null ? `the curve is at least ${p.progressPct.min}% along` : `the curve is under ${p.progressPct.max}% along`);
    if (p.maxDeployerPrior !== null) extra.push(`the launcher has at most ${p.maxDeployerPrior} prior launch${p.maxDeployerPrior === 1 ? '' : 'es'}`);
    if (p.minDeployerGraduated !== null) extra.push(`the launcher has at least ${p.minDeployerGraduated} graduated launch${p.minDeployerGraduated === 1 ? '' : 'es'}`);
    if (extra.length) out.push(`Only when ${extra.join(', and ')}.`);
  }
  if (s.chain === 'solana') {
    const q = a.pump, pump: string[] = [];
    if (q.maxDevBuySol !== null) pump.push(`skip creators who bought more than ${q.maxDevBuySol} SOL at launch`);
    if (q.maxDevSharePct !== null) pump.push(`or who hold more than ${q.maxDevSharePct}% of supply`);
    if (q.curveOnly) pump.push('only buy while the token is still on the bonding curve');
    if (q.migratedOnly) pump.push('only buy once it has graduated to a pool');
    const prog = rangeWords(q.progressPct, (n) => `${n}%`);
    if (prog) pump.push(`only when the curve is ${prog} along`);
    const mcs = rangeWords(q.marketCapSol, (n) => `${n} SOL`);
    if (mcs) pump.push(`with a market cap ${mcs}`);
    if (q.maxCreatorPrior !== null) pump.push(`and at most ${q.maxCreatorPrior} prior launch${q.maxCreatorPrior === 1 ? '' : 'es'} by the creator`);
    if (pump.length) out.push(`On pump.fun launches: ${pump.join(', ')}.`);
  if (a.maxBundlePct !== null) out.push(`Skip bundled launches: more than ${a.maxBundlePct}% of supply bought by other wallets in the launch block${a.bundleUnknown === 'wait' ? ', and wait for that check before buying' : ''}.`);
  }
  const cp = s.copy;
  if (cp.wallets.length) {
    const names = cp.wallets.map((w) => w.label || `${w.address.slice(0, 4)}…${w.address.slice(-4)}`);
    out.push(`Copy ${names.join(', ')}: buy what they buy within ${cp.maxAgeSec} s of their trade, with your size and ${cp.applyDiscovery ? 'all of your rules' : 'your safety rules only'}${cp.copySells ? ', and sell the same share when they sell' : ''}${cp.followOnly ? '. Trade nothing else' : ''}.`);
  }
  const l = a.listing, listing: string[] = [];
  if (l.onlyListed) listing.push('only coins that arrived through a CoinGecko or CoinMarketCap listing');
  if (l.minScore !== null) listing.push(`a listing score of at least ${l.minScore}`);
  if (l.requireConfirmed) listing.push('confirmed on both catalogues');
  if (l.verdicts.length) listing.push(`a verdict of ${l.verdicts.join(' or ')}`);
  if (listing.length) out.push(`Listings: ${listing.join(', ')}.`);
  return out;
}
