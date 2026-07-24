# Daml: the on-chain product

Two packages, declared in `multi-package.yaml`:

- **`overwrite-vault`** (this directory, `src/`) version 1.2.0: the templates, and the
  only DAR that goes to devnet. It has no `daml-script` dependency, so the deployable
  artifact stays lean.
- **`overwrite-test`** (`test/`) version 0.1.0: the Daml Script suite. It data-depends
  on the templates DAR, so build order matters.

Daml SDK **3.4.11**, aligned with the devnet Canton 3.x line. The build needs a Java 17
runtime (Canton is a JVM process); `daml build` alone does not, everything else does.

```bash
daml build                 # from daml/      -> overwrite-vault-1.2.0.dar (deployable)
cd test && daml build      # from daml/test/ -> overwrite-test-0.1.0.dar
cd test && daml test       # 55 tests
```

`daml build --all` is broken for multi-package under the deprecated assistant, so build
each explicitly, templates first.

## Templates

Nine product templates across `src/Overwrite/`, plus three local stand-ins for the CBTC
registry in `Allocation.daml` (`Holding`, `MockAllocation`, `MockAllocationFactory`).

Five templates are core: they hold the vault's state and drive the epoch. The other four
are records, created once as evidence and never exercised again.

| Template | Core | Signatories | Purpose |
|---|---|---|---|
| `Vault` | yes | operator | Epoch counter, params (strike rule, premium split, observation freshness, minimum deposit), deposit-window state. CBTC is pooled in operator custody. Epoch cadence is a scheduler setting, not on-ledger. |
| `VaultPosition` | yes | operator (observer: one depositor) | A depositor's principal-only CBTC claim for the epoch. Choices: `QueueWithdraw`, `PayoutPremium` (consolidation-aware), `RollOver`, `ReturnPrincipal`, `CloseWithProceeds`. |
| `CallOption` | yes | operator (writer), mm-buyer | The written weekly call: notional, strike, expiry, premium. Choices: `PayPremium`, `SettleOTM`, `SettleITM`. |
| `PriceObservation` | yes | oracle (observer: operator) | Asset, price, timestamp, source, demo flag. Read by settlement, keyed by `(asset, epoch)`. A `Revise` choice archives the superseded observation, so a settle choice fetching a live cid gets the latest price. |
| `EpochReport` | yes | operator (observer: one depositor) | One copy per depositor per epoch, carrying aggregate results only. `RecordEpoch` derives those aggregates from fetched positions and receipts rather than operator-supplied totals, so the aggregate reaches everyone without exposing the depositor set. |
| `PremiumReceipt` | | operator (observer: one depositor) | Evidence of a single premium transfer during fan-out. |
| `SettlementReceipt` | | operator (observer: one depositor) | Per-depositor record of an ITM close-out (pro-rata proceeds). |
| `EpochSettlement` | | operator, mm-buyer | The settled-epoch record: path, observed price, notional, premium. |
| `DepositInvite` | | operator (observer: one depositor) | Propose and accept handle for self-custody deposits. Defined inside `Vault.daml` rather than its own module, to break a type-level import cycle. |

`Rollover.daml` is a logic module (post-settlement position lifecycle), split out of
`Vault.daml` under the file-size rule. It holds no template.

## Collateral rides the CIP-56 allocation surface

Never a bespoke Daml lock. The templates import the vendored token-standard packages
under `vendor/` and hold the real interface types: `CallOption` carries a
`ContractId Allocation`, and `SettleITM` returns two `Allocation_ExecuteTransferResult`
values. Both settlement legs ride that one interface, which is what lets `SettleITM`
compose them atomically.

`Vault.LockCollateral` and `Vault.LockCollateralReal` take a
`ContractId AllocationFactory` and exercise `AllocationFactory_Allocate` on whatever is
passed in: the registry's factory on devnet, the local stand-in on the sandbox. The
stand-in is an `interface instance` of the same vendored v1 packages, so it is a
substitute implementation rather than a lookalike. It is still a stand-in. See the CBTC
integration section of the [root README](../README.md) for what that does and does not
prove.

## The cash leg

There is no separate cash package. The strike leg uses the same `Holding` template with
a different `instrument` string (`mUSDC`), and `VaultPosition.PayoutPremium` checks that
string before it pays. One template and one allocation interface serve both legs, which
is what lets `SettleITM` settle CBTC against cash in a single submission. The cash
instrument is a demo instrument and is labeled as one everywhere it surfaces.

## Privacy

Enforced here, at the signatory and observer sets, never in the web layer. A
`VaultPosition` is signed by the operator with that one depositor as its sole observer,
so no depositor is a stakeholder of anyone else's position. Do not add a field or an
observer that would widen this.

## Tests

55 Daml Script tests across 11 files in `test/Overwrite/`:

| Suite | Covers |
|---|---|
| `LifecycleTest` | Full OTM path, full ITM path (atomic DvP), multi-depositor fan-out (N receipts, aggregate report leaks no per-party list, no depositor sees another's receipt) |
| `EdgeCaseTest` | Deposit outside the window, stale and wrong-epoch observations rejected, withdraw returns principal and skips rollover, pool-coverage and deposit-minimum guards |
| `RolloverTest` | OTM roll (withdrawers paid principal, the rest roll), ITM close-and-distribute, full-withdrawal and uneven-proceeds edges, and the reject-OTM-after-ITM regression guard |
| `VaultGuardTest` | Vault choice guards |
| `AllocationTest` | Allocation cycle and atomic DvP at the interface level |
| `DepositTopUpTest` | One position per depositor per epoch, topped up rather than duplicated |
| `ConsolidationTest` | Consolidation above the 10-UTXO soft limit |
| `ObservationTest` | `Revise` archives the predecessor; only the oracle may revise |
| `SelfCustodyTest` | The `OfferDeposit` and `AcceptDeposit` propose-accept path |
| `RealPathTest` | The real-registry code path against the local stand-in factory |

They run in-memory against the same vendored CIP-56 interfaces and the local stand-in
factory. That makes them the fast regression net, not proof against a live registry;
for that see `scripts/devnet-vault-deposit`.

### This suite is not the whole gate

It cannot catch a choice signature change that leaves `scripts/` or the backend command
builders stale. After any such change, run the live lifecycle checks in
`scripts/sandbox.sh`: `demo` covers deposit through settle, `verify` and `verify-itm`
reach the record-and-roll half that `demo` never touches, and `verify-deposit` covers a
deposit landing mid-window. Picking the wrong one passes while proving nothing.
