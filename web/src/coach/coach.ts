// What the coach is told, what it may suggest, and how a suggestion becomes a saved rule.
//
// The model sees the review pack (rules in words, closed trades, decisions, open positions) and a
// system prompt that pins it to the numbers in the pack and to settings that exist. It ends its
// answer with a JSON block of suggestions - setting path, value, one-line why - which the page
// turns into Apply buttons. Applying runs the same schema and guardrail checks as the Builder, so
// a suggestion that would loosen a rail is refused with the rail's own sentence.

import { CHAINS, GUARDRAILS, type Chain, type Strategy } from '@tradewarz/shared';

/** Every setting the coach may point at, with what it means. Anything else in a suggestion is ignored. */
export const COACH_SETTINGS: ReadonlyArray<readonly [path: string, meaning: string]> = [
  ['discovery.ageMinutes.min', 'minimum pair age in minutes (null = none)'],
  ['discovery.ageMinutes.max', 'maximum pair age in minutes (null = none)'],
  ['discovery.liquidityUsd.min', 'minimum pool liquidity in USD (null = none)'],
  ['discovery.liquidityUsd.max', 'maximum pool liquidity in USD (null = none)'],
  ['discovery.marketCapUsd.min', 'minimum market cap in USD (null = none)'],
  ['discovery.marketCapUsd.max', 'maximum market cap in USD (null = none)'],
  ['discovery.volumeUsd.m5.min', 'minimum 5-minute volume in USD'],
  ['discovery.volumeUsd.h1.min', 'minimum 1-hour volume in USD'],
  ['discovery.buySellRatio.min', 'minimum buys per sell over the chosen window (null = none)'],
  ['discovery.minTxns.min', 'minimum transactions over the chosen window (null = none)'],
  ['discovery.requireSocials', 'true = only tokens with a website or socials'],
  ['safety.maxTop10HoldersPct', 'maximum share held by the top 10 wallets, percent (null = off)'],
  ['safety.maxSellTaxPct', 'maximum sell tax, percent (null = off)'],
  ['safety.onUnknown', '"skip" or "allow" when a safety check cannot be made'],
  ['entry.sizeNative', 'buy size in the native coin (SOL / ETH / BNB)'],
  ['entry.maxOpenPositions', `open positions at once (at most ${GUARDRAILS.maxOpenPositions})`],
  ['entry.dailyBudgetNative', 'native coin the bot may spend on entries per UTC day'],
  ['entry.style', '"instant", "pullback" or "breakout"'],
  ['entry.slippagePct', `slippage percent (under ${GUARDRAILS.slippageMaxPct})`],
  ['entry.reentryCooldownMinutes', 'minutes to leave a token alone after closing it'],
  ['exits.takeProfitPct', 'take profit at this gain percent (null = off)'],
  ['exits.stopLossPct', `stop loss at this loss percent (at most ${GUARDRAILS.stopLossMaxPct})`],
  ['exits.trailingPct', 'trailing stop this far below the peak, percent (null = off)'],
  ['exits.maxHoldMinutes', 'sell after this many minutes regardless (null = off)'],
  ['exits.liquidityDrainExitPct', `sell when the pool loses this percent of liquidity (at most ${GUARDRAILS.liquidityDrainExitMaxPct})`],
  ['advanced.maxBundlePct', 'skip launches where other wallets bought more than this percent of supply in the launch block (null = off)'],
  ['advanced.bundleUnknown', '"wait" or "allow" while the launch-block check is pending'],
  ['advanced.pump.maxDevBuySol', 'Solana pump.fun: creator buy at launch, at most, in SOL (null = off)'],
  ['advanced.pump.maxDevSharePct', 'Solana pump.fun: creator share of supply, at most, percent (null = off)'],
  ['advanced.pump.curveOnly', 'Solana pump.fun: true = only while on the bonding curve'],
  ['advanced.pump.migratedOnly', 'Solana pump.fun: true = only after graduation'],
  ['advanced.pump.progressPct.min', 'Solana pump.fun: curve progress floor, percent (null = none)'],
  ['advanced.pump.progressPct.max', 'Solana pump.fun: curve progress ceiling, percent (null = none)'],
  ['advanced.pons.maxDevSharePct', 'Robinhood pons: launcher share of supply, at most, percent'],
  ['advanced.pons.maxExemptWallets', 'Robinhood pons: wallets exempted from the opening tax, at most'],
  ['advanced.pons.curveOnly', 'Robinhood pons: true = only while on the curve'],
  ['advanced.pons.progressPct.min', 'Robinhood pons: curve progress floor, percent (null = none)'],
  ['advanced.pons.progressPct.max', 'Robinhood pons: curve progress ceiling, percent (null = none)'],
  ['advanced.listing.minScore', 'minimum listing score 0-100 for listed coins (null = off)'],
  ['advanced.listing.onlyListed', 'true = only trade coins that came through a CoinGecko/CoinMarketCap listing'],
  ['copy.maxAgeSec', 'copy trading: ignore signals older than this many seconds'],
  ['copy.copySells', 'copy trading: true = copy the followed wallets\' sells'],
  ['copy.applyDiscovery', 'copy trading: true = judge copied buys by the discovery rules too'],
];
const SETTING_PATHS = new Set(COACH_SETTINGS.map(([p]) => p));

