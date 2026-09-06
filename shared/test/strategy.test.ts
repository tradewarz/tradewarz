import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESET_NAMES, preset, presetInput } from '../src/presets.js';
import { parseStrategy } from '../src/strategy.js';
import { GUARDRAILS, buyWithinPoolLimit, dailyBreakerTripped, guardrailViolations } from '../src/guardrails.js';
import { describeStrategy } from '../src/describe.js';
import { evaluate } from '../src/evaluate.js';
import { emptyTxns, emptyWindows, type Candidate } from '../src/candidate.js';

test('every preset parses and passes the guardrails on both chains', () => {
  for (const chain of ['solana', 'robinhood'] as const) {
    for (const name of PRESET_NAMES) {
      const s = preset(name, chain);
      assert.equal(s.chain, chain);
      assert.deepEqual(guardrailViolations(s), [], `${name}/${chain}`);
      const sentences = describeStrategy(s);
      assert.ok(sentences.length >= 3, 'describes itself');
      assert.match(sentences[0]!, /^Buy /);
    }
  }
});

test('a strategy that loosens a rail is refused with a sentence naming the rail', () => {
  const input = presetInput('balanced', 'solana');
  input.exits!.stopLossPct = 95;
  input.exits!.liquidityDrainExitPct = 60;
  input.entry!.maxOpenPositions = 50;
  const parsed = parseStrategy(input);
  assert.ok(parsed.ok);
  const v = guardrailViolations(parsed.strategy);
  const paths = v.map((x) => x.path);
  assert.ok(paths.includes('exits.stopLossPct'));
  assert.ok(paths.includes('exits.liquidityDrainExitPct'));
  assert.ok(paths.includes('entry.maxOpenPositions'));
  assert.match(v.find((x) => x.path === 'exits.stopLossPct')!.message, /at most 90%/);
});

test('missing stop loss or drain exit fails at parse time (they are required fields)', () => {
  const input: any = presetInput('degen', 'solana');
  delete input.exits.stopLossPct;
  const r = parseStrategy(input);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.problems.some((p) => p.startsWith('exits.stopLossPct')));
});

test('daily budget smaller than one buy is refused', () => {
  const input = presetInput('conservative', 'robinhood');
  input.entry!.dailyBudgetNative = 0.001;
  const s = parseStrategy(input);
  assert.ok(s.ok);
  assert.ok(guardrailViolations(s.strategy).some((v) => v.path === 'entry.dailyBudgetNative'));
});

test('trade-time rails', () => {
  assert.equal(buyWithinPoolLimit(100, 50_000).ok, true);
  assert.equal(buyWithinPoolLimit(2_000, 50_000).ok, false);
  assert.equal(buyWithinPoolLimit(2_000, 50_000).maxUsd, 1_000);
  assert.equal(GUARDRAILS.maxBuyPctOfPoolLiquidity, 2);
  assert.equal(dailyBreakerTripped(0.5, 1), false);
  assert.equal(dailyBreakerTripped(1, 1), true);
});

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    chain: 'solana', address: 'Mint111111111111111111111111111111111111111', pairAddress: 'Pair', dexId: 'raydium', symbol: 'TEST', name: 'Test Coin', quoteSymbol: 'SOL',
    createdAt: Date.now() - 5 * 3600_000, liquidityUsd: 120_000, marketCapUsd: 900_000, fdvUsd: 900_000, priceUsd: 0.001, priceNative: 0.000005,
    volumeUsd: { ...emptyWindows(), m5: 8_000, h1: 60_000, h24: 800_000 }, priceChangePct: { ...emptyWindows(), m5: 6, h1: 20, h24: 40 },
    txns: { ...emptyTxns(), m5: { buys: 40, sells: 20 }, h1: { buys: 300, sells: 200 } }, hasSocials: true, boosted: false, source: 'new-pool',
    safety: { mintRenounced: true, freezeRenounced: true, top10HoldersPct: 22, lpBurnedOrLocked: true, honeypot: false, sellTaxPct: 0, source: 'test', checkedAt: Date.now() },
    updatedAt: Date.now(), ...over,
  };
}

