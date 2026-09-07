// Public Terms of use: what TradeWarz is and is not. Opened from the footer via #terms.
// Plain product description — not legal advice.

import { TG_CHANNEL_URL, REPO_URL } from './Guide.jsx';

/** True when the address bar asks for the Terms page. */
export function termsFromHash(hash = window.location.hash): boolean {
  return /^#terms\/?$/i.test(hash);
}

export function Terms({ onBack }: { onBack?: () => void }) {
  return (
    <div class="guide">
      <nav class="guide-nav">
        {onBack && <button type="button" class="btn sm" style="margin-bottom:10px" onClick={onBack}>← Back</button>}
        <div class="k">On this page</div>
        <a href="#t-what" onClick={(e) => { e.preventDefault(); document.getElementById('t-what')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>What this is</a>
        <a href="#t-custody" onClick={(e) => { e.preventDefault(); document.getElementById('t-custody')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Non-custodial</a>
        <a href="#t-gate" onClick={(e) => { e.preventDefault(); document.getElementById('t-gate')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>The gate</a>
        <a href="#t-you" onClick={(e) => { e.preventDefault(); document.getElementById('t-you')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Your decisions</a>
        <a href="#t-contact" onClick={(e) => { e.preventDefault(); document.getElementById('t-contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Contact</a>
      </nav>
      <article class="guide-body">
        <h2 id="t-intro">Terms</h2>
        <p>These terms describe how <b>TradeWarz</b> (<a href="https://tradewarz.app" target="_blank" rel="noopener noreferrer">tradewarz.app</a>) works as a product. They are written in plain English for users — <b>not legal advice</b>.</p>
        <p class="muted small">This notice may be updated; last updated September 7, 2026.</p>
        <p class="notice small">TradeWarz is for people <b>18 and older</b>. If you are under 18, do not use the site.</p>

        <h2 id="t-what">What this is</h2>
        <p>TradeWarz is <b>software tooling</b> for watching and trading volatile tokens on Solana, Robinhood Chain, Base, and BNB Chain. It is <b>not investment advice</b>, not a recommendation to buy or sell anything, and <b>not a broker, exchange, or custodian</b>.</p>
        <p>Open-source intent: the code lives at <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL.replace('https://', '')}</a>.</p>

        <h2 id="t-custody">Non-custodial</h2>
        <p>Private keys and recovery phrases stay in <b>your browser</b>. The hub never receives them. Hub scores and the leaderboard come from public chain data and transaction hashes your tab reports — not from holding your funds.</p>
        <p>Sessions, strategies, and related account data may be stored on the hub so the product works across visits. See the <a href="#privacy">Privacy</a> notice for what is kept where.</p>

        <h2 id="t-gate">The gate</h2>
        <p>When a token gate is configured, holding the required amount of TRADEWARZ (or being on an allowlist) is how you get trading access. The gate is <b>access control</b>, not an investment product. Prizes or rewards apply only if they are separately disclosed on the site.</p>

        <h2 id="t-you">Your decisions</h2>
        <p>These markets can wipe out what you put in. <b>You alone</b> decide what to trade, how much, and when. We may pause buys, change features, or take the hub offline when needed. Continued use after a change means the revised terms apply.</p>

        <h2 id="t-contact">Contact</h2>
        <p>Questions: Telegram <a href={TG_CHANNEL_URL} target="_blank" rel="noopener noreferrer">@tradewarzhq</a> ({TG_CHANNEL_URL}), or through the site.</p>
      </article>
    </div>
  );
}
