# TradeWarz

Token-gated, non-custodial trading bots that run in your browser, competing on a weekly
leaderboard scored from the chain — on Solana (pump.fun and everything DexScreener lists),
Robinhood Chain (pons launches), Base and BNB Chain.

Hold TRADEWARZ, sign in with the wallet that holds it, describe your bot in plain sentences, and
it trades from a bot wallet that exists only in your browser tab. Every trade is a real on-chain
transaction signed by that wallet; the hub reads the receipts itself and scores what it can prove.

> **This is trading software for volatile, thinly traded tokens. It can and will lose money.**
> Nothing here is financial advice. Use only funds you can afford to lose, read the code you are
> trusting with your keys, and see the disclaimer at the bottom.

## Why the code is public

The point of publishing is that nobody has to take our word for the two claims that matter:

1. **Your keys never leave your browser.** The bot wallet is a 12-word phrase generated in the
   page, encrypted with your password and stored in your browser's IndexedDB. The hub never
   receives a phrase or a key, never signs, never holds funds. Search this repository for where
   keys are handled: `web/src/botwallet/` and `web/src/engine/`. The hub's API surface is in
   `hub/src/routes.ts` — there is no endpoint that accepts a key.
2. **The leaderboard is scored from the chain, by code you can read.** Tabs report transaction
   *hashes* only (`web/src/engine/report.ts`). The hub reads each receipt itself
   (`hub/src/indexer/`), pairs fills into round trips (`hub/src/indexer/pair.ts`) and scores
   weeks with pure functions in `shared/src/leaderboard.ts` (ISO UTC weeks, eligibility floors,
   exclusions, review). Anyone can re-score a week from the published hashes.

## What's in the repository

| Package | What | License |
|---|---|---|
| `shared/` | The strategy vocabulary (zod schema), guardrails every bot must satisfy, presets, the candidate model, the rule evaluator that turns settings into pass/fail with plain-language reasons, the leaderboard scoring, chain constants. Pure TypeScript, no I/O. | MIT |
| `web/` | The page (Vite + Preact): sign-in, the in-browser bot wallet, the trading engine (`engine/`: one `Bot` per chain behind a `ChainAdapter`), the Terminal (every source in one judged table), the rules builder, positions, the board. | MIT |
| `hub/` | The server (Node 22+, `node:http` + `node:sqlite`): wallet sign-in, the token gate, strategy storage, the live candidate stream (pons launches, pump.fun creations, new pools, DexScreener promotions, CoinGecko/CoinMarketCap listings with a 0–100 score), the indexer, the leaderboard. Serves the built page with a strict CSP. Never holds a key. | BSL 1.1 (see `hub/LICENSE`) |
| `e2e/` | A headless-Chromium drive of the sign-in flow with a mock wallet. | MIT |

## How trading works

- **One bot per chain**, each with its own rules and its own leaderboard. The bot wallet is one
  phrase: an ed25519 key for Solana and one EVM key that is the same address on Robinhood Chain,
  Base and BNB Chain.
- **Rules, not code.** You set discovery, safety, entry, exit and launch rules in the builder;
  the same evaluator (`shared/src/evaluate.ts`) drives the live preview and the bot, so what the
  table shows is exactly what the bot would do.
- **Guardrails** (`shared/src/guardrails.ts`) apply to every bot and cannot be loosened: a stop
  loss, a liquidity-drain exit, a cap on buy size relative to pool liquidity, a daily loss
  breaker and a cap on open positions.
- **Execution** is signed in the tab: pons curves and pools on Robinhood Chain, PumpPortal and
  Jupiter on Solana, the KyberSwap aggregator on Base and BNB Chain. On Base/BNB the bot quotes
  the sell before every buy and refuses tokens it could not get back out of.
- **Launch facts** the rules can use: the creator's own buy, the launch-block bundle (which other
  wallets bought in the same slot/block as the creation and how much of the supply they took),
  curve progress, launcher history, listing score.

## Run it locally

```
npm install --include=dev
npm run build -w shared
npm run dev:hub          # http://127.0.0.1:8787  (API + the built page when TW_WEB_DIST is set)
npm run dev:web          # http://127.0.0.1:5173  (page, proxies /api to the hub)
```

Copy `hub/.env.example` to `hub/.env` and fill in what you have. Everything runs keyless by
default (public RPCs, keyless CoinGecko, CoinMarketCap and GeckoTerminal); keys raise limits.
The token gate is open until the TRADEWARZ contract addresses are set.

```
npm run typecheck && npm test     # shared: schema, guardrails, evaluator, scoring; hub: sign-in, indexer, board
```

## Reporting a security problem

Please do not open a public issue for anything that could put people's funds at risk. Use
GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability);
see `SECURITY.md`.

## Disclaimer

TradeWarz is provided "as is", without warranty of any kind. Trading tokens on decentralised
exchanges carries a high risk of total loss: prices move violently, liquidity vanishes, and
contracts can be malicious in ways no automated check catches. The authors are not investment
advisers and nothing in this software or its documentation is a recommendation to trade any
asset. You are solely responsible for your keys, your funds and your compliance with the laws
that apply to you. The weekly leaderboard is a contest of skill among people who choose to
enter; its rules are in the code and may change with notice.