test('evaluate: a healthy candidate passes balanced, and every failure has a reason', () => {
  const s = preset('balanced', 'solana');
  const ok = evaluate(candidate(), s);
  assert.equal(ok.pass, true, ok.reasons.join('; '));

  const thin = evaluate(candidate({ liquidityUsd: 12_000 }), s);
  assert.equal(thin.pass, false);
  assert.match(thin.reasons[0]!, /liquidity \$12k is under your \$15k minimum/);

  const old = evaluate(candidate({ createdAt: Date.now() - 10 * 24 * 3600_000 }), s);
  assert.ok(old.reasons.some((r) => r.startsWith('age')));

  const mintable = evaluate(candidate({ safety: { ...candidate().safety!, mintRenounced: false } }), s);
  assert.ok(mintable.reasons.includes('the team can still mint more tokens'));

  const unknownSafety = evaluate(candidate({ safety: null }), s);
  assert.equal(unknownSafety.pass, false, 'skip on unknown by default');
  const allowUnknown = evaluate(candidate({ safety: null }), { ...s, safety: { ...s.safety, onUnknown: 'allow' } });
  assert.equal(allowUnknown.pass, true);
  assert.ok(allowUnknown.unknown.length > 0);
});

test('evaluate: chain mismatch and keyword rules', () => {
  const s = preset('balanced', 'solana');
  assert.equal(evaluate(candidate({ chain: 'robinhood' }), s).pass, false);
  const kw = { ...s, advanced: { ...s.advanced, keywords: { include: ['cat'], exclude: ['rug'] } } };
  assert.equal(evaluate(candidate({ name: 'Test Coin' }), kw).pass, false);
  assert.equal(evaluate(candidate({ name: 'Cat Coin' }), kw).pass, true);
  assert.equal(evaluate(candidate({ name: 'Cat rug' }), kw).pass, false);
});

test('pons rules apply only to candidates that carry pons facts', () => {
  const s = preset('balanced', 'robinhood');
  const fresh = candidate({
    chain: 'robinhood', quoteSymbol: 'ETH', createdAt: Date.now() - 60_000, liquidityUsd: 7_000, marketCapUsd: 25_000, fdvUsd: 25_000,
    volumeUsd: emptyWindows(), priceChangePct: emptyWindows(), txns: emptyTxns(), hasSocials: true, safety: { mintRenounced: true, freezeRenounced: true, top10HoldersPct: null, lpBurnedOrLocked: null, honeypot: false, sellTaxPct: 2, source: 'pons', checkedAt: Date.now() },
    pons: { curve: '0xc', deployer: '0xd', phase: 0, devSharePct: 3, creatorTaxBps: 200, exemptWallets: 1, openingTaxBps: 0, progress: 0.02, feeToDeployer: true, deployerPrior: null, deployerGraduated: null, quoteReserve: '1', tokenReserve: '1', realQuoteReserve: '0', feeBps: 100, graduated: false, readyToGraduate: false, pairToken: '0x0000000000000000000000000000000000000000', pairDecimals: 18 },
  });
  const ok = evaluate(fresh, s);
  assert.equal(ok.pass, true, ok.reasons.join('; '));
  const bundled = evaluate({ ...fresh, pons: { ...fresh.pons!, exemptWallets: 6 } }, s);
  assert.ok(bundled.reasons.some((r) => r.includes('exempted from the opening tax')));
  const greedy = evaluate({ ...fresh, pons: { ...fresh.pons!, devSharePct: 20 } }, s);
  assert.ok(greedy.reasons.some((r) => r.includes('kept 20.0% of supply')));
  const graduated = evaluate({ ...fresh, pons: { ...fresh.pons!, phase: 2, graduated: true } }, s);
  assert.ok(graduated.reasons.some((r) => r.includes('graduated')));
  // Curve progress and launcher history: floors, ceilings, and "unknown" when the hub has no history.
  const picky = { ...s, advanced: { ...s.advanced, pons: { ...s.advanced.pons, progressPct: { min: 5, max: 60 }, maxDeployerPrior: 2, minDeployerGraduated: 1 } } };
  const early = evaluate(fresh, picky);
  assert.ok(early.reasons.some((r) => r.includes('under your 5% floor')), early.reasons.join('; '));
  assert.deepEqual(early.unknown.filter((u) => u.startsWith('launcher')).sort(), ['launcher graduations', 'launcher history']);
  const late = evaluate({ ...fresh, pons: { ...fresh.pons!, progress: 0.8, deployerPrior: 5, deployerGraduated: 0 } }, picky);
  assert.ok(late.reasons.some((r) => r.includes('past your 60% ceiling')));
  assert.ok(late.reasons.some((r) => r.includes('5 prior launches')));
  assert.ok(late.reasons.some((r) => r.includes('0 graduated launches')));
  const seasoned = evaluate({ ...fresh, pons: { ...fresh.pons!, progress: 0.2, deployerPrior: 1, deployerGraduated: 1 } }, picky);
  assert.equal(seasoned.pass, true, seasoned.reasons.join('; '));
  assert.ok(describeStrategy(picky).some((line) => line.includes('the curve is 5–60% along')));
  // A Solana candidate never sees pons rules.
  assert.equal(evaluate(candidate(), preset('balanced', 'solana')).pass, true);
  assert.ok(describeStrategy(s).some((line) => line.startsWith('On pons launches')));
});

