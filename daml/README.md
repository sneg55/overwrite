# daml

Daml package `overwrite`: the on-chain product.

## SDK + package layout

Daml **3.4.11** (latest stable 3.x), aligned with the devnet Canton 3.x line. Two
packages (`multi-package.yaml`):

- `overwrite` (this dir, `src/`): templates only. No `daml-script` dependency, so the
  DAR uploaded to devnet stays lean.
- `overwrite-test` (`test/`): the Daml Script proofs. Data-depends on the templates
  DAR.

Build order matters (templates first, tests second). The deprecated assistant's
`daml build --all` is broken for multi-package, so build each explicitly:

```bash
daml build                 # from daml/       -> overwrite-<v>.dar (deployable)
cd test && daml build      # from daml/test/  -> overwrite-test-<v>.dar
cd test && daml test       # run the Script suite
```

## Implemented (all building + passing on SDK 3.4.11)

Templates (`src/Overwrite/`):

- `Allocation.daml`: shared allocation surface (`Holding` + `Allocation` with
  `Allocate` / `ExecuteTransfer` / `Withdraw`, plus `Transfer` / `Merge` / `Split`
  for deposits, consolidation, and premium chunking). One pair serves both legs.
- `Vault.daml`: operator control contract (`Deposit`, `OfferDeposit`, `OpenDeposits`,
  `LockCollateral`, `WriteCall`, `RecordEpoch`); mutable per-epoch state machine.
- `VaultPosition.daml`: pro-rata claim (`QueueWithdraw`, `PayoutPremium`, `RollOver`,
  `ReturnPrincipal`); principal-only, depositor-private.
- `CallOption.daml`: the option primitive (`PayPremium`, `SettleOTM`, `SettleITM`
  atomic DvP); reads a `PriceObservation` with asset/epoch/freshness guards.
- `PriceObservation.daml` (with a `Revise` choice that archives the superseded
  observation, so a settle choice fetching a live cid gets the latest price),
  `EpochReport.daml` (aggregate), `PremiumReceipt.daml` (per-depositor),
  `SettlementReceipt.daml` (per-depositor ITM close-out record). The self-custody
  `DepositInvite` template lives inside `Vault.daml` (merged to break a type-level
  import cycle), not its own file. Post-settlement rollover logic is in
  `Rollover.daml`.

Daml Script suite (`test/Overwrite/`), 30 tests all passing:

