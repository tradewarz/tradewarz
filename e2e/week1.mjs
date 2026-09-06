// End-to-end drive of the onboarding path and the dashboard in headless Chromium, with a
// mock MetaMask (real secp256k1 key) and a mock Phantom (real ed25519 key). Run the hub
// first with TW_WEB_DIST set (see README).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const require = createRequire(import.meta.url);
const naclSrc = readFileSync(require.resolve('tweetnacl/nacl-fast.min.js'), 'utf8');
const bs58Src = `(function(){const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function enc(b){let z=0;while(z<b.length&&b[z]===0)z++;const d=[];for(const x of b){let c=x;for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0}while(c>0){d.push(c%58);c=(c/58)|0}}let s='';for(let i=0;i<z;i++)s+='1';for(let i=d.length-1;i>=0;i--)s+=A[d[i]];return s}
window.__bs58={encode:enc};})();`;

const BASE = process.env.TW_BASE ?? 'http://127.0.0.1:8787';
const evm = privateKeyToAccount(generatePrivateKey());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: process.env.TW_DARK ? 'dark' : 'light' });
await ctx.addInitScript(naclSrc);
await ctx.addInitScript(bs58Src);
// Mock MetaMask: personal_sign is answered by Node (the real account) through an exposed function.
await ctx.exposeFunction('__evmSign', async (hexMessage) => evm.signMessage({ message: { raw: hexMessage } }));
await ctx.addInitScript((address) => {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
      if (method === 'personal_sign') return window.__evmSign(params[0]);
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_chainId') return '0x1237';
      throw new Error('mock: ' + method);
    },
  };
  const nacl = window.nacl;
  let seedHex = sessionStorage.getItem('mock-seed');
  if (!seedHex) { const s = crypto.getRandomValues(new Uint8Array(32)); seedHex = Array.from(s).map((b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('mock-seed', seedHex); }
  const seed = Uint8Array.from(seedHex.match(/../g).map((h) => parseInt(h, 16)));
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const sol = window.__bs58.encode(kp.publicKey);
  window.phantom = { solana: { isPhantom: true, publicKey: { toBase58: () => sol }, connect: async () => ({ publicKey: { toBase58: () => sol } }), signMessage: async (bytes) => ({ signature: nacl.sign.detached(bytes, kp.secretKey) }), signAndSendTransaction: async () => { throw new Error('mock: no funds'); } } };
}, evm.address);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const step = (s) => console.log('·', s);

// 1. Sign in with MetaMask only (Vik's case).
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Sign in with MetaMask' }).click();
await page.getByRole('heading', { name: 'Create your bot wallet' }).waitFor();
step('signed in with the mock MetaMask → straight to "Create your bot wallet"');

// 2. Create the wallet.
await page.getByPlaceholder('Password (8+ characters)').fill('correct horse battery');
await page.getByPlaceholder('Repeat it').fill('correct horse battery');
await page.getByRole('button', { name: 'Create wallet' }).click();
await page.getByRole('heading', { name: 'Save these 12 words' }).waitFor();
const words = await page.locator('.phrase span').allTextContents();
if (words.length !== 12) throw new Error('expected 12 words');
await page.locator('input[type=checkbox]').check();
await page.getByRole('button', { name: 'Continue' }).click();
step('wallet created, 12 words saved');

// 3. Pick a bot: Robinhood Chain (default, because MetaMask signed in), Balanced.
await page.getByRole('heading', { name: 'Pick your first bot' }).waitFor({ timeout: 30_000 });
const seg = await page.locator('.segmented button.on').textContent();
if (seg.trim() !== 'Robinhood Chain') throw new Error('default chain should follow the sign-in wallet, got ' + seg);
await page.getByRole('button', { name: /Start with Balanced/ }).click();
await page.getByRole('heading', { name: 'Robinhood Chain bot' }).waitFor({ timeout: 20_000 });
const onPill = await page.locator('.card h2 .pill.ok', { hasText: 'on' }).count();
if (onPill !== 1) throw new Error('bot should be ON right after picking (bot wallets were registered first)');
step('Balanced Robinhood bot saved and ON — the exact click that failed before');

// 4. Dashboard: change preset, switch off/on, add a Solana bot, tabs.
await page.locator('select').first().selectOption('degen');
await page.getByText('Switched to Degen').waitFor();
await page.getByRole('button', { name: 'Switch off' }).click();
await page.locator('.card h2 .pill', { hasText: 'off' }).waitFor();
await page.getByRole('button', { name: 'Switch on' }).click();
await page.locator('.card h2 .pill.ok', { hasText: 'on' }).waitFor();
await page.getByRole('button', { name: 'Add a Solana bot' }).click();
await page.getByRole('button', { name: /Start with Balanced/ }).click();
await page.getByRole('heading', { name: 'Solana bot' }).waitFor();
step('preset changed, off/on works, Solana bot added');
await page.getByRole('tab', { name: 'Wallet' }).click();
const registered = await page.locator('.pill.ok', { hasText: 'registered' }).count();
if (registered !== 2) throw new Error('both bot wallets should show registered, got ' + registered);
await page.getByRole('tab', { name: 'Account' }).click();
await page.getByRole('button', { name: 'Link Phantom' }).click();
await page.getByText('Phantom wallet linked').waitFor();
step('wallet tab: both registered; account tab: Phantom linked as second gate wallet');

