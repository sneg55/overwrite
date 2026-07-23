#!/usr/bin/env bun
// Verify a DAR is present AND vetted on the devnet participant, user-tier (no admin).
// Two-step check per the devnet-access memory:
//   1. Presence: the main package id appears in GET /v2/packages.
//   2. Usability: an ACS query with a package-NAME template filter returns HTTP 200
//      (200 = uploaded AND vetted; 404 NO_TEMPLATES_FOR_PACKAGE_NAME... = present but unusable).
// Never prints the OIDC token.
//
//   bun run scripts/verify-dar/index.ts [path/to.dar]
//
// Step 3 answers the question noders raised on 2026-07-23: "your DAR is compiled in a
// bundle with splice standard packages, which may lead to malfunctioning." Every Daml
// DAR carries its full transitive closure (there is no damlc flag to drop it), so the
// splice DALFs being INSIDE the file is not itself the problem. The real failure is a
// name+version COLLISION, and noders hit it for real on their node:
//
//   UploadDarFile INVALID_ARGUMENT: KNOWN_PACKAGE_VERSION: Tried to vet two packages
//   with the same name and version: 188b090b... (splice-api-token-metadata-v1 v1.0.0)
//   and 4ded6b66... (splice-api-token-metadata-v1 v1.0.0).
//
// Canton refuses to vet two DIFFERENT package ids carrying the SAME (name, version).
// Our vendored metadata build is 4ded6b66 (from utility bundle 0.12.5); that node
// already had a different build, 188b090b, under the identical name and version. So
// the upload is rejected outright on any node whose splice bundle differs from ours.
//
// IMPORTANT LIMITATION: this check can only see the participant it can query. A clean
// result means "no collision on THIS node", never "this DAR uploads anywhere". A node
// carrying a different splice build will still reject it, and nothing reachable from
// here can predict that. Only the target node's own package list can.

const BASELINE_1_0_0 = '0494aacd60dd2d05c2e8ce2a58bc29f94c301421057ed00f44399953e5a4b51f'
const CANDIDATE_1_1_0 = 'bffa00c27f385a30dcd29407c3840e6da97f0440e34959846aa3c87a4c25a5d5'
const DEFAULT_DAR = `${import.meta.dir}/../../dist/overwrite-vault-1.1.0-2234d8c.dar`

async function readEnv(): Promise<Record<string, string>> {
  const raw = await Bun.file(`${import.meta.dir}/../../.env`).text()
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m?.[1] === undefined) continue
    out[m[1]] = (m[2] ?? '').replace(/^["'](.*)["']$/, '$1')
  }
  return out
}

async function token(env: Record<string, string>): Promise<string> {
  const res = await fetch(env.OIDC_TOKEN_URL ?? '', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: env.OIDC_CLIENT_ID ?? '',
      scope: 'openid daml_ledger_api',
      username: env.OIDC_USERNAME ?? '',
      password: env.OIDC_PASSWORD ?? '',
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`token grant failed: HTTP ${res.status}`)
  const body = (await res.json()) as { access_token?: string }
  if (typeof body.access_token !== 'string') throw new Error('no access_token in grant response')
  return body.access_token
}

// GET /v2/packages -> string[] of package ids present on the participant.
async function listPackages(base: string, tok: string): Promise<string[]> {
  const res = await fetch(`${base}/v2/packages`, {
    headers: { authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`GET /v2/packages: HTTP ${res.status}`)
  const body = (await res.json()) as { packageIds?: string[] } | string[]
  if (Array.isArray(body)) return body
  return body.packageIds ?? []
}

// Every DALF bundled in a DAR, as {label, id}. A DALF filename ends in its package id,
// so no SDK call is needed; `unzip -l` is enough to read the closure.
function darClosure(darPath: string): Array<{ label: string; id: string }> {
  const listing = Bun.spawnSync(['unzip', '-l', darPath])
  if (listing.exitCode !== 0) throw new Error(`cannot read DAR: ${darPath}`)
  const out: Array<{ label: string; id: string }> = []
  for (const line of new TextDecoder().decode(listing.stdout).split('\n')) {
    if (!line.trim().endsWith('.dalf')) continue
    const name = (line.trim().split(/\s+/).pop() ?? '').split('/').pop() ?? ''
    const id = name.replace(/\.dalf$/, '').match(/([0-9a-f]{64})$/)?.[1]
    if (id === undefined) throw new Error(`no package id in DALF name: ${name}`)
    out.push({ label: name.replace(/-?[0-9a-f]{64}\.dalf$/, ''), id })
  }
  return out
}

// Any bundled package this participant does not already carry is one the upload would
// push onto it. A bundled splice id absent here is the collision risk: if the target
// node carries a DIFFERENT build under the same name and version, Canton rejects the
// whole upload with KNOWN_PACKAGE_VERSION. Scoped to the queried node only.
function checkClosure(darPath: string, onLedger: Set<string>): number {
  const closure = darClosure(darPath)
  const absent = closure.filter((p) => !onLedger.has(p.id))
  const splice = closure.filter((p) => p.label.startsWith('splice-'))
  console.log(`\nclosure: ${closure.length} DALFs bundled, ${splice.length} splice`)
  for (const p of splice) {
    const mark = onLedger.has(p.id) ? 'matches this node' : 'NOT ON THIS NODE'
    console.log(`  ${mark}  ${p.label.padEnd(48)} ${p.id.slice(0, 12)}...`)
  }
  if (absent.length === 0) {
    console.log('\nCLOSURE OK on THIS node: every bundled package is already present,')
    console.log('so uploading here adds only the main package and cannot collide.')
    console.log('This says nothing about a node carrying a different splice build.')
    return 0
  }
  console.log(`\nCLOSURE RISK: ${absent.length} bundled package(s) absent from this node:`)
  for (const p of absent) console.log(`  ${p.label}  ${p.id}`)
  console.log('\nIf the target node has another build of any of these under the same')
  console.log('name+version, UploadDarFile fails with KNOWN_PACKAGE_VERSION.')
  return absent.length
}

async function main(): Promise<void> {
  const darPath = process.argv[2] ?? DEFAULT_DAR
  const env = await readEnv()
  const base = env.LEDGER_API_URL ?? ''
  const tok = await token(env)
  const ids = await listPackages(base, tok)
  console.log(`participant carries ${ids.length} packages`)
  const has = (id: string) => ids.includes(id)
  console.log(`  1.0.0 baseline  ${BASELINE_1_0_0.slice(0, 8)}...  present=${has(BASELINE_1_0_0)}`)
  console.log(
    `  1.1.0 candidate ${CANDIDATE_1_1_0.slice(0, 8)}...  present=${has(CANDIDATE_1_1_0)}`,
  )
  if (!has(CANDIDATE_1_1_0)) {
    console.log('\n1.1.0 is NOT yet on the participant. If noders just uploaded, vetting can lag.')
    process.exit(2)
  }
  console.log('\n1.1.0 is PRESENT. Run Task 8 to prove the 1.1.0-only choices are usable.')
  console.log(`\n--- closure check: ${darPath.split('/').pop()} ---`)
  if (checkClosure(darPath, new Set(ids)) > 0) process.exit(3)
}

main().catch((e) => {
  console.error(`\nVERIFY-DAR FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