export function coachSystemPrompt(): string {
  return [
    'You are the trading coach inside TradeWarz, where people run rule-based bots that buy and sell new tokens on Solana, Robinhood Chain, Base and BNB Chain. The person pastes a "review pack": their current rules in words, a summary, every closed trade, the bots\' recent decisions and their open positions.',
    '',
    'Your job: say plainly what is working and what is not, backed by the numbers in the pack (win rate, average return, hold times, which rules made or lost money, which "skip" reasons fire most), then recommend specific changes to the rules.',
    'Rules for you:',
    '- Use only numbers that are in the pack. Never invent trades, prices or statistics. With fewer than about 20 closed trades say the sample is small and keep advice modest.',
    `- Guardrails cannot be loosened, only tightened: stop loss at most ${GUARDRAILS.stopLossMaxPct}%, liquidity-drain exit at or before ${GUARDRAILS.liquidityDrainExitMaxPct}%, buys capped at ${GUARDRAILS.maxBuyPctOfPoolLiquidity}% of pool liquidity, a daily loss breaker at ${GUARDRAILS.dailyLossBreakerPctOfBudget}% of the day's budget, at most ${GUARDRAILS.maxOpenPositions} open positions, slippage under ${GUARDRAILS.slippageMaxPct}%.`,
    '- Never suggest adding money, borrowing, or trading more to win back losses. Smaller size and fewer positions are always acceptable advice.',
    '- Be concise and concrete: short headings, short bullets, no filler, no praise. Name the exact rule and the exact value you would set.',
    '- Finish with a fenced ```json block and nothing after it, of the form {"suggestions":[{"chain":"solana","setting":"exits.stopLossPct","value":20,"why":"one line"}]}. "chain" is one of solana, robinhood, base, bsc. "setting" must be one of the paths below; "value" is a number, true/false, a string, or null. At most 6 suggestions; an empty list is fine.',
    '',
    'Settings you may point at (path — meaning):',
    ...COACH_SETTINGS.map(([p, m]) => `- ${p} — ${m}`),
  ].join('\n');
}

export interface Suggestion { chain: Chain; setting: string; value: unknown; why: string }

/** The JSON block at the end of an answer, checked field by field; anything malformed is dropped quietly. */
export function parseSuggestions(answer: string): Suggestion[] {
  const m = /```json\s*([\s\S]*?)```/i.exec(answer);
  if (!m) return [];
  try {
    const j = JSON.parse(m[1]!) as { suggestions?: unknown };
    if (!Array.isArray(j.suggestions)) return [];
    const out: Suggestion[] = [];
    for (const raw of j.suggestions.slice(0, 8)) {
      const s = raw as Record<string, unknown>;
      const chain = String(s.chain ?? '') as Chain;
      const setting = String(s.setting ?? '');
      if (!CHAINS.includes(chain) || !SETTING_PATHS.has(setting)) continue;
      const v = s.value;
      if (!(v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) continue;
      out.push({ chain, setting, value: v, why: String(s.why ?? '').slice(0, 200) });
    }
    return out;
  } catch { return []; }
}

/** The answer without its JSON block (the page shows suggestions as buttons instead). */
export const withoutSuggestions = (answer: string): string => answer.replace(/```json\s*[\s\S]*?```\s*$/i, '').trimEnd();

/** Set one dotted path on a copy of the strategy. Only paths from COACH_SETTINGS are allowed. */
export function withSetting(strategy: Strategy, path: string, value: unknown): Strategy {
  if (!SETTING_PATHS.has(path)) throw new Error(`"${path}" is not a setting the coach may change`);
  const next = structuredClone(strategy) as unknown as Record<string, unknown>;
  const parts = path.split('.');
  let cur: Record<string, unknown> = next;
  for (const p of parts.slice(0, -1)) {
    const v = cur[p];
    if (typeof v !== 'object' || v === null) { cur[p] = {}; }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return next as unknown as Strategy;
}

// ---- a very small Markdown renderer: escape first, then a handful of shapes ------------------------
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string): string => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');

/** Headings, bullets, numbered lists, code fences, paragraphs. Output is safe to inject: the text is escaped before any tag is added. */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null, para: string[] = [], fence: string[] | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (fence) { if (/^```/.test(line)) { out.push(`<pre>${esc(fence.join('\n'))}</pre>`); fence = null; } else fence.push(line); continue; }
    if (/^```/.test(line)) { flushPara(); closeList(); fence = []; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); out.push(`<h4>${inline(h[2]!)}</h4>`); continue; }
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ni = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (li || ni) {
      flushPara();
      const kind = li ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((li ?? ni)![1]!)}</li>`);
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if (list) closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  if (fence) out.push(`<pre>${esc(fence.join('\n'))}</pre>`);
  return out.join('\n');
}
