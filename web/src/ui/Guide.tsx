// The Guide tab: everything about the site in plain language - what it is, the two wallets, how
// bots and rules work, every column and panel of the Terminal, exactly how the listing score and
// the leaderboard are computed, what is checked for safety and what is not. Numbers come from the
// same constants the code enforces, so this page cannot drift from the rules.

import { useEffect } from 'preact/hooks';
import { CHAINS, GUARDRAILS, LEADERBOARD_RULES } from '@tradewarz/shared';
import { CHAIN_LABEL } from './helpers.js';

export const GUIDE_SECTIONS = [
  ['what', 'What TradeWarz is'],
  ['getting-in', 'Getting in'],
  ['wallets', 'Your two wallets'],
  ['bots', 'Bots and rules'],
  ['terminal', 'The Terminal'],
  ['panels', 'Recently listed vs New listings'],
  ['score', 'The listing score, point by point'],
  ['bundle', 'The bundle flag'],
  ['positions', 'Positions'],
  ['board', 'The leaderboard'],
  ['safety', 'What is checked, and what is not'],
  ['sources', 'Where the data comes from'],
  ['open', 'Open source'],
] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number][0];

/** Ask the dashboard to open the Guide at a section. Any component can call this. */
export const openGuide = (section: GuideSection): void => { window.dispatchEvent(new CustomEvent('tw:guide', { detail: section })); };

export const REPO_URL = 'https://github.com/tradewarz/tradewarz';

/** The section named in the address bar: #guide or #guide/<section>. */
export function guideFromHash(hash = window.location.hash): GuideSection | 'what' | null {
  const m = /^#guide(?:\/([a-z-]+))?$/.exec(hash);
  if (!m) return null;
  const s = m[1] as GuideSection | undefined;
  return s && GUIDE_SECTIONS.some(([id]) => id === s) ? s : 'what';
}

