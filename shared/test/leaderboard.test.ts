import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEADERBOARD_RULES, buildBoard, needsReview, previousWeekId, scoreEntry, weekIdOf, weekIsOver, weekRange, weekStart,
  type ClosedTrade, type BoardEntryInput,
} from '../src/leaderboard.js';

const W = weekRange('2026-W36'); // Mon 2026-08-31 .. Mon 2026-09-07 UTC
const mid = W.startMs + 3 * 86_400_000;

function trade(over: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    id: `t${Math.random().toString(36).slice(2, 8)}`,
    chain: 'robinhood',
    wallet: '0xbot',
    token: '0xtoken',
    symbol: 'TKN',
    openedAt: mid - 60_000,
    closedAt: mid,
    costUsd: 100,
    proceedsUsd: 110,
    volumeShare: 0.01,
    selfDeployed: false,
    ...over,
  };
}
const many = (n: number, over: Partial<ClosedTrade> = {}): ClosedTrade[] => Array.from({ length: n }, () => trade(over));
const entry = (over: Partial<BoardEntryInput> = {}): BoardEntryInput =>
  ({ userId: 'u1', chain: 'robinhood', wallet: '0xBot', handle: 'bot', trades: many(10), ...over });

// ---- weeks -------------------------------------------------------------------------------

