// Public Privacy notice: what the hub stores, what stays in the browser, and what is already public on-chain.
// Opened from the footer via #privacy. Plain product description — not legal advice.

import { TG_CHANNEL_URL } from './Guide.jsx';

/** True when the address bar asks for the Privacy page. */
export function privacyFromHash(hash = window.location.hash): boolean {
  return /^#privacy\/?$/i.test(hash);
}

export function Privacy({ onBack }: { onBack?: () => void }) {
  return (
    <div class="guide">
      <nav class="guide-nav">
        {onBack && <button type="button" class="btn sm" style="margin-bottom:10px" onClick={onBack}>← Back</button>}
        <div class="k">On this page</div>
        <a href="#p-store" onClick={(e) => { e.preventDefault(); document.getElementById('p-store')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>What we store</a>
        <a href="#p-device" onClick={(e) => { e.preventDefault(); document.getElementById('p-device')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>What stays on your device</a>
        <a href="#p-chain" onClick={(e) => { e.preventDefault(); document.getElementById('p-chain')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>What is public on-chain</a>
        <a href="#p-contact" onClick={(e) => { e.preventDefault(); document.getElementById('p-contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Contact</a>
        <a href="#p-updates" onClick={(e) => { e.preventDefault(); document.getElementById('p-updates')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Updates</a>
      </nav>
      <article class="guide-body">
        <h2 id="p-intro">Privacy</h2>
        <p>This notice describes how <b>TradeWarz</b> (<a href="https://tradewarz.app" target="_blank" rel="noopener noreferrer">tradewarz.app</a>) handles information. TradeWarz is <b>non-custodial</b>: private keys stay in your browser. The hub never receives them.</p>
        <p class="muted small">This notice may be updated; last updated September 7, 2026.</p>
        <p class="notice small">TradeWarz is for people <b>18 and older</b>. We do not knowingly collect account data from anyone under 18.</p>

        <h2 id="p-store">What we store</h2>
        <p>When you use the site, the hub may keep:</p>
        <ul>
          <li><b>Wallet addresses</b> you connect or register (gate wallets and bot wallet addresses).</li>
          <li><b>Sessions</b> so you stay signed in across visits.</li>
          <li><b>Strategies and rules</b> you save for your bots.</li>
          <li><b>Leaderboard and research</b> data — scores, rankings, and related activity derived from reported trades and public chain reads.</li>
          <li><b>Control settings</b> used by the site (for example owner notices or a temporary buy pause).</li>
          <li><b>Transaction hashes</b> your tab reports so the board can verify trades on-chain.</li>
        </ul>
        <p>We may also see ordinary web traffic needed to run the service (such as requests to the hub). Links you open to Telegram or X are handled by those services under their own policies.</p>

        <h2 id="p-device">What stays on your device</h2>
        <p>Your bot wallet’s <b>private keys and recovery phrase</b> are created and kept in this browser (encrypted in IndexedDB). They are not uploaded to the hub. Preferences and other client-only state may also live in local browser storage.</p>
        <p>Clearing site data for tradewarz.app removes that local material. If you lose the phrase and clear the browser, the hub cannot recover the wallet.</p>

        <h2 id="p-chain">What is public on-chain</h2>
        <p>Blockchains are public. Addresses, balances, transfers, and transaction hashes are visible to anyone. The hub reads public chain data to price activity, run the leaderboard and research views, and check gate holdings when a token gate is configured. We cannot erase public chain records.</p>

        <h2 id="p-contact">Contact</h2>
        <p>Questions about this notice or your hub account: Telegram <a href={TG_CHANNEL_URL} target="_blank" rel="noopener noreferrer">@tradewarzhq</a> ({TG_CHANNEL_URL}), or through the site.</p>

        <h2 id="p-updates">Updates</h2>
        <p>We may change this notice as the product changes. The “last updated” line at the top will move when we do. Continued use of tradewarz.app after an update means the revised notice applies.</p>
      </article>
    </div>
  );
}
