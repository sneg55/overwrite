![Overwrite](./media/logo/overwrite-banner.png)

[![CI](https://github.com/sneg55/overwrite/actions/workflows/ci.yml/badge.svg)](https://github.com/sneg55/overwrite/actions/workflows/ci.yml)

**CBTC covered-call vault on Canton.** Deposit CBTC, and the vault writes weekly
physically-settled covered calls as Daml contracts, then pays the option premium to
holders on-chain. Institutional BTC yield, with a book your counterparties cannot read.

Built for HackCanton S2 (BitSafe CBTC Bounty + Track 2, Financial Applications),
running on the hackathon devnet. Deadline 2026-07-26.

## Watch it run

[![Watch the demo](./media/screenshots/demo-poster.png)](./media/overwrite-demo-1.25x.mp4)

2:56, narrated, in this repo: [`media/overwrite-demo-1.25x.mp4`](./media/overwrite-demo-1.25x.mp4).
A full epoch end to end, the privacy reveal, and the devnet lock. There is no hosted
deployment; the [quickstart](#run-it-yourself) runs the same thing locally.

## What is real

Read this before anything else. What counts is what the vault actually does on a ledger,
so here is the line between proven, simulated, and not built.

| Piece | Status |
|---|---|
| Daml templates and the epoch lifecycle | Real, 55 Daml Script tests, full OTM and ITM paths |
| CBTC holdings and transfers | Real CBTC from the devnet faucet, moved through the CIP-56 registry |
| Deposit and collateral lock on devnet | **Proven live 2026-07-22** against the real registry `AllocationFactory`, through the vault |
| Write, premium fan-out, settlement | Local Canton sandbox and Daml Script only. **Not devnet-proven** |
| Allocation answered with `Pending` | Not built. The vault aborts rather than pretend it completed |
| Market maker | **Simulated.** Labeled in the UI, the video, and here |
| Price feed | Operator-run single source. Real public spot by default, demo runs inject a price, and `PriceObservation` records which |
| Premium figures | Demo parameters, not market pricing. No APY or yield claims anywhere |
| Deployment | None hosted. Runs locally against a Canton sandbox, or against devnet with credentials |

## Why this exists

CBTC holders have no way to earn yield on-chain today. BitSafe's own vaults wrap
off-chain curated strategies, and on-chain option writing does not exist on Canton
(checked 2026-07-06: Thetanuts announced-only, D2X options not live).

The reference design for this is an EVM option vault, and its worst property is that
depositors, vault size, strikes and roll timing are all public. Market makers price
against visible flow, and institutions will not display their BTC holdings for anyone
to read. On Canton every position is a bilateral contract visible only to its parties.
Privacy is the product.

Settlement is atomic physical delivery: at expiry the locked CBTC and the cash strike
leg move in a single transaction. No escrow contract risk, no public-mempool MEV.

## How it works

A vault runs in **epochs**. Each epoch is one full option lifecycle. A production epoch
would be one week; demo epochs are compressed to minutes (a labeled parameter).

![One epoch: open deposits, lock collateral as a CIP-56 allocation, write the call and
pay the premium, then settle OTM or ITM at expiry, record the epoch and
roll](./media/schematics/epoch-lifecycle.png)

Every step is a real lifecycle state change on the ledger. There is no self-trading
and no synthetic volume. Positions are principal-only: premium is **pushed** to holders
as real transfers during the fan-out, never accrued as a claimable balance.

### Privacy is enforced at the ledger, not the UI

Three parties, one page, one ledger. The operator is a signatory on every position and
sees the whole book. Alice sees her own row and nothing else. The observer party is a
stakeholder of nothing, so the ledger hands back an empty result.

![The same page read as three parties: operator sees all three depositors totalling 3
CBTC, alice sees only her own 1 CBTC, and observer gets "No vault visible to this
party"](./media/screenshots/privacy-reveal.png)

That last panel is the one that matters. The page is server-rendered with the acting
party's own read rights, so the empty view is the ledger returning nothing, not a filter
applied after the data arrived. The property comes from the Daml signatory and observer
model:

![Who can see what: a visibility matrix over the vault, per-depositor positions,
receipts and reports, showing that alice cannot see bob's
position](./media/schematics/privacy-model.png)

- A `VaultPosition` is signed by the operator, with that one depositor as its sole
  observer. No depositor is a stakeholder of anyone else's position.
- `PremiumReceipt` and `SettlementReceipt` are per-depositor: the operator signs, the
  single depositor observes, and no depositor learns of any other.
- `EpochReport` carries aggregate results only (settlement path, totals, depositor
  count), never a per-holder payout list.

The operator sees everything, by construction: it signs every position. That is a real
limit of this design, not an accident of the demo, and it is why the pitch above says
your counterparties cannot read the book rather than that nobody can.

### Settlement never trusts an off-ledger number

The `SettleOTM` / `SettleITM` choices read a `PriceObservation` contract by cid, keyed
by `(asset, epochNumber)`, with freshness and wrong-epoch guards. The oracle publishes
observations; settlement reads them on-ledger. Nobody passes a price in as an argument.

## Run it yourself

You need `bun`, the Daml SDK 3.4.11 (`daml install 3.4.11`), and a Java 17 runtime.
You do **not** need devnet credentials: the whole lifecycle runs against a local Canton
sandbox.

```bash
bun install

./scripts/sandbox.sh start   # Canton sandbox + JSON Ledger API on :7575, DAR uploaded
./scripts/sandbox.sh seed    # parties, 3 depositors at 1 CBTC, a written call, premium paid
./scripts/sandbox.sh serve   # backend on :3001
./scripts/sandbox.sh web     # UI on :3000
```

Then open <http://localhost:3000/app> and use the **VIEWING AS** switcher to read the
same ledger as `operator`, `alice`, and `observer`. That is the screenshot above,
running on your own machine.

If :3001 is busy, `PORT=3002 ./scripts/sandbox.sh serve` and
`BACKEND_PORT=3002 ./scripts/sandbox.sh web`.

To watch a whole epoch drive itself instead of poking at a seeded one,
`./scripts/sandbox.sh demo` runs deposit through settlement (both OTM and ITM) through
the real backend command builders.

For devnet, copy `.env.example` to `.env` (public endpoints are pre-filled) and add your
own `OIDC_USERNAME` / `OIDC_PASSWORD`.

## Actors (Canton parties)

| Party | Role | Demo status |
|---|---|---|
| `operator` | Runs epochs, coordinates settlement | Real (the app) |
| `alice` / `bob` / `carol` | Depositors: deposit CBTC, receive pro-rata premium | Real (faucet CBTC) |
| `mm-buyer` | Buys the weekly call, pays the premium | **SIMULATED**, labeled in UI and video |
| `oracle` | Publishes BTC/USD price observations | Self-operated single feed: real public spot by default, demo runs can inject a price. Each observation records which. **Labeled** |
| `observer` | Third party used for the privacy reveal | Real (shows an empty ledger view) |

All demo parties are backend-owned and custodial. The web party switcher is a demo
control for reading the ledger from each party's perspective, not an auth boundary.

## Architecture

![Three layers over one Canton participant: the Next.js routes, the backend features
behind a single ledger client, and the Daml package on the JSON Ledger API, plus the
parties and which of them are simulated](./media/schematics/architecture.png)

```
daml/       Daml package `overwrite-vault`: the deployable templates, plus a sibling
            Daml Script package under daml/test/ that is deliberately not bundled
            into the DAR that goes to devnet.  -> daml/README.md
backend/    TypeScript on the JSON Ledger API
web/        Next.js 16 App Router (server components enforce the privacy reveal)
scripts/    party setup, faucet funding, sandbox, demo/seed scenarios, devnet proofs
media/      the demo video, schematics, screenshots, and the video source
            (regenerate the schematics: `npm run schematics` from media/demo-src)
```

Nine product templates, five of them core, plus three local stand-ins for the CBTC
registry. Signatories, choices, the cash leg, and the test matrix are documented in
**[`daml/README.md`](./daml/README.md)**.

Collateral rides the CIP-56 allocation surface (`Allocate` / `ExecuteTransfer` /
`Withdraw`), never a bespoke Daml lock. `CallOption` carries a `ContractId Allocation`
and `SettleITM` returns two `Allocation_ExecuteTransferResult` values, which is what
lets it compose both settlement legs atomically.

### Backend (`backend/src/`)

TypeScript on the JSON Ledger API. Feature-based, with all ledger traffic through one
shared client so features are independently testable with the client stubbed.

- `features/epoch-scheduler` - drives the epoch cron: open, lock, write, settle, roll.
- `features/oracle-poller` - fetches public BTC spot and writes `PriceObservation`.
- `features/mm-simulator` - the simulated buyer: accepts the RFQ, pays premium,
  exercises rationally at expiry.
- `features/rest-api` - REST for the UI, wired through a ledger gateway.
- `services/ledger-client`, `services/registry-client` - the shared ledger and CIP-56
  registry adapters.

### Web (`web/src/`)

Next.js 16 App Router. The app surfaces are all server-rendered with the acting party's
own read rights:

- `/` - the public marketing page. A static server component: no ledger reads and no
  party session, so it renders identically for everyone.
- `/app` (Vault) - epoch timeline, current written call, collateral locked, aggregate
  premium history. Depositors are not stakeholders of the vault, so they are landed on
  their position instead and do not see this tab.
- `/app/position` - "My position" for a depositor (their own book only) or "Vault book"
  for the operator.
- `/app/reports` - settlement history from `EpochReport`.

## Testing

Every push runs the full TypeScript suite and the Daml suite in
[CI](https://github.com/sneg55/overwrite/actions/workflows/ci.yml).

| Layer | Coverage |
|---|---|
| **Daml** | 55 Daml Script tests across 11 files: full OTM and ITM paths, multi-depositor fan-out, consolidation over the 10-UTXO soft limit, stale/wrong-epoch observation rejection, deposit-window and withdraw-boundary guards, one-position-per-depositor-per-epoch top-up, self-custody |
| **Backend** | 217 unit tests across 37 files, each feature tested with the ledger client stubbed |
| **Web** | 112 tests: ledger-view privacy, deposit/withdraw actions, party defaults, components |

Run them locally with `bun run lint`, `bun run typecheck`, `bun run test:backend`,
`bun run test:web`, and the Daml suite via `cd daml && daml build && cd test && daml
build && daml test`.

The Daml Script suite is the fast in-memory regression net: same vendored CIP-56
interfaces, local stand-in factory. Two layers sit above it. Locally,
`./scripts/sandbox.sh demo`, `verify`, `verify-itm` and `verify-deposit` drive full
epochs through the real backend command builders against a Canton sandbox. On devnet,
`scripts/devnet-lock` and `scripts/devnet-vault-deposit` exercise the real registry
`AllocationFactory`, and `scripts/verify-dar` checks a DAR is both uploaded and vetted.

## CBTC integration

- CBTC via the devnet faucet (`cbtc-faucet.devnet.bitsafe.finance`, a plain JSON API; the
  apex host still serves the web UI but its `/api` is dead). Holdings and transfers via
  CIP-56. Demo party funding is scripted in `scripts/fund-parties`.
- Option collateral locks through the CIP-56 allocation surface
  (`AllocationFactory_Allocate` with `allocateBefore` / `settleBefore` windows that map
  1:1 onto a weekly epoch). That surface is the token standard's own lock and DvP
  primitive, so the vault borrows it instead of inventing one.
- The 10-UTXO soft limit per party is handled by consolidating holdings during deposit
  and premium fan-out (the cbtc-lib `check_and_consolidate` pattern).
- The factory is a parameter, which is what lets one choice body serve both ledgers.
  `Vault.LockCollateral` and `Vault.LockCollateralReal` take a
  `ContractId AllocationFactory` and exercise `AllocationFactory_Allocate` on whatever is
  passed in: the registry's factory on devnet, a local stand-in on the sandbox. That
  stand-in (`Overwrite.Allocation`) is an `interface instance` of the same vendored v1
  packages, so it is a substitute implementation rather than a lookalike, but it is still
  a stand-in: the Daml Script suite and the sandbox demo run against it.
- Deposit and collateral lock are **proven live on devnet, through the vault**
  (2026-07-22). `scripts/devnet-vault-deposit` moved real CBTC from a depositor into
  operator custody via the registry's `TransferFactory_Transfer` (a two-step offer and
  accept), recorded the position with `Vault.RecordDeposit`, and locked the pool with
  `Vault.LockCollateralReal`, which produced a real registry `DvpLegAllocation`. It runs
  the backend's own code paths under `USE_REAL_REGISTRY`, not a script-local
  reimplementation. What it left on the ledger: vault `003d7af6...` at
  `windowState = Locked`, the depositor's `VaultPosition` at 0.99 CBTC, and allocation
  `00f478d7...` of template
  `Utility.Registry.V0.Holding.Allocation:DvpLegAllocation`. Read it back for yourself
  with `scripts/devnet-vault-deposit --dry-run`.
- Not devnet-proven: **write, premium fan-out, settlement**. That half of the epoch runs
  on the local sandbox and in the Daml Script suite. One known gap: a live registry may
  answer an allocation with `Pending` (a two-step allocation instruction) where the local
  factory always completes synchronously. The vault aborts on `Pending` rather than
  pretending it completed, and handling that path is not built.
- The v1-vs-v2 allocation API question is settled. Both versions are vetted on the
  devnet participant, but the CBTC registry binds v1 (`Allocation_ExecuteTransfer`): every
  `splice-api-token-*` package inside the registry's own utilities bundle is v1 1.0.0 and
  the v2 package appears nowhere in it, which the live allocation then confirmed.
  `daml/vendor/` pins those v1 packages by content hash.
- Never touches mint/burn (institution-gated). Recipients off-ramp via venues
  (Temple / OneSwap / Bron), not via redemption.

## Honesty rails

These are non-negotiable and baked into the UI, video, and this README:

- **No unsecured counterparty exposure: collateral is locked on-chain.** Not
  "counterparty-risk-free."
- The **market maker is SIMULATED** and labeled everywhere it appears.
- The **price feed is operator-run**, not a production oracle: one party, one source. It
  polls real public spot by default, and demo runs inject a price to force an ITM epoch.
  `PriceObservation` records which one produced it (`source`, `isDemo`), so the ledger
  itself says whether a settlement was driven by a real print or a demo one.
- Premium figures are **demo parameters, not market pricing**. No APY or yield claims
  anywhere in this interface.

## License

[MIT](./LICENSE), covering the code, the Daml package and the docs in this repo.

Two things under this tree are not ours to license and keep their own terms:

- `daml/vendor/*.dar` are Canton Network token-standard (CIP-0056) interface packages,
  redistributed unmodified from Digital Asset's utility bundle. See
  [`daml/vendor/README.md`](./daml/vendor/README.md) for exact provenance and package ids.
- `web/public/fonts/archivo-latin-var.woff2` is the Archivo typeface by Omnibus-Type,
  under the SIL Open Font License 1.1.