// 4b. The engine: panel is live for the ON Robinhood bot, survives a tab switch, numbers save.
await page.getByRole('tab', { name: 'Bot' }).click();
await page.locator('.botpanel .health').last().waitFor();
await page.waitForTimeout(1500);
let health = await page.locator('.botpanel .health').last().textContent();
if (!/live|connecting/.test(health)) throw new Error('bot panel not live: ' + health);
await page.getByRole('tab', { name: 'Wallet' }).click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: 'Bot' }).click();
health = await page.locator('.botpanel .health').last().textContent();
if (!/live|connecting/.test(health)) throw new Error('engine stopped on tab switch: ' + health);
await page.getByRole('button', { name: 'Edit numbers' }).last().click();
const numbers = page.locator('.numbers').last();
await numbers.locator('input').nth(0).fill('0.0003');
await numbers.locator('input').nth(1).fill('1');
await numbers.locator('input').nth(2).fill('0.001');
await numbers.locator('input').nth(5).fill('95'); // stop loss over the rail
await numbers.getByText(/at most 90%/).waitFor();
if (await numbers.getByRole('button', { name: 'Save numbers' }).isEnabled()) throw new Error('save should be disabled while a rail is violated');
await numbers.locator('input').nth(5).fill('30');
await numbers.getByRole('button', { name: 'Save numbers' }).click();
await page.getByText('Numbers saved').waitFor();
await page.waitForFunction(() => /Spend 0.0003 ETH per trade/.test(document.body.textContent || ''), null, { timeout: 15000 });
step('engine live, survives tab switch, numbers editor refuses a loosened rail and saves valid ones');

// 4c. Terminal: the scanning board. Two launches arrive (injected locally, the hub path is the
// same code), one passes the Degen rules and one does not; the drawer names the rule.
await page.getByRole('tab', { name: 'Terminal' }).click();
await page.locator('table.launches').waitFor();
await page.evaluate(() => {
  const now = Date.now();
  const base = (sym, name, addr, extra) => ({
    chain: 'robinhood', address: addr, pairAddress: '0x' + '22'.repeat(20), dexId: 'pons', symbol: sym, name, quoteSymbol: 'ETH', createdAt: now - 120_000,
    liquidityUsd: 3200, marketCapUsd: 40_000, fdvUsd: 40_000, priceUsd: 0.00004, priceNative: 1.6e-8,
    volumeUsd: { m5: 900, h1: 900, h6: 900, h24: 900 }, priceChangePct: { m5: 12, h1: 12, h6: null, h24: null },
    txns: { m5: { buys: 9, sells: 2 }, h1: { buys: 9, sells: 2 }, h6: null, h24: null }, hasSocials: true, boosted: false, source: 'pons-launch',
    safety: { mintRenounced: true, freezeRenounced: true, top10HoldersPct: null, lpBurnedOrLocked: null, honeypot: false, sellTaxPct: 1.5, source: 'pons', checkedAt: now },
    pons: { curve: '0x' + '33'.repeat(20), deployer: '0x' + '44'.repeat(20), phase: 0, devSharePct: 2.5, creatorTaxBps: 100, exemptWallets: 1, openingTaxBps: 0, progress: 0.12, feeToDeployer: true, deployerPrior: 0, deployerGraduated: 0, quoteReserve: '1300000000000000000', tokenReserve: '900000000000000000000000000', realQuoteReserve: '1300000000000000000', feeBps: 50, graduated: false, readyToGraduate: false, pairToken: '0x0000000000000000000000000000000000000000', pairDecimals: 18, ...extra },
    updatedAt: now,
  });
  window.tradewarz.hubStream.inject(base('TESTA', 'Test Alpha', '0x' + '11'.repeat(20), {}));
  window.tradewarz.hubStream.inject(base('TESTB', 'Test Bravo', '0x' + '55'.repeat(20), { devSharePct: 30 }));
});
await page.locator('table.launches tr.pass', { hasText: 'TESTA' }).waitFor({ timeout: 5000 });
await page.locator('table.launches tr.skip', { hasText: 'TESTB' }).waitFor();
await page.locator('table.launches tr', { hasText: 'TESTB' }).click();
await page.locator('.drawer').getByText(/launcher kept 30/).waitFor();
const dsHref = await page.locator('.drawer a', { hasText: 'DexScreener' }).getAttribute('href');
if (dsHref !== 'https://dexscreener.com/robinhood/0x' + '55'.repeat(20)) throw new Error('DexScreener link wrong: ' + dsHref);
await page.keyboard.press('Escape');
await page.locator('.drawer').waitFor({ state: 'detached' });
await page.locator('.segmented button', { hasText: /^Passing/ }).click();
if (await page.locator('table.launches tbody tr', { hasText: 'TESTB' }).count() !== 0) throw new Error('Passing filter still shows a failing launch');
step('terminal: launches judged live, drawer names the failing rule, DexScreener link, filter works');
await page.locator('.segmented button', { hasText: /^All/ }).click();
await page.getByRole('button', { name: 'Tune rules' }).click();
await page.getByText(/1 of 2 launches pass with these rules/).waitFor();
await page.locator('.term-side.tune .brow', { hasText: "Launcher's own share of supply" }).locator('input').fill('35');
await page.getByText(/2 of 2 launches pass with these rules/).waitFor();
await page.locator('table.launches tr.pass', { hasText: 'TESTB' }).waitFor();
if (process.env.TW_SHOTS) { await page.screenshot({ path: 'e2e/terminal.png', fullPage: false }); await page.locator('table.launches tr', { hasText: 'TESTA' }).click(); await page.screenshot({ path: 'e2e/terminal-drawer.png', fullPage: false }); await page.keyboard.press('Escape'); }
await page.locator('.term-side.tune .brow', { hasText: 'Max open positions' }).locator('input').fill('30');
await page.locator('.term-side.tune').getByText(/At most 25 positions/).waitFor();
if (await page.locator('.term-side.tune').getByRole('button', { name: 'Save rules' }).isEnabled()) throw new Error('save should be disabled over the open-positions rail');
await page.getByRole('button', { name: 'Discard' }).click();
await page.locator('table.launches tr.skip', { hasText: 'TESTB' }).waitFor();
step('tune rules: the table re-judges as you type, the 25-position rail holds, discard restores');

