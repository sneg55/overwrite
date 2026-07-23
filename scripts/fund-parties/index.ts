#!/usr/bin/env bun
// Fund demo/participant parties from the CBTC devnet faucet.
//
// Usage:
//   bun scripts/fund-parties <party...> [--amount N] [--network devnet] [--execute]
//   bun scripts/fund-parties --file parties.json [--amount N] [--execute]
//   bun scripts/fund-parties --check            # liveness only: networks, limits, balance
//
// Dry-run by default. Real funding requires --execute (it hits the live devnet and
// consumes unknown faucet rate limits, so it is opt-in). Party ids are `hint::1220...`.
//
// parties.json format: { "parties": ["hint::1220...", "..."] }  (see parties.example.json)

import {
  clampAmount,
  type FaucetConfig,
  type FaucetLimits,
  fundParty,
  getDefaultBalance,
  getLimits,
  getNetworks,
  isPartyId,
  loadFaucetConfig,
} from './faucet-client'

const POLITE_DELAY_MS = 1_500
const DEFAULT_AMOUNT = 1.0

interface Args {
  parties: string[]
  file?: string
  amount?: number
  network?: string
  execute: boolean
  check: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { parties: [], execute: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--execute') args.execute = true
    else if (a === '--check') args.check = true
    else if (a === '--file') args.file = argv[++i]
    else if (a === '--amount') args.amount = Number(argv[++i])
    else if (a === '--network') args.network = argv[++i]
    else if (a === '--party') args.parties.push(argv[++i] ?? '')
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`)
    else args.parties.push(a)
  }
  return args
}

async function loadPartiesFromFile(path: string): Promise<string[]> {
  const raw = (await Bun.file(path).json()) as { parties?: unknown }
  if (!Array.isArray(raw.parties)) {
    throw new Error(`${path}: expected { "parties": [ ... ] }`)
  }
  return raw.parties.map(String)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureNetworkAndLimits(cfg: FaucetConfig): Promise<FaucetLimits> {
  const networks = await getNetworks(cfg)
  const known = networks.map((n) => n.name)
  if (!known.includes(cfg.network)) {
    throw new Error(`Network "${cfg.network}" not served. Known: ${known.join(', ')}`)
  }
  const limits = await getLimits(cfg)
  console.log(
    `Faucet ${cfg.baseUrl} network=${cfg.network} limits=[${limits.min_amount}, ${limits.max_amount}]`,
  )
  return limits
}

async function runCheck(cfg: FaucetConfig): Promise<number> {
  const bal = await getDefaultBalance(cfg)
  console.log(
    `Default party balance: ${bal.balance} CBTC (${bal.utxo_count} UTXOs) party=${bal.party_id}`,
  )
  console.log('Note: the faucet balance endpoint reports only this fixed default party.')
  return 0
}

async function resolveParties(args: Args): Promise<string[]> {
  const parties = args.file !== undefined ? await loadPartiesFromFile(args.file) : args.parties
  if (parties.length === 0) {
    throw new Error('No parties given. Pass party ids, or --file parties.json, or --check.')
  }
  const bad = parties.filter((p) => !isPartyId(p))
  if (bad.length > 0) {
    throw new Error(`Not valid party ids (expected hint::1220...): ${bad.join(', ')}`)
  }
  return parties
}

async function runFunding(cfg: FaucetConfig, limits: FaucetLimits, args: Args): Promise<number> {
  const parties = await resolveParties(args)
  const amount = clampAmount(args.amount ?? DEFAULT_AMOUNT, limits)
  const mode = args.execute ? 'EXECUTE' : 'DRY-RUN'
  console.log(
    `[${mode}] funding ${parties.length} part${parties.length === 1 ? 'y' : 'ies'} with ${amount} CBTC each`,
  )

  let failures = 0
  for (const party of parties) {
    if (!args.execute) {
      console.log(
        `  would POST /api/faucet { network: ${cfg.network}, recipient_party: ${party}, amount: "${amount}" }`,
      )
      continue
    }
    const result = await fundParty(cfg, party, amount)
    console.log(`  ${result.ok ? 'OK ' : 'ERR'} ${party}: ${result.detail}`)
    if (!result.ok) failures++
    await sleep(POLITE_DELAY_MS)
  }

  if (!args.execute) console.log('Dry run only. Re-run with --execute to fund for real.')
  return failures > 0 ? 1 : 0
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadFaucetConfig()
  if (args.network !== undefined) cfg.network = args.network

  const limits = await ensureNetworkAndLimits(cfg)
  if (args.check) return await runCheck(cfg)
  return await runFunding(cfg, limits, args)
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`fund-parties failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