export function Guide({ section, onBack }: { section: GuideSection | null; onBack?: () => void }) {
  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`g-${section}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [section]);
  const chains = CHAINS.map((c) => CHAIN_LABEL[c]);
  return (
    <div class="guide">
      <nav class="guide-nav">
        {onBack && <button class="btn sm" style="margin-bottom:10px" onClick={onBack}>← Back to sign in</button>}
        <div class="k">On this page</div>
        {GUIDE_SECTIONS.map(([id, title]) => <a key={id} href={`#g-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{title}</a>)}
      </nav>
      <article class="guide-body">
        <h2 id="g-what">What TradeWarz is</h2>
        <p>TradeWarz is a trading arena. You describe a trading bot in plain sentences, and it trades from a wallet that exists only in your browser tab, on {chains.slice(0, -1).join(', ')} and {chains.at(-1)}. Every trade is a real transaction signed by that wallet. Once a week the bots are ranked on a leaderboard scored from the chain itself.</p>
        <p>Three things are true everywhere on this site: <b>nobody but you can move your money</b> (the hub never sees a key), <b>every rule your bot follows is one you can read</b> (the same sentence you set is the check the bot runs), and <b>the board only counts what can be proven on-chain</b>.</p>
        <p class="notice small">This is trading software for volatile, thinly traded tokens. It can lose everything you put in, quickly. Nothing here is investment advice.</p>

        <h2 id="g-getting-in">Getting in</h2>
        <p>Entry is gated by holding TRADEWARZ. You sign in with the wallet that holds it — Phantom on Solana or MetaMask on an EVM chain — by signing a message; no transaction, no gas. The hub checks the balance, then remembers your account (addresses, signatures, your bot's rules — nothing more). The Account tab shows the gate result, lets you link the other chain's wallet, and sets the name shown on the board.</p>

        <h2 id="g-wallets">Your two wallets</h2>
        <p><b>The gate wallet</b> is the one you signed in with. It holds TRADEWARZ, funds your bot by deposit, and is the only place withdrawals can go.</p>
        <p><b>The bot wallet</b> is created in your browser from 12 words, encrypted with your password and kept in this browser only. One phrase gives two keys: a Solana key, and one EVM key that is the same address on Robinhood Chain, Base and BNB Chain. It signs your bot's trades. Fund it on whichever chains you run a bot; move funds back to your gate wallet from the Wallet tab whenever you like.</p>
        <p>Write the 12 words down. If this browser is wiped, the words are the only way back to whatever the bot wallet holds. The hub cannot help — it has never seen them.</p>

        <h2 id="g-bots">Bots and rules</h2>
        <p>You run one bot per chain, each with its own rules and its own leaderboard. Start from a preset (Conservative, Balanced, Degen) and change anything: the Bot tab shows the rules as sentences, "Edit all rules" opens every setting, and "Tune rules" in the Terminal re-judges the live table as you type.</p>
        <p>Rules come in groups. <b>Discovery</b> decides what the bot looks at: age, liquidity, market cap, volume, price change, buy/sell ratio, transaction counts, quote asset, socials. <b>Safety</b> is about the token contract: mint and freeze authority, honeypot, sell tax, holder concentration, and what to do when a check cannot be made. <b>Entry</b> is size, budget, style (instant, pullback, breakout) and slippage. <b>Exits</b> are take profit, stop loss, trailing stop, ladder steps, maximum hold time and the liquidity-drain exit. <b>Launch rules</b> apply only to launches: the creator's own buy and share of supply, curve progress, the launcher's history, exempt wallets and the opening tax on pons, and the <a href="#g-bundle">bundle</a> ceiling. <b>Listing rules</b> apply only to coins that came through a catalogue listing.</p>
        <p><b>Guardrails</b> apply to every bot and cannot be loosened, only tightened: a stop loss no wider than {GUARDRAILS.stopLossMaxPct}%, a liquidity-drain exit at or before {GUARDRAILS.liquidityDrainExitMaxPct}% of the pool leaving, no buy larger than {GUARDRAILS.maxBuyPctOfPoolLiquidity}% of the pool's liquidity, a daily loss breaker at {GUARDRAILS.dailyLossBreakerPctOfBudget}% of the day's budget, at most {GUARDRAILS.maxOpenPositions} open positions per chain, slippage under {GUARDRAILS.slippageMaxPct}%.</p>
        <p>The bot trades only while this tab is open and unlocked. It sleeps when you lock the wallet or close the tab; positions and their exits resume when you come back.</p>

        <h2 id="g-terminal">The Terminal</h2>
        <p>The Terminal is the live scanner: every token the hub is following, on every chain, judged on the spot by your rules for its chain. A row is one token. Click it for the drawer with every fact and a Buy button; click ★ to keep it in Watching.</p>
        <dl class="facts">
          <dt>verdict</dt><dd><b>PASS</b> — passes every rule; the bot would buy (or has). <b>wait</b> — passes, but is waiting for something (the opening tax on pons). <b>no</b> — the first rule that stopped it, in a sentence. <b>HELD</b> — you hold it. <b>traded</b> — bought and sold. A dot means no bot for that chain yet.</dd>
          <dt>age</dt><dd>Since the pool or launch was created.</dd>
          <dt>via</dt><dd>How the hub found it: pump.fun launch, pons launch, new pool, DexScreener boost or profile, new listing, graduation, or added by hand.</dd>
          <dt>liquidity · mcap</dt><dd>Pool liquidity and market cap in dollars, from the curve or from DexScreener.</dd>
          <dt>curve</dt><dd>For launches: how far along the bonding curve it is, or its pons phase (curve, sweeping, pool).</dd>
          <dt>dev</dt><dd>The creator's share of supply from their own launch buy. Red when over your rule.</dd>
          <dt>bundle</dt><dd>Other wallets' buys in the launch block — see <a href="#g-bundle">the bundle flag</a>.</dd>
          <dt>5m Δ · vol 5m · b/s 5m</dt><dd>Price change, volume and buys/sells over the last five minutes.</dd>
          <dt>score</dt><dd>The 0–100 listing score, for coins that came through a catalogue listing — see <a href="#g-score">the score, point by point</a>.</dd>
          <dt>socials</dt><dd>Whether the token declares a website or socials.</dd>
        </dl>
        <p>The filter buttons: <b>All</b>, <b>Passing</b> (PASS and wait), <b>Traded</b> (held or sold), <b>★ Watching</b> (your starred coins, kept even after the hub stops streaming them), <b>Bundled</b>. "Buy by address" opens the buy dialog for any token you paste. The "alerts" button turns on a tone and desktop notifications for passes while a bot is off, buys and sells, bundles on coins you hold or watch, and errors.</p>

        <h2 id="g-panels">Recently listed vs New listings</h2>
        <p>The two panels under the table come from different worlds.</p>
        <p><b>Recently listed</b> is new <i>liquidity pools</i>. GeckoTerminal watches every DEX and reports the moment a pool for a token is created — Raydium or PumpSwap on Solana, pons on Robinhood Chain, Uniswap or Aerodrome on Base, PancakeSwap on BNB Chain. It is the "born a minute ago" feed: thousands a day, most of them junk, nobody has vetted them. The columns are the pool's own numbers.</p>
        <p><b>New listings</b> is coins that <i>CoinGecko or CoinMarketCap just started tracking</i>. Those catalogues add a coin only after someone submits it and a person reviews it, so a coin appearing there is usually days or weeks old and has already cleared a bar. A coin on both catalogues (the ✓) is the strongest signal. The hub then checks each one against DexScreener (real liquidity and volume) and GoPlus (contract safety) and gives it the score and verdict.</p>
        <p>In both panels, <b>judged</b> means the coin is on a chain TradeWarz trades, so it is in the table above with a verdict and can be bought; <b>view only</b> means it is on a chain we do not trade. Click a judged row to open its drawer — if the hub is not following it yet, clicking asks it to.</p>

        <h2 id="g-score">The listing score, point by point</h2>
        <p>Every catalogue listing gets a score from 0 to 100 and a verdict. Nothing about it is hidden: the "why" link on each row lists every point added or taken away. This is the whole recipe.</p>
        <p>It starts at <b>35</b>. Then:</p>
        <dl class="facts">
          <dt>confirmation</dt><dd><b>+20</b> when the same contract is on both CoinGecko and CoinMarketCap inside the confirmation window. One catalogue, or a name-only match, adds nothing.</dd>
          <dt>a DEX price</dt><dd><b>+5</b> when DexScreener has a price for it at all.</dd>
          <dt>liquidity</dt><dd><b>+20</b> at $250,000 or more · <b>+12</b> from $50,000 · <b>+4</b> from $10,000 · <b>−15</b> below $10,000 · <b>−10</b> when no DEX liquidity was found.</dd>
          <dt>24-hour volume</dt><dd><b>+10</b> at $500,000 or more · <b>−8</b> under $25,000.</dd>
          <dt>valuation</dt><dd><b>−12</b> when the fully diluted value is more than 100× the liquidity (a big number resting on a small pool).</dd>
          <dt>pool age</dt><dd><b>−5</b> when the pool is younger than 30 minutes.</dd>
          <dt>security (GoPlus)</dt><dd><b>−100</b> for any hard flag (honeypot, cannot sell, hidden owner…) · <b>−25</b> blacklist capability · <b>−12</b> mintable supply · <b>−15</b> unverified source · <b>−30</b> sell tax over 10% · <b>−10</b> a transfer fee · <b>−20</b> owner or creator holding over 20% · <b>−15</b> top-10 holders over 50% · <b>+5</b> a clean check. <b>−10</b> when no check could be made.</dd>
        </dl>
        <p>The total is clipped to 0–100. Then the verdict: <b>REJECT</b> below 45, or on any hard flag or honeypot, whatever the score. <b>ACT</b> needs a score of 60 or more <i>and</i> either confirmation on both catalogues or a completed clean security check <i>and</i> at least $10,000 of liquidity. Everything else is <b>WATCH</b> — including a 60+ that is only missing confirmation or liquidity, and the row says which.</p>
        <p>The score is a starting point, not a recommendation: it says how much evidence there is that the coin is real and tradeable. Your bot's listing rules decide what to do with it.</p>

        <h2 id="g-bundle">The bundle flag</h2>
        <p>A "bundled" launch is one where the creator lands buys from <i>other</i> wallets in the same block or slot as the launch itself, so insiders hold a slice of the supply at the floor price before anyone else could click. For every launch it sees created, the hub reads the launch block a few seconds later: on Solana the transactions in the creation slot, on Robinhood Chain the CurveBuy events in the launch block. It counts the wallets other than the creator that bought there, adds up their share of the supply and what they spent.</p>
        <p>The chip shows <b>BUNDLE 31%</b> when two or more outside wallets bought in the launch block or they took 3% or more of the supply; <b>clean</b> when nobody else did; dots while the block has not been read; a dash for tokens that were never a launch (a pool has no launch block). The rule "Bundled launches" sets the share you will tolerate and whether to wait for the check before buying. The creator's own buy is a separate rule (the dev column).</p>

        <h2 id="g-positions">Positions</h2>
        <p>Open positions show what you paid, what it is worth now, the peak, and the ladder steps done. <b>Sell now</b> sells the whole position at market. <b>hold by hand</b> stops the bot from selling it (it still prices it); <b>let the bot manage</b> hands it back. Positions bought from the Terminal by hand are marked <i>by hand</i>; they are managed by the bot's exits unless you untick that in the buy dialog.</p>
        <p><b>remove</b> takes a position off the books without selling — for a token that has no market left. Nothing is sold; the tokens stay in your bot wallet and what you paid is booked as a loss. The bot does this by itself for any position that has had no market at all for 30 minutes. The Decisions list records every buy, sell, skip and error with the reason, and links the transaction.</p>

        <h2 id="g-board">The leaderboard</h2>
        <p>Weeks run Monday 00:00 to Monday 00:00 UTC. Your first trade of the week fixes which bot wallet you are entered with on that chain. Each chain has its own board.</p>
        <p><b>The score is percent return on capital deployed</b>: the sum of what your closed trades made or lost, divided by the sum of what they cost, both in dollars at the time. Only round trips that finished in the week count; an open position counts for nothing until it is sold. A ladder exit is one trade, not several.</p>
        <p>To be eligible to win, a week needs at least <b>${LEADERBOARD_RULES.minDeployedUsd}</b> deployed, at least <b>{LEADERBOARD_RULES.minClosedTrades}</b> closed trades, and no single trade worth more than <b>{Math.round(LEADERBOARD_RULES.maxSingleTradeShareOfGain * 100)}%</b> of the week's gain. Two kinds of trade never count: a token you deployed yourself, and a trade that was more than <b>{Math.round(LEADERBOARD_RULES.maxVolumeShare * 100)}%</b> of that token's volume while you held it (trading against yourself). Entries that miss the floors are still shown, unranked, with the reason.</p>
        <p>Nothing you report is believed: your tab sends transaction <i>hashes</i> only, and the hub reads each receipt from the chain itself — what left your wallet, what came back, the gas. The top three are held for {LEADERBOARD_RULES.reviewHours} hours of human review before any prize; a week nobody finished positive rolls over. Prizes are announced on the Board tab when they are on.</p>

        <h2 id="g-safety">What is checked, and what is not</h2>
        <p>Before a buy, the bot checks what it can: the token's contract report from GoPlus where GoPlus covers the chain (mint and freeze authority, honeypot, sell tax, holder concentration); on pons launches, the opening tax it would pay right now; on Base and BNB Chain, a quoted buy-and-sell round trip — if selling straight back would lose more than a quarter of the stake, it does not buy; on launches, the creator's buy, the launch-block bundle and the launcher's history where known. pump.fun tokens are structurally fixed-supply with no mint or freeze, so only their trading behaviour is judged.</p>
        <p>What no check catches: a creator who simply sells everything, a pool that is drained in one block, a contract whose trap only springs later, price manipulation between the quote and the fill. The guardrails limit the damage of each of those; they do not prevent it. Size positions as if any one of them can go to zero, because some will.</p>

        <h2 id="g-sources">Where the data comes from</h2>
        <p>pump.fun launches from PumpPortal's event stream, priced off the bonding curve read straight from Solana; pons launches from Robinhood Chain's own events and curve contracts; pools and market data from DexScreener; new pools from GeckoTerminal; new listings from CoinGecko and CoinMarketCap; contract safety from GoPlus; prices in dollars from CoinGecko; swaps through PumpPortal and Jupiter on Solana and the KyberSwap aggregator on Base and BNB Chain. Each panel's header says when its source is slow or paused.</p>

        <h2 id="g-open">Open source</h2>
        <p>The code is public so that none of this has to be taken on faith: the page and its wallet code under the MIT license, the hub under the Business Source License (readable and auditable by anyone). The scoring and leaderboard rules on this page are the same constants the code enforces — this page reads them from the code, so it cannot say one thing while the bot does another.</p>
        <p><a class="btn sm" href={REPO_URL} target="_blank" rel="noopener noreferrer">Read the code on GitHub</a></p>
      </article>
    </div>
  );
}