test('a week runs Monday to Monday in UTC', () => {
  assert.equal(new Date(W.startMs).toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(new Date(W.endMs).toISOString(), '2026-09-07T00:00:00.000Z');
  assert.equal(new Date(W.startMs).getUTCDay(), 1);
});

test('week ids round trip and follow the ISO year', () => {
  for (const iso of ['2026-08-31T00:00:00Z', '2026-09-06T23:59:59Z', '2027-03-15T12:00:00Z']) {
    const ms = Date.parse(iso);
    const id = weekIdOf(ms);
    const r = weekRange(id);
    assert.ok(ms >= r.startMs && ms < r.endMs, `${iso} sits inside ${id}`);
  }
  // 1 Jan 2026 is a Thursday, so its week is 2026-W01 and it starts in December 2025.
  assert.equal(weekIdOf(Date.parse('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(new Date(weekStart(Date.parse('2026-01-01T00:00:00Z'))).toISOString(), '2025-12-29T00:00:00.000Z');
  // 1 Jan 2027 is a Friday, so it still belongs to 2026 — which is a 53-week year.
  assert.equal(weekIdOf(Date.parse('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(weekIdOf(Date.parse('2026-09-06T12:00:00Z')), '2026-W36');
  assert.equal(previousWeekId(mid), '2026-W35');
  assert.throws(() => weekRange('2026-W54'), /no such week/);
  assert.throws(() => weekRange('nope'), /not a week id/);
});

test('a week is over only once it has ended', () => {
  assert.equal(weekIsOver('2026-W36', W.endMs - 1), false);
  assert.equal(weekIsOver('2026-W36', W.endMs), true);
});

// ---- scoring -----------------------------------------------------------------------------

test('the score is percent return on capital deployed', () => {
  const e = scoreEntry(entry({ trades: many(10, { costUsd: 100, proceedsUsd: 110 }) }), { week: W });
  assert.equal(e.deployedUsd, 1000);
  assert.equal(e.pnlUsd, 100);
  assert.equal(e.returnPct, 10);
  assert.equal(e.eligible, true);
  assert.equal(e.wins, 10);
});

test('losses count the same way', () => {
  const e = scoreEntry(entry({ trades: [...many(5, { costUsd: 100, proceedsUsd: 150 }), ...many(5, { costUsd: 100, proceedsUsd: 50 })] }), { week: W });
  assert.equal(e.pnlUsd, 0);
  assert.equal(e.returnPct, 0);
  assert.equal(e.wins, 5);
});

test('a small account is shown but cannot win', () => {
  const e = scoreEntry(entry({ trades: many(10, { costUsd: 10, proceedsUsd: 30 }) }), { week: W });
  assert.equal(e.returnPct, 200);
  assert.equal(e.eligible, false);
  assert.deepEqual(e.ineligible.map((i) => i.code), ['min-deployed']);
  assert.match(e.ineligible[0]!.reason, /\$100.*\$250/);
});

test('too few closed trades cannot win', () => {
  const e = scoreEntry(entry({ trades: many(3, { costUsd: 500, proceedsUsd: 600 }) }), { week: W });
  assert.equal(e.eligible, false);
  assert.deepEqual(e.ineligible.map((i) => i.code), ['min-trades']);
  assert.match(e.ineligible[0]!.reason, /3 closed trades.*10/);
});

test('one lucky trade cannot carry a week', () => {
  const e = scoreEntry(entry({ trades: [...many(9, { costUsd: 100, proceedsUsd: 101 }), trade({ costUsd: 100, proceedsUsd: 1000 })] }), { week: W });
  assert.equal(e.eligible, false);
  assert.deepEqual(e.ineligible.map((i) => i.code), ['single-trade']);
  assert.ok(e.bestTradeShare > LEADERBOARD_RULES.maxSingleTradeShareOfGain);
});

test('an even spread of gains passes the single-trade rule', () => {
  const e = scoreEntry(entry({ trades: many(10, { costUsd: 100, proceedsUsd: 130 }) }), { week: W });
  assert.equal(e.bestTradeShare, 0.1);
  assert.equal(e.eligible, true);
});

test('the single-trade rule is not applied to a losing week', () => {
  const e = scoreEntry(entry({ trades: many(10, { costUsd: 100, proceedsUsd: 40 }) }), { week: W });
  assert.equal(e.ineligible.some((i) => i.code === 'single-trade'), false);
  assert.equal(e.returnPct, -60);
});

// ---- exclusions --------------------------------------------------------------------------

test('a token you deployed yourself does not count', () => {
  const e = scoreEntry(entry({ trades: [...many(10, { costUsd: 100, proceedsUsd: 110 }), trade({ costUsd: 100, proceedsUsd: 5000, selfDeployed: true })] }), { week: W });
  assert.equal(e.closedTrades, 10);
  assert.equal(e.returnPct, 10);
  assert.equal(e.excluded.length, 1);
  assert.equal(e.excluded[0]!.code, 'self-deployed');
  assert.match(e.excluded[0]!.reason, /you deployed TKN yourself/);
});

test('trading against yourself does not count', () => {
  const e = scoreEntry(entry({ trades: [...many(10), trade({ volumeShare: 0.9, proceedsUsd: 900 })] }), { week: W });
  assert.equal(e.closedTrades, 10);
  assert.equal(e.excluded[0]!.code, 'volume-share');
  assert.match(e.excluded[0]!.reason, /90% of TKN's volume/);
});

test('volume share right on the line still counts', () => {
  const e = scoreEntry(entry({ trades: many(10, { volumeShare: LEADERBOARD_RULES.maxVolumeShare }) }), { week: W });
  assert.equal(e.closedTrades, 10);
  assert.equal(e.excluded.length, 0);
});

test('an unmeasured volume share does not exclude the trade', () => {
  const e = scoreEntry(entry({ trades: many(10, { volumeShare: null }) }), { week: W });
  assert.equal(e.closedTrades, 10);
});

test('trades from another wallet and from another week are dropped', () => {
  const e = scoreEntry(entry({
    trades: [
      ...many(10),
      trade({ wallet: '0xother', proceedsUsd: 9000 }),
      trade({ closedAt: W.startMs - 1, proceedsUsd: 9000 }),
      trade({ closedAt: W.endMs, proceedsUsd: 9000 }),
    ],
  }), { week: W });
  assert.equal(e.closedTrades, 10);
  assert.deepEqual(e.excluded.map((x) => x.code).sort(), ['out-of-week', 'out-of-week', 'wrong-wallet']);
});

test('the frozen wallet is matched without regard to case', () => {
  const e = scoreEntry(entry({ wallet: '0xBOT', trades: many(10, { wallet: '0xbot' }) }), { week: W });
  assert.equal(e.closedTrades, 10);
});

test('an entry whose every trade is excluded says so plainly', () => {
  const e = scoreEntry(entry({ trades: many(10, { selfDeployed: true }) }), { week: W });
  assert.equal(e.closedTrades, 0);
  assert.equal(e.returnPct, 0);
  assert.deepEqual(e.ineligible.map((i) => i.code), ['no-trades']);
});

test('review can remove an entry', () => {
  const e = scoreEntry(entry({ review: 'disqualified' }), { week: W });
  assert.equal(e.eligible, false);
  assert.ok(e.ineligible.some((i) => i.code === 'disqualified'));
});

// ---- the board ---------------------------------------------------------------------------

test('the board ranks eligible entries and parks the rest below them', () => {
  const board = buildBoard([
    entry({ userId: 'big', wallet: '0xa', trades: many(10, { wallet: '0xa', costUsd: 100, proceedsUsd: 120 }) }),
    entry({ userId: 'huge', wallet: '0xb', trades: many(10, { wallet: '0xb', costUsd: 100, proceedsUsd: 140 }) }),
    entry({ userId: 'tiny', wallet: '0xc', trades: many(10, { wallet: '0xc', costUsd: 5, proceedsUsd: 50 }) }),
  ], 'robinhood', { week: W }, W.endMs);

  assert.deepEqual(board.entries.map((e) => e.userId), ['huge', 'big', 'tiny']);
  assert.deepEqual(board.eligible.map((e) => e.userId), ['huge', 'big']);
  assert.deepEqual(board.eligible.map((e) => e.rank), [1, 2]);
  assert.equal(board.entries[2]!.rank, null, 'the 900% micro account gets no rank');
  assert.equal(board.rollover, false);
});

test('the board only covers its own chain', () => {
  const board = buildBoard([entry(), entry({ userId: 'sol', chain: 'solana' })], 'solana', { week: W }, W.endMs);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0]!.userId, 'sol');
});

test('a week nobody won rolls over, but only once it is over', () => {
  const losers = [entry({ userId: 'a', wallet: '0xa', trades: many(10, { wallet: '0xa', costUsd: 100, proceedsUsd: 90 }) })];
  assert.equal(buildBoard(losers, 'robinhood', { week: W }, W.endMs).rollover, true);
  assert.equal(buildBoard(losers, 'robinhood', { week: W }, W.endMs - 1).rollover, false, 'a week in progress never rolls over');
});

test('review covers the top three positive entries only', () => {
  const inputs = ['a', 'b', 'c', 'd'].map((u, i) =>
    entry({ userId: u, wallet: `0x${u}`, trades: many(10, { wallet: `0x${u}`, costUsd: 100, proceedsUsd: 130 - i * 5 }) }),
  );
  inputs.push(entry({ userId: 'loser', wallet: '0xl', trades: many(10, { wallet: '0xl', costUsd: 100, proceedsUsd: 80 }) }));
  const board = buildBoard(inputs, 'robinhood', { week: W }, W.endMs);
  assert.deepEqual(needsReview(board).map((e) => e.userId), ['a', 'b', 'c']);
});

test('nothing is finalized while the week is running', () => {
  assert.equal(buildBoard([], 'robinhood', { week: W }, W.endMs - 1).finalizedAt, null);
  assert.equal(buildBoard([], 'robinhood', { week: W }, W.endMs).finalizedAt, W.endMs + 24 * 3_600_000);
});