test('pump.fun rules apply only to candidates that carry pump facts', () => {
  const s = preset('degen', 'solana');
  const launch = candidate({
    createdAt: Date.now() - 4 * 60_000, dexId: 'pump-fun', source: 'pump-launch', liquidityUsd: 4_000, marketCapUsd: 12_000, fdvUsd: 12_000,
    volumeUsd: { ...emptyWindows(), m5: 900 }, priceChangePct: emptyWindows(), txns: { ...emptyTxns(), m5: { buys: 14, sells: 6 } }, hasSocials: false,
    safety: { mintRenounced: true, freezeRenounced: true, top10HoldersPct: null, lpBurnedOrLocked: null, honeypot: false, sellTaxPct: 0, source: 'pump.fun', checkedAt: Date.now() },
    pump: { curve: 'Curve', creator: 'Dev', devBuySol: 0.5, devSharePct: 2, vSol: 32, vTokens: 1_000_000_000, realSol: 2, marketCapSol: 60, progress: 0.05, complete: false, pool: 'pump', creatorPrior: 0 },
    bundle: { wallets: 0, supplyPct: 0, nativeSpent: 0, launchPct: 2, method: 'slot', checkedAt: Date.now() },
  });
  const ok = evaluate(launch, s);
  assert.equal(ok.pass, true, ok.reasons.join('; '));

  // The launch-slot check: Degen refuses a bundle over its ceiling, waits while the check is out, and
  // a strategy set to 'allow' judges without it (noting what it could not check).
  const bundled = evaluate({ ...launch, bundle: { wallets: 7, supplyPct: 41.2, nativeSpent: 6.1, launchPct: 43.2, method: 'slot', checkedAt: Date.now() } }, s);
  assert.ok(bundled.reasons.some((r) => r.includes('7 wallets bought 41.2% of supply in the launch slot, over your 30% limit')), bundled.reasons.join('; '));
  const unchecked = evaluate({ ...launch, bundle: undefined }, s);
  assert.ok(unchecked.reasons.some((r) => r.includes('launch-block check has not come back yet')), unchecked.reasons.join('; '));
  const lenient = evaluate({ ...launch, bundle: undefined }, { ...s, advanced: { ...s.advanced, bundleUnknown: 'allow' } });
  assert.equal(lenient.pass, true, lenient.reasons.join('; '));
  assert.ok(lenient.unknown.includes('launch bundle'));
  assert.ok(describeStrategy(s).some((line) => line.includes('Skip bundled launches: more than 30% of supply')));

  const whale = evaluate({ ...launch, pump: { ...launch.pump!, devBuySol: 4 } }, s);
  assert.ok(whale.reasons.some((r) => r.includes('bought 4.00 SOL at launch')), whale.reasons.join('; '));
  const greedy = evaluate({ ...launch, pump: { ...launch.pump!, devSharePct: 20 } }, s);
  assert.ok(greedy.reasons.some((r) => r.includes('holds 20.0% of supply')));
  const graduated = evaluate({ ...launch, pump: { ...launch.pump!, complete: true, pool: 'pump-amm' } }, s);
  assert.ok(graduated.reasons.some((r) => r.includes('graduated off the bonding curve')));
  const early = evaluate({ ...launch, pump: { ...launch.pump!, progress: 0.01 } }, s);
  assert.ok(early.reasons.some((r) => r.includes('under your 3% floor')));
  const late = evaluate({ ...launch, pump: { ...launch.pump!, progress: 0.9 } }, s);
  assert.ok(late.reasons.some((r) => r.includes('past your 70% ceiling')));
  const serial = evaluate({ ...launch, pump: { ...launch.pump!, creatorPrior: 9 } }, s);
  assert.ok(serial.reasons.some((r) => r.includes('9 prior launches')));
  const noHistory = evaluate({ ...launch, pump: { ...launch.pump!, creatorPrior: null } }, s);
  assert.equal(noHistory.pass, true);
  assert.ok(noHistory.unknown.includes('creator history'));

  // Balanced only buys graduates; a curve token is refused with a sentence.
  const balanced = evaluate({ ...launch, createdAt: Date.now() - 30 * 60_000, liquidityUsd: 40_000, marketCapUsd: 90_000, volumeUsd: { ...emptyWindows(), m5: 5_000, h1: 30_000 }, priceChangePct: { ...emptyWindows(), m5: 5, h1: 20 }, txns: { ...emptyTxns(), m5: { buys: 30, sells: 10 }, h1: { buys: 200, sells: 100 } } }, preset('balanced', 'solana'));
  assert.ok(balanced.reasons.some((r) => r.includes('still on the bonding curve')), balanced.reasons.join('; '));

  // A market-cap-in-SOL range needs the fact.
  const mcs = { ...s, advanced: { ...s.advanced, pump: { ...s.advanced.pump, marketCapSol: { min: 100, max: null } } } };
  assert.ok(evaluate(launch, mcs).reasons.some((r) => r.includes('60.0 SOL is under your 100 SOL minimum')));
  assert.ok(evaluate({ ...launch, pump: { ...launch.pump!, marketCapSol: null } }, mcs).unknown.some((u) => u.includes('market cap in SOL')));

  // A Robinhood candidate never sees pump rules, and a candidate without pump facts is untouched.
  assert.equal(evaluate(candidate({ createdAt: Date.now() - 20 * 60_000, liquidityUsd: 5_000, marketCapUsd: 20_000, volumeUsd: { ...emptyWindows(), m5: 900 }, txns: { ...emptyTxns(), m5: { buys: 14, sells: 6 } }, safety: null }), s).pass, true);
  assert.ok(describeStrategy(s).some((line) => line.startsWith('On pump.fun launches:') && line.includes('2 SOL at launch')));
});

