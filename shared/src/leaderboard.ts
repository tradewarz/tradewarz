// The contest maths, kept pure so it can be tested to death and so the page and the hub
// agree on every number. Nothing here reads a clock, a database or the chain: give it the
// closed trades for a week and it gives back the board, the reasons and the flags.
//
// The rules Vik settled on:
//   score      = % return on capital deployed, realized on-chain only
//   floors     = $250 deployed, 10 closed trades, no single trade worth more than half the gain
//   exclusions = tokens the trader deployed themselves, trades that were more than a quarter
//                of the token's volume while they held it
//   one bot wallet per chain, frozen for the UTC week

import type { Chain } from './strategy.js';

// ---- the week ---------------------------------------------------------------------------
// Weeks are ISO: Monday 00:00:00 UTC through Sunday 23:59:59.999 UTC, written 2026-W36.

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(utcMidnight).getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7;
  return utcMidnight - backToMonday * MS_DAY;
}

/** The ISO week id for a moment, e.g. "2026-W36". */
export function weekIdOf(ms: number): string {
  const monday = weekStart(ms);
  // ISO rule: the week's year is the year of its Thursday.
  const thursday = monday + 3 * MS_DAY;
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = (() => {
    const jan4 = Date.UTC(year, 0, 4);
    return weekStart(jan4) + 3 * MS_DAY;
  })();
  const week = Math.round((thursday - firstThursday) / MS_WEEK) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export interface WeekRange { id: string; startMs: number; endMs: number }

/** Start and end (exclusive) of a week id. Throws on a malformed id. */
export function weekRange(id: string): WeekRange {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) throw new Error(`not a week id: ${id}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const firstMonday = weekStart(Date.UTC(year, 0, 4));
  const startMs = firstMonday + (week - 1) * MS_WEEK;
  if (weekIdOf(startMs) !== id) throw new Error(`no such week: ${id}`);
  return { id, startMs, endMs: startMs + MS_WEEK };
}

export const currentWeekId = (now: number): string => weekIdOf(now);
export const previousWeekId = (now: number): string => weekIdOf(weekStart(now) - 1);
/** True once the week is over — the point at which a board stops moving and review begins. */
export const weekIsOver = (id: string, now: number): boolean => now >= weekRange(id).endMs;

// ---- what the indexer hands us -----------------------------------------------------------

/** One round trip: tokens bought and later sold, priced in USD at the moment of each fill. */
export interface ClosedTrade {
  id: string;
  chain: Chain;
  /** The bot wallet that made it, lowercased. */
  wallet: string;
  token: string;
  symbol: string;
  openedAt: number;
  /** When the last of the lot was sold. A trade belongs to the week it closed in. */
  closedAt: number;
  /** Everything that left the wallet to open it, gas included, in USD at entry. */
  costUsd: number;
  /** Everything that came back, gas deducted, in USD at exit. */
  proceedsUsd: number;
  /** This wallet's share of the token's traded volume while it held, 0..1. Null = not measured. */
  volumeShare: number | null;
  /** The trader deployed this token. Set by the indexer from the launch record. */
  selfDeployed: boolean;
  /** A leg of this trade could not be priced from the chain (several tokens in one transaction, no state to read). Shown, never scored. */
  unpriced?: boolean;
}

export const tradePnlUsd = (t: ClosedTrade): number => t.proceedsUsd - t.costUsd;

// ---- the rules ----------------------------------------------------------------------------

export const LEADERBOARD_RULES = {
  /** Capital that has to have gone through the bot before a score counts. */
  minDeployedUsd: 250,
  /** Round trips that have to have finished. */
  minClosedTrades: 10,
  /** No single trade may be worth more than this share of the week's gain. */
  maxSingleTradeShareOfGain: 0.5,
  /** A trade that was more than this share of the token's volume doesn't count. */
  maxVolumeShare: 0.25,
  /** How long the board is held for review before a prize is paid. */
  reviewHours: 24,
  /** How long after review a prize is sent. */
  payoutHours: 48,
  /** Places reviewed by hand before any payout. */
  reviewedPlaces: 3,
} as const;

export type ExclusionCode = 'self-deployed' | 'volume-share' | 'wrong-wallet' | 'out-of-week' | 'unpriced';

export interface ExcludedTrade { trade: ClosedTrade; code: ExclusionCode; reason: string }

export type IneligibleCode = 'min-deployed' | 'min-trades' | 'single-trade' | 'no-trades' | 'under-review' | 'disqualified';

export interface Ineligibility { code: IneligibleCode; reason: string }

export type ReviewState = 'none' | 'clear' | 'flagged' | 'disqualified';

export interface BoardEntry {
  userId: string;
  chain: Chain;
  /** The wallet frozen for this user on this chain for this week. */
  wallet: string;
  /** Display name — the hub fills this with a short wallet or a chosen handle. */
  handle: string;
  rank: number | null;
  /** The score: percent return on capital deployed. */
  returnPct: number;
  pnlUsd: number;
  deployedUsd: number;
  closedTrades: number;
  wins: number;
  /** The largest single winning trade, and what share of the gain it was. */
  bestTradeUsd: number;
  bestTradeShare: number;
  excluded: ExcludedTrade[];
  /** Empty means the entry can win. Anything in here is shown as plain language. */
  ineligible: Ineligibility[];
  eligible: boolean;
  /** Set by the review console. */
  review: ReviewState;
}

export interface BoardEntryInput {
  userId: string;
  chain: Chain;
  /** The wallet frozen for the week. Trades from any other wallet are dropped. */
  wallet: string;
  handle: string;
  trades: ClosedTrade[];
  review?: ReviewState;
}

export interface ScoreOptions {
  week: WeekRange;
  rules?: Partial<typeof LEADERBOARD_RULES>;
}

/** Score one trader's week. Everything the board shows about them comes out of here. */
export function scoreEntry(input: BoardEntryInput, opts: ScoreOptions): BoardEntry {
  const rules = { ...LEADERBOARD_RULES, ...opts.rules };
  const wallet = input.wallet.toLowerCase();
  const excluded: ExcludedTrade[] = [];
  const counted: ClosedTrade[] = [];

  for (const t of input.trades) {
    if (t.closedAt < opts.week.startMs || t.closedAt >= opts.week.endMs) {
      excluded.push({ trade: t, code: 'out-of-week', reason: 'closed outside this week' });
    } else if (t.wallet.toLowerCase() !== wallet) {
      excluded.push({ trade: t, code: 'wrong-wallet', reason: 'made by a wallet that was not your entry for this week' });
    } else if (t.unpriced) {
      excluded.push({ trade: t, code: 'unpriced', reason: `a leg of the ${t.symbol || 'token'} trade could not be priced from the chain, so it is not counted` });
    } else if (t.selfDeployed) {
      excluded.push({ trade: t, code: 'self-deployed', reason: `you deployed ${t.symbol || 'this token'} yourself` });
    } else if (t.volumeShare !== null && t.volumeShare > rules.maxVolumeShare) {
      excluded.push({ trade: t, code: 'volume-share', reason: `you were ${Math.round(t.volumeShare * 100)}% of ${t.symbol || 'the token'}'s volume while you held it` });
    } else {
      counted.push(t);
    }
  }

  const deployedUsd = round2(counted.reduce((a, t) => a + Math.max(0, t.costUsd), 0));
  const pnlUsd = round2(counted.reduce((a, t) => a + tradePnlUsd(t), 0));
  const gains = counted.map(tradePnlUsd).filter((p) => p > 0);
  const grossGain = gains.reduce((a, b) => a + b, 0);
  const bestTradeUsd = round2(gains.length ? Math.max(...gains) : 0);
  const bestTradeShare = grossGain > 0 ? bestTradeUsd / grossGain : 0;
  const returnPct = deployedUsd > 0 ? round2((pnlUsd / deployedUsd) * 100) : 0;

  const ineligible: Ineligibility[] = [];
  if (counted.length === 0) {
    ineligible.push({ code: 'no-trades', reason: 'no closed trades counted this week' });
  } else {
    if (deployedUsd < rules.minDeployedUsd) {
      ineligible.push({ code: 'min-deployed', reason: `you put $${fmt(deployedUsd)} through the bot; a prize needs $${fmt(rules.minDeployedUsd)}` });
    }
    if (counted.length < rules.minClosedTrades) {
      ineligible.push({ code: 'min-trades', reason: `${counted.length} closed ${counted.length === 1 ? 'trade' : 'trades'}; a prize needs ${rules.minClosedTrades}` });
    }
    if (grossGain > 0 && bestTradeShare > rules.maxSingleTradeShareOfGain) {
      ineligible.push({ code: 'single-trade', reason: `one trade was ${Math.round(bestTradeShare * 100)}% of your gain; a prize needs no single trade above ${Math.round(rules.maxSingleTradeShareOfGain * 100)}%` });
    }
  }
  if (input.review === 'disqualified') ineligible.push({ code: 'disqualified', reason: 'removed in review' });

  return {
    userId: input.userId,
    chain: input.chain,
    wallet,
    handle: input.handle,
    rank: null,
    returnPct,
    pnlUsd,
    deployedUsd,
    closedTrades: counted.length,
    wins: gains.length,
    bestTradeUsd,
    bestTradeShare: round2(bestTradeShare),
    excluded,
    ineligible,
    eligible: ineligible.length === 0,
    review: input.review ?? 'none',
  };
}

