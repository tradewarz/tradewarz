// Public Risk notice: what can go wrong with volatile tokens and this tooling.
// Opened from the footer via #risk. Plain product description — not legal advice.

import { TG_CHANNEL_URL } from './Guide.jsx';

/** True when the address bar asks for the Risk page. */
export function riskFromHash(hash = window.location.hash): boolean {
  return /^#risk\/?$/i.test(hash);
}

export function Risk({ onBack }: { onBack?: () => void }) {
  return (
    <div class="guide">
      <nav class="guide-nav">
        {onBack && <button type="button" class="btn sm" style="margin-bottom:10px" onClick={onBack}>← Back</button>}
        <div class="k">On this page</div>
        <a href="#r-markets" onClick={(e) => { e.preventDefault(); document.getElementById('r-markets')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Markets</a>
        <a href="#r-tech" onClick={(e) => { e.preventDefault(); document.getElementById('r-tech')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Tech and third parties</a>
        <a href="#r-keys" onClick={(e) => { e.preventDefault(); document.getElementById('r-keys')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Keys and phishing</a>
        <a href="#r-board" onClick={(e) => { e.preventDefault(); document.getElementById('r-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Leaderboard</a>
        <a href="#r-promises" onClick={(e) => { e.preventDefault(); document.getElementById('r-promises')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>No promises</a>
      </nav>
      <article class="guide-body">
        <h2 id="r-intro">Risk</h2>
        <p>TradeWarz is tooling for <b>volatile tokens</b> (including memecoins). This page lists the main risks in plain language. It is <b>not legal or investment advice</b>.</p>
        <p class="muted small">This notice may be updated; last updated September 7, 2026.</p>
        <p class="notice small">TradeWarz is for people <b>18 and older</b>. Only use money you can afford to lose.</p>

        <h2 id="r-markets">Markets</h2>
        <p>Memecoins and other volatile tokens can go to <b>zero</b>. Prices move fast. Slippage, failed transactions, MEV, and thin liquidity can make a trade much worse than the quote you saw — or leave you with nothing.</p>

        <h2 id="r-tech">Tech and third parties</h2>
        <p>Smart contracts can have bugs. RPC providers can be slow, wrong, or down. TradeWarz also depends on third-party data and routing (for example Jupiter, DexScreener, GeckoTerminal / CoinGecko, PumpPortal). Any of those can fail, rate-limit, or change without notice.</p>

        <h2 id="r-keys">Keys and phishing</h2>
        <p>Your bot wallet keys live in this browser. Clearing site data, losing the recovery phrase, malware, or a phishing site that looks like TradeWarz can mean <b>permanent loss</b> of funds. The hub cannot recover a lost phrase.</p>

        <h2 id="r-board">Leaderboard and research</h2>
        <p>Scores, rankings, and research views are derived from reported trades and public chain reads. They are <b>not</b> a guarantee of skill, honesty, or future profit. Past results do not predict the next trade.</p>

        <h2 id="r-promises">No promises</h2>
        <p>We do not promise uptime, prizes, token performance, or that any feature will stay available. Buying may be paused. Features may change. You decide every trade.</p>
        <p>Questions: Telegram <a href={TG_CHANNEL_URL} target="_blank" rel="noopener noreferrer">@tradewarzhq</a> ({TG_CHANNEL_URL}), or through the site.</p>
      </article>
    </div>
  );
}
