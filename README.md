![Overwrite](./media/logo/overwrite-banner.png)

**CBTC covered-call vault on Canton.** Deposit CBTC, and the vault writes weekly
physically-settled covered calls as Daml contracts, then pays the option premium to
holders on-chain. Institutional BTC yield with a book nobody can see.

Built for HackCanton S2 (BitSafe CBTC Bounty + Track 2, Financial Applications),
running on the hackathon devnet. Deadline 2026-07-26.

## Why this exists

CBTC holders have no way to earn yield on-chain today. BitSafe's own vaults wrap
off-chain curated strategies, and on-chain option writing does not exist on Canton
(verified 2026-07-06: Thetanuts announced-only, D2X options not live).

The reference design for this is an EVM option vault, and its worst property is that
everyone can see depositors, vault size, strikes and roll timing. Market makers price
against visible flow, and institutions will not display their BTC holdings for anyone
to read. On Canton every position is a bilateral contract visible only to its parties.
Privacy is the product.

Settlement is atomic physical delivery: at expiry the locked CBTC and the cash strike
leg move in a single transaction. No escrow contract risk, no public-mempool MEV.

## How it works

A vault runs in **epochs**. Each epoch is one full option lifecycle. Mainnet epochs
are weekly; demo epochs are compressed to minutes (a labeled parameter).

![One epoch: open deposits, lock collateral as a CIP-56 allocation, write the call and
pay the premium, then settle OTM or ITM at expiry, record the epoch and
roll](./media/schematics/epoch-lifecycle.png)

Every step is a real lifecycle state change on the ledger. There is no self-trading
and no synthetic volume. Positions are principal-only: premium is **pushed** to holders
as real transfers during the fan-out, never accrued as a claimable balance.

### Privacy is enforced at the ledger, not the UI

The per-depositor book is invisible to everyone except the operator and that one
depositor. That property comes from the Daml signatory and observer model:

![Who can see what: a visibility matrix over the vault, per-depositor positions,
receipts and reports, showing that alice cannot see bob's
position](./media/schematics/privacy-model.png)

- A `VaultPosition` is signed by the operator, with that one depositor as its **sole
  observer**. No depositor is a stakeholder of anyone else's position.
- `PremiumReceipt` and `SettlementReceipt` are per-depositor: the operator signs, the
  single depositor observes, and no depositor learns of any other.
- `EpochReport` carries **aggregate** results only (settlement path, totals, depositor
  count), never a per-holder payout list.
- The `observer` party is a stakeholder of nothing, so its ledger view is genuinely
  empty. The web app server-renders every page with the acting party's own read rights,
  so when a view comes up empty the ledger really did return nothing.

### Settlement never trusts an off-ledger number

The `SettleOTM` / `SettleITM` choices read a `PriceObservation` contract by cid, keyed
by `(asset, epochNumber)`, with freshness and wrong-epoch guards. The oracle publishes
observations; settlement reads them on-ledger. Nobody passes a price in as an argument.

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
daml/       Daml package `overwrite-vault`: the deployable templates. The Daml Script
            suite is a sibling package under `daml/test/`, deliberately not bundled
            into the DAR that goes to devnet.
backend/    TypeScript on the JSON Ledger API
web/        Next.js 16 App Router (server components enforce the privacy reveal)
scripts/    party setup, faucet funding, sandbox, demo/seed scenarios, devnet proofs
media/      demo video source + the schematics above (regenerate: `npm run schematics`
            from `media/demo-src`)
