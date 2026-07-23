# Vendored token-standard DARs

These are not built from this repo. They are the Canton Network token-standard
(CIP-0056) interface packages that `daml/daml.yaml` binds as `data-dependencies`, so
Overwrite templates can reference the real `Allocation` / `Holding` interfaces
instead of mirroring them with concrete templates.

## Provenance

Source: the DA utilities release bundle
`https://get.digitalasset.com/utility-dars/canton-network-utility-dars-0.12.5.tar.gz`
(the CBTC utilities registry's own DARs). Each `splice-api-token-*` interface
package ships inside those DARs as a dependency DALF. We extracted the six interface
DALFs plus the exact `daml-prim` / `daml-stdlib` closure they were built against, and
repackaged each interface as a standalone DAR (its own `Main-Dalf`, the shared
closure as `Dalfs`) so `damlc` exposes it as a data-dependency. The repackaging tool
copies bytes verbatim, so package ids are unchanged; `daml damlc inspect-dar`
confirms each DAR's main id below.

Every id was verified present in the 108 packages vetted on the HackCanton devnet
participant on **2026-07-11** (`GET /v2/packages`). A DAR whose id is absent from
that list would be the wrong version and would produce a package devnet cannot use.

| DAR | Package (version) | Main package id | Vetted on devnet |
|---|---|---|---|
| `splice-api-token-metadata-v1.dar` | splice-api-token-metadata-v1 1.0.0 | `4ded6b668cb3b64f7a88a30874cd41c75829f5e064b3fbbadf41ec7e8363354f` | 2026-07-11 |
| `splice-api-token-holding-v1.dar` | splice-api-token-holding-v1 1.0.0 | `718a0f77e505a8de22f188bd4c87fe74101274e9d4cb1bfac7d09aec7158d35b` | 2026-07-11 |
| `splice-api-token-allocation-v1.dar` | splice-api-token-allocation-v1 1.0.0 | `93c942ae2b4c2ba674fb152fe38473c507bda4e82b4e4c5da55a552a9d8cce1d` | 2026-07-11 |
| `splice-api-token-allocation-instruction-v1.dar` | splice-api-token-allocation-instruction-v1 1.0.0 | `275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520` | 2026-07-11 |
| `splice-api-token-allocation-request-v1.dar` | splice-api-token-allocation-request-v1 1.0.0 | `6fe848530b2404017c4a12874c956ad7d5c8a419ee9b040f96b5c13172d2e193` | 2026-07-11 |
| `splice-api-token-transfer-instruction-v1.dar` | splice-api-token-transfer-instruction-v1 1.0.0 | `55ba4deb0ad4662c4168b39859738a0e91388d252286480c7331b3f71a517281` | 2026-07-11 |

Interface signatures were transcribed from these DARs against the live devnet registry
before anything was built on them.

## Which version: v1

The registry binds allocation **v1** (`Allocation_ExecuteTransfer`), not v2
(`Allocation_Settle`). The utilities bundle embeds only the v1 packages; the v2
allocation package (`051a3b05…`) is absent from it entirely.

## Note on size / closure duplication

Each DAR carries the full `daml-prim` + `daml-stdlib` closure (39 DALFs), so the six
files duplicate that closure. This is deliberate: a self-contained DAR is what
`damlc` resolves cleanly as a data-dependency, and loose DALFs fail because their
transitive stdlib package is not on the SDK's default path. The extra ~5 MB is
vendored binary, acceptable for a pinned dependency.

## Regenerating

The bundle download is public; the repackaging is deterministic (verbatim byte
copy). If a future registry version bumps these package ids, re-pull the matching
utility bundle, re-extract, and re-verify every id against a fresh
`GET /v2/packages` before replacing anything here. Do not hand-edit a DAR.
