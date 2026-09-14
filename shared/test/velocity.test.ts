import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyTxns, emptyWindows, type Candidate } from '../src/candidate.js';
import { TPM, TapeBook, classifyHeat, countPrints, isHotTape, isJustLit, isThinTape, tpmRank, velocityFromWindows } from '../src/velocity.js';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    chain: 'robinhood', address: '0x' + '11'.repeat(20), pairAddress: '0x' + '22'.repeat(20), dexId: 'pons',
    symbol: 'IPO', name: 'IPO', quoteSymbol: 'ETH', createdAt: Date.now() - 120_000,
    liquidityUsd: 80_000, marketCapUsd: 400_000, fdvUsd: 400_000, priceUsd: 0.04, priceNative: 1e-5,
    volumeUsd: emptyWindows(), priceChangePct: emptyWindows(), txns: emptyTxns(),
    hasSocials: false, boosted: false, source: 'pons-launch', safety: null, updatedAt: Date.now(),
    pons: {
      curve: '0x' + '33'.repeat(20), deployer: '0x' + '44'.repeat(20), phase: 0, devSharePct: 2,
      creatorTaxBps: 100, exemptWallets: 0, openingTaxBps: 0, progress: 0.2, feeToDeployer: true,
      deployerPrior: 0, deployerGraduated: 0, quoteReserve: '1000000000000000000',
      tokenReserve: '900000000000000000000000000', realQuoteReserve: '1000000000000000000',
      feeBps: 50, graduated: false, readyToGraduate: false,
      pairToken: '0x0000000000000000000000000000000000000000', pairDecimals: 18,
    },
    ...over,
  };
}

test('windows-only velocity: 5m txn totals become tpm5m, never a fake 1m spike or LIT', () => {
  const c = candidate({ txns: { ...emptyTxns(), m5: { buys: 400, sells: 70 } } });
  const v = velocityFromWindows(c);
  assert.equal(v.trades5m, 470);
  assert.equal(v.tpm5m, 94);
  assert.equal(v.tpm1m, 0);
  assert.equal(v.heat, 'hot');
  assert.equal(v.justLit, false);
  assert.equal(v.source, 'windows');
  assert.equal(tpmRank(c), 94);
});

test('2–3 trades are thin tape, not hot and not lit', () => {
  const c = candidate({ txns: { ...emptyTxns(), m5: { buys: 2, sells: 1 } } });
  const v = velocityFromWindows(c);
  assert.ok(v.tpm5m < TPM.thin);
  assert.equal(v.heat, 'quiet');
  assert.equal(isThinTape(v), true);
  assert.equal(isHotTape(v), false);
  assert.equal(isJustLit(v), false);
});

test('classifyHeat matches IPO-like vs a handful of prints', () => {
  assert.equal(classifyHeat(3, 0.6), 'quiet');
  assert.equal(classifyHeat(10, 8), 'warming');
  assert.equal(classifyHeat(16, 8), 'hot');
  assert.equal(classifyHeat(0, 94), 'hot');
  assert.equal(classifyHeat(90, 94), 'hot');
});

test('countPrints: first snapshot is not dumped onto the 1m tape', () => {
  const next = candidate({ txns: { ...emptyTxns(), m5: { buys: 400, sells: 70 } } });
  assert.equal(countPrints(undefined, next), 0);
});

test('countPrints: empty → a handful of txns counts; a fat window hydrate does not', () => {
  const empty = candidate({ txns: emptyTxns() });
  const trickle = candidate({ txns: { ...emptyTxns(), m5: { buys: 3, sells: 0 } } });
  const hydrate = candidate({ txns: { ...emptyTxns(), m5: { buys: 400, sells: 70 } } });
  assert.equal(countPrints(empty, trickle), 3);
  assert.equal(countPrints(empty, hydrate), 0);
});

test('countPrints: txn-window increases are real prints; a reserve tick counts as one when txns did not move', () => {
  const a = candidate({ txns: { ...emptyTxns(), m5: { buys: 10, sells: 2 } } });
  const b = candidate({ txns: { ...emptyTxns(), m5: { buys: 18, sells: 4 } } });
  assert.equal(countPrints(a, b), 10);
  const c = candidate({
    txns: a.txns,
    pons: { ...a.pons!, quoteReserve: '1500000000000000000' },
  });
  assert.equal(countPrints(a, c), 1);
  assert.equal(countPrints(a, a), 0);
});