export interface Board {
  week: WeekRange;
  chain: Chain;
  entries: BoardEntry[];
  /** Entries that could win, in order. The top of this is who gets paid. */
  eligible: BoardEntry[];
  /** True when the week ended positive for nobody, so the prize rolls over. */
  rollover: boolean;
  /** True once the week is closed and the review window has passed. */
  finalizedAt: number | null;
}

/**
 * Rank a chain's entries. Everyone appears — being below a floor hides the ribbon, not the row —
 * but only eligible entries get a rank, so a $5 account can't sit above a real one.
 */
export function buildBoard(inputs: BoardEntryInput[], chain: Chain, opts: ScoreOptions, now: number): Board {
  const entries = inputs.filter((i) => i.chain === chain).map((i) => scoreEntry(i, opts));
  const order = (a: BoardEntry, b: BoardEntry): number => b.returnPct - a.returnPct || b.pnlUsd - a.pnlUsd || a.userId.localeCompare(b.userId);
  const eligible = entries.filter((e) => e.eligible).sort(order);
  eligible.forEach((e, i) => { e.rank = i + 1; });
  entries.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return order(a, b);
  });
  const over = now >= opts.week.endMs;
  return {
    week: opts.week,
    chain,
    entries,
    eligible,
    rollover: over && !eligible.some((e) => e.pnlUsd > 0),
    finalizedAt: over ? opts.week.endMs + LEADERBOARD_RULES.reviewHours * 3_600_000 : null,
  };
}