- `AllocationTest`: allocation cycle + atomic DvP at the surface level (spikes 0.2/0.3).
- `LifecycleTest`: full OTM path, full ITM path (atomic DvP), 3-depositor fan-out
  (N receipts; aggregate report leaks no per-party list; a depositor cannot see
  another's receipt); `RecordEpoch` derives its aggregates from ledger state.
- `EdgeCaseTest`: deposit-outside-window, stale + wrong-epoch observation rejected,
  withdraw returns principal and skips rollover, pool-coverage and deposit-minimum
  guards.
- `RolloverTest`: OTM roll (withdrawers paid principal, rest roll) and ITM
  close-and-distribute (every position closes to pro-rata strike proceeds), including
  the full-withdrawal and uneven-proceeds edge cases and the reject-OTM-branch-after-ITM
  regression guard.
- `ObservationTest`: `Revise` archives the predecessor; only the oracle may revise.
- `ConsolidationTest`: consolidation above the 10-UTXO soft limit (11 UTXOs).
- `SelfCustodyTest`: the `OfferDeposit` / `AcceptDeposit` propose-accept path.

## Templates

**5 core templates** (`src/Overwrite/`):

1. `Vault` (signatory `operator`): epoch counter + params, deposit window state,
   pooled CBTC. Choices: `OpenDeposits`, `LockCollateral` (one
   `AllocationFactory_Allocate` for the pool), `WriteCall`, `RecordEpoch`,
   `OfferDeposit`. Archived + recreated each epoch; the cid changes every epoch.
2. `VaultPosition` (signatory `operator`, observer `depositor`): principal-only
   pro-rata claim. Choices: `QueueWithdraw` (depositor), `PayoutPremium`
   (operator; pushes pro-rata cash + writes a `PremiumReceipt`, enforcing the cash
   instrument), `RollOver`, `ReturnPrincipal`, and `CloseWithProceeds` (operator;
   pays pro-rata strike proceeds and writes a `SettlementReceipt` when the epoch
   settled ITM). `Vault.RollPositions` (in `Rollover.daml`) drives these at the
   epoch boundary, branching on the settlement path: OTM returns principal in CBTC
   and rolls; ITM closes every position to cash.
3. `CallOption` (signatory `operator`, observer `mmBuyer`): the gap-filling option
   primitive. Choices: `PayPremium`, `SettleOTM` (price <= strike;
   `Allocation_Withdraw`), `SettleITM` (price > strike; `Allocation_ExecuteTransfer`
   atomic DvP). Holds `collateralAllocationCid`; never re-implements locking.
4. `PriceObservation` (signatory `oracleParty`): a signed price. Settlement reads it
   by cid, keyed `(asset, epochNumber)`, with freshness + wrong-epoch guards. A
   `Revise` choice republishes in place and archives the predecessor, so the latest
   observation is the only one a settle choice can fetch (LF 2 has no contract keys).
   Labeled `DEMO` when the operator injects a price for recorded paths.
5. `EpochReport` (signatory `operator`, observer a single `depositor`): aggregate
   results only, no per-holder payout list. `RecordEpoch` derives the aggregates
   from the fetched positions and receipts (never operator-supplied totals) and
   creates one copy per depositor, so the aggregate reaches everyone without
   exposing the depositor set.

**3 supporting contracts:**

- `PremiumReceipt` (signatory `operator`, observer the single `depositor`):
  per-depositor premium payout record for the privacy-preserving fan-out.
- `SettlementReceipt` (signatory `operator`, observer the single `depositor`):
  per-depositor record of an ITM close-out (pro-rata strike proceeds).
- `DepositInvite` (signatory `operator`, observer `depositor`, defined inside
  `Vault.daml`): propose/accept handle for self-custody deposits (`AcceptDeposit`,
  controller `depositor`).

## Cash leg

`mock-usdc` package: `MockUsdcHolding` + a `MockUsdcAllocationFactory` implementing
the **same** CIP-56 allocation interface as CBTC, so `SettleITM` composes both legs
in one submission. Demo-only, labeled everywhere. Built regardless of whether a
real devnet stable instrument turns up.

## Test suite (`test/`)

Daml Script, in-memory, the fast regression net. Covers full OTM + ITM paths,
multi-depositor fan-out (N receipts, aggregate leaks no per-party list), and edge
cases (withdraw-at-boundary, consolidation over the 10-UTXO soft limit, stale /
wrong-epoch observation, deposit-outside-window).

This suite is the fast regression net, not the whole gate: it cannot catch a choice
signature change that leaves `scripts/` or the backend command builders stale. After
any such change, run the live lifecycle checks in `scripts/sandbox.sh` (`demo` covers
deposit through settle; `verify` / `verify-itm` reach the record-and-roll half;
`verify-deposit` covers a deposit landing mid-window).

## Init (once)

The package is pinned to Daml **3.4.11**. Install that SDK on a fresh checkout
(the assistant auto-fetches it on first build, or run `daml install 3.4.11`):

```bash
daml version        # 3.4.11
daml build          # from daml/       -> deployable templates DAR
cd test && daml build && daml test
```

Note: the classic `daml` assistant is deprecated in 3.4 in favor of DPM
(Digital Asset Package Manager). Commands still work here; migrate to DPM later.
When deploying to devnet, re-confirm the DAR's LF/protocol target is accepted by
the devnet Canton (3.5.6).
