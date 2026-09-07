# Security

TradeWarz handles people's keys in their browsers and moves their money on-chain. If you find a
way to break either of those promises — a key or phrase leaving the tab, a transaction the person
did not ask for, a withdrawal to a wallet that is not theirs, a way to score a trade that did not
happen — please tell us privately first.

## Reporting

Use GitHub's private vulnerability reporting on this repository: **Security → Report a
vulnerability**. It reaches the maintainers without opening a public issue. Please include what
you found, how to reproduce it, and what you think the impact is. You will get an acknowledgement
within a few days; fixes for anything that puts funds at risk take priority over everything else.

Please do not test against other people's wallets or the live hub, and do not open a public
issue or post about a funds-at-risk bug before it is fixed.

## What is in scope

- `web/` — the page, the in-browser bot wallet (`web/src/botwallet/`), the trading engine
  (`web/src/engine/`), everything that can sign a transaction.
- `shared/` — the rule evaluator, the guardrails, the leaderboard scoring.
- `hub/` — sign-in, sessions, the token gate, the candidate stream, the indexer and the board.

Out of scope: the third-party services the hub reads (DexScreener, GeckoTerminal, CoinGecko,
CoinMarketCap, GoPlus, PumpPortal, Jupiter, KyberSwap, public RPCs) and the wallet extensions
(Phantom, MetaMask), except where TradeWarz uses them wrongly.

## What we promise about keys

- The bot wallet is a 12-word phrase generated in the browser, encrypted with the person's
  password (PBKDF2, AES-GCM) in IndexedDB. It is decrypted into memory only for the open tab.
- The hub has no endpoint that accepts a key, a phrase or a signed transaction; it receives
  addresses, signatures over its own sign-in messages, strategies, and transaction hashes.
- The page only offers withdrawals to a sign-in wallet linked to the same account, and the code
  path that signs a withdrawal refuses any other destination. This is a control in the page, not a
  cryptographic one: the key lives in the browser, so anything that runs in the tab could move
  funds — which is why the content security policy allows no third-party scripts, and why a way
  to run script in the page counts as a funds-at-risk bug.
- Nothing prints, logs or persists a mnemonic or a private key, including in tests.

If you find code that contradicts any of these, that is a bug we want to hear about.