test('hello of a fat 5m window does not light the 1-minute tape', () => {
  const book = new TapeBook();
  const t0 = 1_000_000;
  const hello = candidate({ txns: { ...emptyTxns(), m5: { buys: 400, sells: 70 } } });
  const v = book.ingest('ipo', undefined, hello, t0);
  assert.equal(v.tpm1m, 0);
  assert.equal(v.tpm5m, 94);
  assert.equal(v.justLit, false);
  assert.equal(v.source, 'windows');
});

test('quiet → 90 prints in one minute is IPO-style ignition (LIT)', () => {
  const book = new TapeBook();
  const t0 = 5_000_000;
  let prev = candidate({ txns: emptyTxns() });
  book.ingest('ipo', undefined, prev, t0);
  let next = prev;
  // 90 curve prints over 50 seconds, like the IPO/WETH hot minute.
  for (let i = 1; i <= 90; i++) {
    const buys = i;
    next = candidate({ txns: { ...emptyTxns(), m5: { buys, sells: 0 } } });
    const v = book.ingest('ipo', prev, next, t0 + i * 500);
    prev = next;
    if (i === 90) {
      assert.ok(v.tpm1m >= 90, `tpm1m=${v.tpm1m}`);
      assert.equal(v.heat, 'hot');
      assert.equal(v.justLit, true);
      assert.equal(v.source, 'prints');
      assert.ok(v.accel > 1.5, `accel=${v.accel}`);
      assert.equal(isHotTape(v), true);
    }
  }
});

test('a handful of prints in a minute never goes LIT', () => {
  const book = new TapeBook();
  const t0 = 8_000_000;
  let prev = candidate({ txns: emptyTxns() });
  book.ingest('ipo', undefined, prev, t0);
  let v;
  for (let i = 1; i <= 3; i++) {
    const next = candidate({ txns: { ...emptyTxns(), m5: { buys: i, sells: 0 } } });
    v = book.ingest('ipo', prev, next, t0 + i * 1_000);
    prev = next;
  }
  assert.ok(v);
  assert.equal(v.tpm1m, 3);
  assert.equal(v.heat, 'quiet');
  assert.equal(v.justLit, false);
  assert.equal(isThinTape(v), true);
});

test('steady hot tape keeps HOT after the LIT window, without re-lighting', () => {
  const book = new TapeBook();
  const t0 = 9_000_000;
  let prev = candidate({ txns: emptyTxns() });
  book.ingest('k', undefined, prev, t0);
  let v = emptyLike();
  // Ignite: 20 prints in the first 20s.
  for (let i = 1; i <= 20; i++) {
    const next = candidate({ txns: { ...emptyTxns(), m5: { buys: i, sells: 0 } } });
    v = book.ingest('k', prev, next, t0 + i * 1_000);
    prev = next;
  }
  assert.equal(v.justLit, true);
  assert.equal(v.heat, 'hot');
  // Keep printing ~20/min for another 3 minutes — past litMs (90s).
  let buys = 20;
  for (let i = 21; i <= 200; i++) {
    buys++;
    const next = candidate({ txns: { ...emptyTxns(), m5: { buys: Math.min(buys, 100), sells: 0 }, h1: { buys, sells: 0 } } });
    v = book.ingest('k', prev, next, t0 + i * 1_000);
    prev = next;
  }
  assert.equal(v.heat, 'hot');
  assert.equal(v.justLit, false);
  assert.ok(v.tpm1m >= TPM.hot, `tpm1m=${v.tpm1m}`);
});

test('hub-supplied velocity is used as-is', () => {
  const book = new TapeBook();
  const c = candidate({
    velocity: {
      trades1m: 90, trades5m: 470, trades15m: 470,
      tpm1m: 90, tpm5m: 94, tpm15m: 31,
      accel: 0.96, heat: 'hot', justLit: true, litAt: 1, source: 'hub',
    },
  });
  const v = book.ingest('hub', undefined, c, 1);
  assert.equal(v.source, 'hub');
  assert.equal(v.tpm1m, 90);
  assert.equal(v.justLit, true);
});

test('drop forgets a token; a glitch +10k txn delta is capped', () => {
  const book = new TapeBook();
  const a = candidate({ txns: { ...emptyTxns(), m5: { buys: 1, sells: 0 } } });
  const b = candidate({ txns: { ...emptyTxns(), m5: { buys: 20_000, sells: 0 } } });
  assert.equal(countPrints(a, b), 250);
  book.ingest('x', undefined, a, 1);
  book.drop('x');
  assert.equal(book.size(), 0);
});

function emptyLike(): ReturnType<TapeBook['ingest']> {
  return velocityFromWindows(candidate());
}