test('listing rules: only listed, minimum score, confirmation, verdicts', () => {
  const base = preset('balanced', 'solana');
  const listed = candidate({ source: 'listing', listing: { sources: ['coingecko'], confirmed: false, score: 64, verdict: 'WATCH', reasons: ['one catalogue only'], detectedAt: Date.now(), urls: { coingecko: 'https://www.coingecko.com/en/coins/test' } } });
  assert.equal(evaluate(listed, base).pass, true, 'no listing rules by default');
  assert.equal(evaluate(candidate(), base).pass, true, 'unlisted tokens are fine by default');

  const only = { ...base, advanced: { ...base.advanced, listing: { ...base.advanced.listing, onlyListed: true } } };
  assert.ok(evaluate(candidate(), only).reasons.some((r) => r.includes('you only trade listings')));
  assert.equal(evaluate(listed, only).pass, true);

  const picky = { ...base, advanced: { ...base.advanced, listing: { onlyListed: false, minScore: 70, requireConfirmed: true, verdicts: ['ACT' as const] } } };
  const why = evaluate(listed, picky).reasons;
  assert.ok(why.some((r) => r.includes('listing score 64 is under your 70 minimum')), why.join('; '));
  assert.ok(why.some((r) => r.includes('listed on CoinGecko only; you require both')));
  assert.ok(why.some((r) => r.includes('listing verdict is WATCH, you allowed ACT')));
  const strong = { ...listed, listing: { ...listed.listing!, sources: ['coingecko' as const, 'coinmarketcap' as const], confirmed: true, score: 88, verdict: 'ACT' as const } };
  assert.equal(evaluate(strong, picky).pass, true);
  assert.equal(evaluate(candidate(), picky).pass, true, 'listing rules never judge a token that has no listing');
  assert.ok(describeStrategy(picky).some((line) => line.startsWith('Listings:') && line.includes('at least 70')));
});

test('old saved strategies pick up the pump and listing sections with defaults', () => {
  const old = presetInput('balanced', 'solana') as unknown as { advanced?: Record<string, unknown> };
  delete old.advanced;
  const parsed = parseStrategy(old);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.strategy.advanced.pump.maxDevBuySol, 3);
    assert.equal(parsed.strategy.advanced.listing.onlyListed, false);
  }
});
