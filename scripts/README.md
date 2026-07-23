# scripts

Operational and demo scripts. Run on **bun**.

- `party-setup/`: provision the demo parties (`operator`, `oracle`, `mm-buyer`,
  `depositor-*`) on the hackathon participant node.
- `fund-parties/`: **implemented.** Scriptable faucet funding via the plain JSON API
  (no auth). Dry-run by default; `--execute` to fund for real; polite delay between
  requests. Verified live against the faucet on 2026-07-06.

  ```bash
  bun scripts/fund-parties --check                    # networks, limits, default balance
  bun scripts/fund-parties <party::1220...>           # dry-run preview
  bun scripts/fund-parties --file parties.json --execute   # fund a list for real
  ```

  Config via env: `FAUCET_URL` (default `https://cbtc-faucet.devnet.bitsafe.finance`; the faucet moved to per-network subdomains 2026-07-13, the apex host's `/api` is dead),
  `FAUCET_NETWORK` (default `devnet`). Note: the faucet's `GET /api/balance/{network}`
  reports only a fixed default party, so read per-party balances from the ledger.
- `demo-scenario/`: deterministic replay driving a full compressed epoch. Used for
  dev iteration and for recording the pre-recorded ITM second epoch (demo path B).
- `ledger-smoke/`: **implemented.** Spike 0.1 plumbing check against the HackCanton
  devnet JSON Ledger API. `bun scripts/ledger-smoke` verifies reachability (no auth;
  confirmed Canton 3.5.6 live). `bun scripts/ledger-smoke --auth` also fetches a
  Keycloak bearer token and makes an authenticated call (needs `OIDC_USERNAME` /
  `OIDC_PASSWORD`).
