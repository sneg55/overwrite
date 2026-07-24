![Overwrite](./media/logo/overwrite-banner.png)

[![CI](https://github.com/sneg55/overwrite/actions/workflows/ci.yml/badge.svg)](https://github.com/sneg55/overwrite/actions/workflows/ci.yml)

**CBTC covered-call vault on Canton.** Deposit CBTC, and the vault writes weekly
physically-settled covered calls as Daml contracts, then pays the option premium to
holders on-chain. Institutional BTC yield, with a book your counterparties cannot read.

Built for HackCanton S2 (BitSafe CBTC Bounty + Track 2, Financial Applications),
running on the hackathon devnet.

## Watch it run

[![Watch the demo](./media/screenshots/demo-poster.png)](./media/overwrite-demo-1.25x.mp4)

2:56, narrated, in this repo: [`media/overwrite-demo-1.25x.mp4`](./media/overwrite-demo-1.25x.mp4).
A full epoch end to end, the privacy reveal, and the devnet lock. The
[quickstart](#run-it-yourself) runs the same thing locally.

## Why this exists

CBTC holders have no way to earn yield on-chain today. BitSafe's own vaults wrap
off-chain curated strategies, and on-chain option writing does not exist on Canton.

The reference design for this is an EVM option vault, and its worst property is that
depositors, vault size, strikes and roll timing are all public. Market makers price
against visible flow, and institutions will not display their BTC holdings for anyone
to read. On Canton every position is a bilateral contract visible only to its parties.
Privacy is the product.

Settlement is atomic physical delivery: at expiry the locked CBTC and the cash strike
leg move in a single transaction. No escrow contract risk, no public-mempool MEV.

## How it works

A vault runs in **epochs**. Each epoch is one full option lifecycle. A production epoch
would be one week; demo epochs are compressed to minutes.

![One epoch: open deposits, lock collateral as a CIP-56 allocation, write the call and
pay the premium, then settle OTM or ITM at expiry, record the epoch and
roll](./media/schematics/epoch-lifecycle.png)

Positions are principal-only: premium is **pushed** to holders as real transfers during
the fan-out, never accrued as a claimable balance. Premium figures in the demo are
parameters, not market pricing.

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

| Party | Role |
|---|---|
| `operator` | Runs epochs, coordinates settlement |
| `alice` / `bob` / `carol` | Depositors: deposit faucet CBTC, receive pro-rata premium |
| `mm-buyer` | Buys the weekly call, pays the premium. **Simulated**, labeled in the UI |
| `oracle` | Operator-run BTC/USD feed: public spot by default, demo runs inject a price, and each `PriceObservation` records its source |
| `observer` | Third party used for the privacy reveal |

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
scripts/    party setup, faucet funding, sandbox, demo/seed scenarios, devnet scripts
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

The Daml Script suite is the fast in-memory regression net. Above it,
`./scripts/sandbox.sh demo`, `verify`, `verify-itm` and `verify-deposit` drive full
epochs through the real backend command builders against a Canton sandbox, and
`scripts/devnet-lock` and `scripts/devnet-vault-deposit` exercise the registry
`AllocationFactory` on devnet (`scripts/verify-dar` checks a DAR is both uploaded and
vetted).

## CBTC integration

- CBTC comes from the devnet faucet; holdings and transfers move through CIP-56. Demo
  party funding is scripted in `scripts/fund-parties`.
- Option collateral locks through the CIP-56 allocation surface
  (`AllocationFactory_Allocate` with `allocateBefore` / `settleBefore` windows that map
  1:1 onto a weekly epoch). That surface is the token standard's own lock and DvP
  primitive, so the vault uses it instead of inventing one.
- The 10-UTXO soft limit per party is handled by consolidating holdings during deposit
  and premium fan-out (the cbtc-lib `check_and_consolidate` pattern).
- The factory is a parameter, which is what lets one choice body serve both ledgers.
  `Vault.LockCollateral` and `Vault.LockCollateralReal` take a
  `ContractId AllocationFactory` and exercise `AllocationFactory_Allocate` on whatever
  is passed in: the registry's factory on devnet, a local stand-in on the sandbox. The
  stand-in (`Overwrite.Allocation`) is an `interface instance` of the same vendored
  packages, so the Daml Script suite and the sandbox demo exercise the identical
  allocation surface.
- Deposits move through the registry's `TransferFactory_Transfer` (a two-step offer and
  accept) into operator custody, recorded with `Vault.RecordDeposit` and locked with
  `Vault.LockCollateralReal`, which produces a registry `DvpLegAllocation`.
  `scripts/devnet-vault-deposit` drives this on devnet through the backend's own code
  paths under `USE_REAL_REGISTRY`.
- The CBTC registry binds the v1 allocation API (`Allocation_ExecuteTransfer`);
  `daml/vendor/` pins those interface packages by content hash.
- The vault never touches mint/burn (institution-gated). Recipients off-ramp via venues
  (Temple / OneSwap / Bron), not via redemption.

## License

[MIT](./LICENSE), covering the code, the Daml package and the docs in this repo.

Two things under this tree are not ours to license and keep their own terms:

- `daml/vendor/*.dar` are Canton Network token-standard (CIP-0056) interface packages,
  redistributed unmodified from Digital Asset's utility bundle. See
  [`daml/vendor/README.md`](./daml/vendor/README.md) for exact provenance and package ids.
- `web/public/fonts/archivo-latin-var.woff2` is the Archivo typeface by Omnibus-Type,
  under the SIL Open Font License 1.1.