```

### Daml (`daml/src/Overwrite/`)

Nine product templates. Five are core, four are thin supporting contracts.
`Overwrite.Allocation` adds three more (`Holding`, `MockAllocation`,
`MockAllocationFactory`): local stand-ins for the CBTC registry, described under CBTC
integration below.

| Template | Signatories | Purpose |
|---|---|---|
| `Vault` | operator | Epoch counter, params (strike rule, premium split, observation freshness, minimum deposit), deposit-window state. CBTC is pooled in operator custody. Epoch cadence is a scheduler setting, not on-ledger. |
| `VaultPosition` | operator (observer: one depositor) | A depositor's principal-only CBTC claim for the epoch. Choices: `QueueWithdraw`, `PayoutPremium` (consolidation-aware), `RollOver`, `ReturnPrincipal`, `CloseWithProceeds`. |
| `CallOption` | operator (writer), mm-buyer | The written weekly call: notional, strike, expiry, premium. Choices: `PayPremium`, `SettleOTM`, `SettleITM`. |
| `PriceObservation` | oracle (observer: operator) | Asset, price, timestamp, source, demo flag. Read by settlement, keyed by `(asset, epoch)`. |
| `EpochReport` | operator (observer: one depositor) | One per depositor per epoch, carrying aggregate results only. No per-holder list. |
| `PremiumReceipt` | operator (observer: one depositor) | Evidence of a single premium transfer during fan-out. |
| `SettlementReceipt` | operator (observer: one depositor) | Per-depositor record of an ITM close-out (pro-rata proceeds). |
| `EpochSettlement` | operator, mm-buyer | The settled-epoch record: path, observed price, notional, premium. |
| `DepositInvite` | operator (observer: one depositor) | Deposit onboarding for a party. |

`Rollover` is a logic module (post-settlement position lifecycle), split out of
`Vault.daml` under the file-size rule, not a template.

Collateral rides the **CIP-56 allocation surface** (`Allocate` / `ExecuteTransfer` /
`Withdraw`), never a bespoke Daml lock. The templates import the vendored token-standard
packages under `daml/vendor/` and hold the real interface types: `CallOption` carries a
`ContractId Allocation`, and `SettleITM` returns two `Allocation_ExecuteTransferResult`
values. Both settlement legs ride that one interface, which is what lets `SettleITM`
compose them atomically.

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

## Getting started

Package manager is **bun** (workspaces: `backend`, `web`).

```bash
bun install                 # workspace + lint toolchain
bun run lint                # Biome + ESLint
bun run typecheck           # tsc across workspaces
bun run test:backend        # backend unit tests
bun run test:web            # web tests
cd web && bun run build     # web build

# Daml (needs the Daml SDK 3.4.11; run `daml install 3.4.11` on a fresh checkout):
cd daml && daml build && cd test && daml build && daml test
```

Copy `.env.example` to `.env` (public devnet endpoints are pre-filled) and add your
personal `OIDC_USERNAME` / `OIDC_PASSWORD` before running the backend against devnet.
The backend and web dev servers are `bun run dev` in each workspace.

For a local run against the Canton sandbox, `scripts/sandbox.sh` brings up the sandbox
and `scripts/seed-demo` / `scripts/seed-vault` seed a demo epoch.

## Testing

| Layer | Coverage | Verified |
|---|---|---|
| **Daml** | 55 Daml Script tests across 11 suites: full OTM and ITM paths, multi-depositor fan-out, consolidation over the 10-UTXO soft limit, stale/wrong-epoch observation rejection, deposit-window and withdraw-boundary guards, one-position-per-depositor-per-epoch top-up, self-custody | `daml test` (SDK 3.4.11), run from `daml/test/` |
| **Backend** | 217 unit tests across 37 files, each feature tested with the ledger client stubbed | `bun test`, all pass |
| **Web** | 112 tests (ledger-view privacy, deposit/withdraw actions, party defaults, components) | `bun test`, all pass |

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
- **The factory is a parameter, so one choice body serves both ledgers.**
  `Vault.LockCollateral` and `Vault.LockCollateralReal` take a
  `ContractId AllocationFactory` and exercise `AllocationFactory_Allocate` on whatever is
  passed in: the registry's factory on devnet, a local stand-in on the sandbox. That
  stand-in (`Overwrite.Allocation`) is an `interface instance` of the same vendored v1
  packages, so it is a substitute implementation rather than a lookalike, but it is still
  a stand-in: the Daml Script suite and the sandbox demo run against it.
- **Deposit and collateral lock are proven live on devnet, through the vault
  (2026-07-22).** `scripts/devnet-vault-deposit` moved real CBTC from a depositor into
  operator custody via the registry's `TransferFactory_Transfer` (a two-step offer and
  accept), recorded the position with `Vault.RecordDeposit`, and locked the pool with
  `Vault.LockCollateralReal`, which produced a real registry `DvpLegAllocation`. It runs
  the backend's own code paths under `USE_REAL_REGISTRY`, not a script-local
  reimplementation. Transcript and contract ids in
  [the implementation notes](./docs/superpowers/specs/2026-07-21-real-cbtc-vault-integration-design-implementation-notes.md).
- **Not devnet-proven: write, premium fan-out, settlement.** Those halves of the epoch run
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