/** The entries a human has to look at before money moves. */
export const needsReview = (board: Board): BoardEntry[] =>
  board.eligible.filter((e) => e.pnlUsd > 0).slice(0, LEADERBOARD_RULES.reviewedPlaces);

const round2 = (n: number): number => Math.round(n * 100) / 100;
const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// ---- what the page is sent -----------------------------------------------------------------
// The board is public to anyone signed in, so it carries no user ids and no session detail:
// a name, a wallet anyone could have read off the chain anyway, and the numbers behind the rank.

export interface BoardEntryView {
  rank: number | null;
  handle: string;
  wallet: string;
  returnPct: number;
  pnlUsd: number;
  deployedUsd: number;
  closedTrades: number;
  wins: number;
  eligible: boolean;
  /** Plain sentences: why this entry can't win. Empty when it can. */
  ineligible: string[];
  /** How many of their trades didn't count, and why, in one sentence each. */
  excluded: string[];
  review: ReviewState;
  /** True for the row belonging to whoever asked. */
  you: boolean;
}

export interface BoardView {
  week: string;
  startsAt: number;
  endsAt: number;
  live: boolean;
  chain: Chain;
  entries: BoardEntryView[];
  rollover: boolean;
  /** False until Vik turns prizes on; the board still runs. */
  prizes: boolean;
  prizeText: string;
  /** When the top three stop being provisional. */
  reviewEndsAt: number | null;
  rules: {
    minDeployedUsd: number;
    minClosedTrades: number;
    maxSingleTradeShareOfGain: number;
    maxVolumeShare: number;
    reviewHours: number;
    payoutHours: number;
  };
  /** The asker's own standing, even when they are far down the board. */
  you: BoardEntryView | null;
  weeks: string[];
}
