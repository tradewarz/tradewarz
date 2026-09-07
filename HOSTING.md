# Hosting the hub

The hub is one Node 22+ process: the API, the live stream, the indexer, and the built page, all on one port.
It keeps one SQLite file and a few JSON snapshots on disk. Nothing else — no queue, no cache server, no
second database. That makes it cheap to run and easy to move, with one rule: **the disk must persist.**

## Render (the recommended path)

`render.yaml` in the repo root describes the service. In the Render dashboard: New → Blueprint → pick the
`tradewarz/tradewarz` repo → Render reads the file and asks for the values marked `sync: false`.

What the blueprint sets up, and why:

| Setting | Value | Why |
| --- | --- | --- |
| Plan | Starter or above | Persistent disks are not available on the free tier. A free instance also sleeps, which kills the live stream. |
| Disk | `/var/data`, 1 GB | Without it every deploy or restart wipes sessions, strategies, the leaderboard and the intel baseline. `TW_DB` points here; the snapshots follow it. |
| Instances | exactly 1 | SQLite has one writer; the stream and the rate limits are in-process. Never enable autoscaling. |
| Node | 22.18.0 (`NODE_VERSION`) | `node:sqlite` needs 22.13 or newer. |
| Build | `npm install --include=dev && npm run build` | The build needs TypeScript and Vite (dev dependencies). |
| Start | `npm start` | Runs `node dist/server.js` inside `hub/`, so `TW_WEB_DIST=../web/dist`. |
| Health check | `/api/health` | Unauthenticated, no personal data, reports the feeds. |
| `TW_HOST` | `0.0.0.0` | Render's proxy connects from outside the container. |
| `PORT` | set by Render | The hub reads `PORT` when `TW_PORT` is not set. |
| `TW_TRUST_PROXY` | `proxy` | Rate limits key on the client address; behind one proxy the last `x-forwarded-for` hop is the client. Use `cloudflare` when Cloudflare fronts Render. |
| `TW_PUBLIC` | `1` | Fail-safe mode: the gate is **closed** (everyone may look, nobody trades) until the token addresses exist, and the cookie is Secure. |

Deploys restart the process (a disk-backed service cannot do a zero-downtime swap). Open tabs reconnect on
their own; bots resume when the stream is back. Expect a gap of about a minute.

### Values you fill in

- `TW_DOMAIN` — the hostname people type (`tradewarz.app`, not `https://…`). It is inside the message wallets
  sign; if it does not match what the browser sees, sign-in fails with a clear message.
- `TW_RPC_SOLANA` — the hub's Helius URL. Private; never shown to anyone.
- `TW_PUBLIC_RPC_SOLANA` — a **second** Helius key for browsers. Every visitor can read it, so in the Helius
  dashboard (API key → Access Control Rules → Allowed Domains) lock it to `TW_DOMAIN` before the site is public.
  The hub logs a note at start-up when this URL carries a key.
- `TW_OWNER_WALLETS` — the wallet address(es) you sign in with. Owners see Review, Research and Ops.
- `TW_TOKEN_SOLANA` / `TW_TOKEN_ROBINHOOD` — the TRADEWARZ contract(s). Setting either switches the gate from
  closed to token mode. Until then the page tells signed-in people that trading opens at launch.
- `TW_PRIZES` stays `0` until you decide otherwise; the board runs regardless.

### Gate modes, and how a public hub behaves

| Mode | When | Who trades |
| --- | --- | --- |
| `open` | no token configured, `TW_PUBLIC` off (local development) | everyone; the page shows "gate open · setup" |
| `closed` | no token configured, `TW_PUBLIC` on | nobody; the Terminal, board and Guide stay public |
| `token` | a token address is set | holders of `TW_GATE_REQUIRED` TRADEWARZ in a linked wallet |

Your own sign-in wallets (`TW_OWNER_WALLETS`) always pass the gate, closed or not, so you can trade on the public
hub before the token exists. `TW_GATE_ALLOWLIST` (comma-separated wallet addresses) does the same for testers.
A public beta with the gate open for everyone is also possible — set `TW_GATE_MODE=open` on purpose — and the
hub warns loudly in its log when you do.

### Backups

The database is one file: `/var/data/tradewarz.sqlite` (plus `-wal`/`-shm` while running). Render keeps disk
snapshots on paid plans (the disk's Snapshots tab); on top of that, an owner can pull the research exports
(`Research` tab → export) any time — closed trades, fills and every strategy version as CSV or JSON. Do that
weekly until the contest matters enough to automate it.

### The brake

Signed in as an owner, the Review tab has **Controls**: "Pause all buying" stops every open tab from entering
(exits, sells and withdrawals keep working) and a notice line shows on every screen. Both take effect within ten
seconds and survive a restart. Use them during an incident before you touch anything else.

### Checklist before the domain goes public

1. Blueprint deployed, `/api/health` answers, the page loads over HTTPS.
2. `TW_DOMAIN` matches the address bar; signing in with Phantom and MetaMask works.
3. The browser Helius key is locked to the domain; the hub key is not in `TW_PUBLIC_RPC_*`.
4. Start-up log shows `gate=CLOSED` (or `token` once the contract is set), `cookieSecure=yes`, `proxy=proxy`.
5. Your wallet is in `TW_OWNER_WALLETS` and the Ops tab shows feed health.
6. Disk mounted: after a redeploy, sessions and strategies survive.

## Anywhere else (a VPS, Fly, a home server)

The same rules apply: Node 22.13+, one instance, a real disk for `TW_DB`, `TW_PUBLIC=1`, `TW_COOKIE_SECURE=1`,
HTTPS terminated in front (Caddy, nginx, Cloudflare), `TW_TRUST_PROXY=proxy` (or `cloudflare`), and
`TW_HOST=127.0.0.1` when the proxy runs on the same machine. `hub/.env.example` lists every knob.
