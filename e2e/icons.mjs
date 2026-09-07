// App icons from the brand avatar (web/public/avatar.png, 1600x1600), rendered by the Chrome on this
// machine so no image library is needed:
//   icons/icon-192.png, icons/icon-512.png     the plain icon (any purpose)
//   icons/maskable-512.png                     padded on a dark ground for platforms that mask icons
//   icons/apple-touch-icon.png                 180x180 on the same ground (iOS ignores transparency)
//
//   node e2e/icons.mjs
//
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [process.env.CHROMIUM, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) { console.error('no Chrome/Chromium found; set CHROMIUM=path'); process.exit(1); }

const GROUND = '#0f1115';
const src = readFileSync(fileURLToPath(new URL('../web/public/avatar.png', import.meta.url))).toString('base64');
const outDir = fileURLToPath(new URL('../web/public/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="data:image/png;base64,${src}">`);
await page.waitForFunction(() => { const i = document.getElementById('i'); return i && i.complete && i.naturalWidth > 0; });

const render = (size, pad, ground) => page.evaluate(([size, pad, ground]) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ground) { ctx.fillStyle = ground; ctx.fillRect(0, 0, size, size); }
  ctx.imageSmoothingQuality = 'high';
  const inner = size - 2 * pad;
  ctx.drawImage(document.getElementById('i'), pad, pad, inner, inner);
  return c.toDataURL('image/png').split(',')[1];
}, [size, pad, ground]);

for (const [name, size, pad, ground] of [
  ['icon-192.png', 192, 0, null],
  ['icon-512.png', 512, 0, null],
  ['maskable-512.png', 512, 64, GROUND],
  ['apple-touch-icon.png', 180, 14, GROUND],
]) {
  writeFileSync(`${outDir}${name}`, Buffer.from(await render(size, pad, ground), 'base64'));
  console.log(`wrote web/public/icons/${name}`);
}
await browser.close();
