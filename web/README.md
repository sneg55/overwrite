# web

Next.js 16.2.10 App Router + React 19. Runs on **bun**. Builds green
(`bun run build`).

Server components structurally enforce the privacy reveal: data never leaves the
server for a party that cannot see it, so the empty observer view is real, not a
client-side filter.

## Implemented

- `src/app/`: dashboard (`page.tsx`), my-position (`position/`), epoch reports
  (`reports/`), shared `layout.tsx` with nav + party switcher.
- `src/components/`: `party-switcher.tsx` (the only client component; sets the
  acting-party cookie and reloads so the server re-scopes every screen), plus
  presentational `card.tsx` / `badge.tsx` (SIMULATED / demo-parameter labels).
- `src/lib/`: `parties.ts` (client-safe party constants), `party-session.ts`
  (server-side acting party from the cookie), `ledger-view.ts` (party-scoped
  projections: operator sees all, a depositor sees only their own, observer sees
  nothing), `types.ts`, and `demo-data.ts` (labeled placeholder until the
  ledger-client ACS queries are wired).

Run: `bun install` (repo root), then `bun run dev` here. Lint: this workspace uses
`next lint` / `next build` type-checking; it is excluded from the repo-root
Biome/ESLint (which is tuned for backend library code).

## Next styling step

shadcn/ui + Tailwind is the intended design system (the badges above are the
labeling rails). The current styling is a minimal `globals.css`; adding shadcn is
a mechanical follow-up.

## Screens

- **Vault dashboard**: TVL, epoch timeline (countdown), premium history, current
  `CallOption` state. Server components (read-heavy).
- **My position**: party-scoped principal, premium received this epoch (from the
  depositor's own `PremiumReceipt`), withdraw-queue toggle.
- **Deposit / withdraw**: primary write actions (client components hitting route
  handlers). Premium is pushed automatically; payouts mint exact amounts, so
  there is no residual to sweep.
- **Party switcher**: the privacy-reveal control. Each switch is a server-side
  session that re-queries the ledger as that party. Switch to `observer` and the
  ACS query returns nothing, server-rendered.
- **Epoch report view**: aggregate `EpochReport` + the viewer's own
  `PremiumReceipt`.

## Labeling rails (shadcn badges)

MM tagged `SIMULATED`; oracle tagged with its trust model; premium figures tagged
"demo parameter, not market pricing"; no APY anywhere.

## Scaffold (once, at build time)

Pin exact minor versions when scaffolding. Suggested:

```bash
bunx create-next-app@latest . --ts --app --src-dir --tailwind --eslint
bunx shadcn@latest init
```

Then organize under `src/`: `app/` (routes), `features/` (feature UIs),
`components/` (shared + shadcn), `lib/` (ledger read helpers, party session).
