// Client-safe party constants (no server-only imports), so both the client party
// switcher and the server session module can share them.

export const PARTIES = ['operator', 'alice', 'bob', 'carol', 'mm-buyer', 'observer'] as const
export type Party = (typeof PARTIES)[number]

export const PARTY_COOKIE = 'overwrite-party'

export function isParty(value: string | undefined): value is Party {
  return value !== undefined && (PARTIES as readonly string[]).includes(value)
}

/**
 * Reduce a ledger party's hint to the friendly name this app compares and displays.
 *
 * A party id is `<hint>::<namespace>`, and on a local sandbox we allocate the hint we
 * want, so the hint IS the friendly name. On a shared participant it is not: parties
 * are namespaced to avoid colliding with other teams, so devnet hands us
 * `alice-overwrite` where the app means `alice`.
 *
 * That gap is silent and dangerous. Three places compare a depositor hint against a
 * `Party` value (a depositor's own-position filter, the withdraw button's ownership
 * check, and premium-receipt joining). Every one of them just stops matching, so a
 * depositor sees an empty book with no error. In a privacy demo that is indistinguishable
 * from the ledger correctly showing them nothing, which is exactly the wrong thing to be
 * ambiguous about.
 *
 * The suffix is stripped only when what remains is a party this app knows. An unrelated
 * party that happens to end in the same string keeps its full hint rather than being
 * silently rewritten into one of ours.
 */
export function normalizePartyHint(hint: string, suffix: string | undefined): string {
  if (suffix === undefined || suffix === '' || !hint.endsWith(suffix)) return hint
  const stripped = hint.slice(0, -suffix.length)
  return isParty(stripped) ? stripped : hint
}

// A party id is not a role. The switcher shows what each party *is* to the vault, so a
// reader can tell why a given view is empty. All demo parties are backend-owned and
// custodial; the switcher is a demo control, not an auth boundary.
export const PARTY_ROLE: Record<Party, string> = {
  operator: 'Vault operator',
  alice: 'Depositor',
  bob: 'Depositor',
  carol: 'Depositor',
  'mm-buyer': 'Market maker (simulated)',
  observer: 'Non-stakeholder',
}

// The /app/position surface is the depositor's own book but the operator's whole-vault
// book, so its name depends on who is reading. One source of truth, used by the nav tab,
// the page H1, and the browser tab title, so those three can never disagree. Anyone else
// (the market maker, an observer) is a stakeholder of no position, so neither name fits.
export function positionLabel(party: Party): string {
  if (PARTY_ROLE[party] === 'Depositor') return 'My position'
  if (PARTY_ROLE[party] === 'Vault operator') return 'Vault book'
  return 'Positions'
}

// Where each party's own data actually lives, so switching lands you on a page you
// can see. Depositors are not stakeholders on the Vault contract (the /app overview is
// empty for them), so they land on their position. The operator, the market maker,
// and the (deliberately empty) observer land on the vault overview. `/` is the public
// marketing page, so no party lands there.
export const PARTY_LANDING: Record<Party, string> = {
  operator: '/app',
  alice: '/app/position',
  bob: '/app/position',
  carol: '/app/position',
  'mm-buyer': '/app',
  observer: '/app',
}
