// Screenshots of the public pages at phone and desktop widths, for a layout check without an
// account: the front page with the live scanner, the leaderboard tab and the Guide. Uses the
// Chrome already on the machine (or CHROMIUM=path). Run the hub first with TW_WEB_DIST set.
//
//   node e2e/shots.mjs            -> e2e/shot-*.png
//
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const BASE = process.env.TW_BASE ?? 'http://127.0.0.1:8787';
const CANDIDATES = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) { console.error('no Chrome/Chromium found; set CHROMIUM=path'); process.exit(1); }

const browser = await chromium.launch({ executablePath, headless: true });
const shots = [];
for (const [name, width, height, path, tab] of [
  ['phone-home', 390, 844, '/', null],
  ['phone-board', 390, 844, '/', 'Leaderboard'],
  ['phone-guide', 390, 844, '/#guide/score', null],
  ['desktop-home', 1400, 900, '/', null],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => undefined);
  if (tab) await page.getByRole('tab', { name: tab }).click().catch(() => undefined);
  await page.waitForTimeout(2500);
  const file = `e2e/shot-${name}.png`;
  await page.screenshot({ path: file, fullPage: name.includes('guide') ? false : true });
  const rows = await page.locator('table.launches tbody tr').count().catch(() => 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  shots.push({ name, file, rows, horizontalOverflow: overflow, errors });
  await ctx.close();
}
await browser.close();
for (const s of shots) console.log(`${s.name}: ${s.file} rows=${s.rows} overflow=${s.horizontalOverflow}${s.errors.length ? ' errors=' + s.errors.join(' | ') : ''}`);