// 4d. The full rules editor: every section, a refused rail, style-dependent fields, save.
await page.getByRole('tab', { name: 'Bot' }).click();
await page.getByRole('button', { name: 'Edit all rules' }).last().click();
await page.getByRole('heading', { name: /Edit every rule · Robinhood Chain/ }).waitFor();
for (const sec of ['Discovery', 'Safety', 'Entry and sizing', 'Exits', 'Advanced', 'pons launches']) {
  if ((await page.locator('.bsec h3', { hasText: sec }).count()) !== 1) throw new Error('editor section missing: ' + sec);
}
await page.getByText(/1 of 2 launches the hub is watching would pass/).waitFor();
const row = (label) => page.locator('.brow', { hasText: label });
await row('Stop loss at').locator('input').fill('95');
await page.locator('.builder-side').getByText(/at most 90%/).waitFor();
if (await page.locator('.builder-side').getByRole('button', { name: 'Save rules' }).isEnabled()) throw new Error('save should be disabled while a rail is violated');
await row('Stop loss at').locator('input').fill('30');
await row('Entry style').locator('select').selectOption('pullback');
await row('Pullback between').waitFor();
await row('Must declare a website or socials').locator('input[type=checkbox]').check();
await page.locator('.ladder').getByRole('button', { name: 'add a step' }).click();
await row('Bot name').locator('input').fill('My rules');
await row("Launcher's own share of supply").locator('input').fill('35');
await page.getByText(/2 of 2 launches the hub is watching would pass/).waitFor();
if (process.env.TW_SHOTS) await page.screenshot({ path: 'e2e/builder.png', fullPage: false });
await page.locator('.builder-side').getByRole('button', { name: 'Save rules' }).click();
await page.getByText('Rules saved').waitFor();
await page.locator('.card', { hasText: 'Robinhood Chain bot' }).waitFor();
await page.waitForFunction(() => { const card = [...document.querySelectorAll('.card')].find((c) => (c.textContent || '').includes('Robinhood Chain bot')); const sel = card && card.querySelector('select'); return !!sel && sel.value === ''; }, null, { timeout: 15000 }).catch(() => { throw new Error('a hand-edited bot should show as Custom'); });
await page.waitForFunction(() => /My rules|pullback|Pullback/.test(document.body.textContent || ''), null, { timeout: 15000 });
step('full editor: every section, refused rail, style fields, live match count, saved as Custom');

// 5. Reload: locked → wrong password refused → unlock → dashboard, not onboarding.
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'Unlock your bot wallet' }).waitFor();
await page.getByPlaceholder('Password').fill('wrong password!!');
await page.getByRole('button', { name: 'Unlock' }).click();
await page.getByText('Wrong password.').waitFor();
await page.getByPlaceholder('Password').fill('correct horse battery');
await page.getByRole('button', { name: 'Unlock' }).click();
await page.getByRole('heading', { name: 'Robinhood Chain bot' }).waitFor({ timeout: 20_000 });
step('reload → unlock → dashboard');

await page.screenshot({ path: 'e2e/dashboard.png', fullPage: true });
const me = await page.evaluate(async () => (await fetch('/api/me')).json());
console.log('hub sees:', me.me.wallets.map((w) => `${w.role}:${w.chain}`).join(' '));
const fatal = errors.filter((e) => !/net::ERR|Failed to fetch|429|403|api.mainnet-beta|rpc.mainnet|mock:/.test(e));
if (fatal.length) { console.log('page errors:', fatal); process.exitCode = 1; } else step('no page errors');
await browser.close();
