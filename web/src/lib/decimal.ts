// Decimal-string comparison for money amounts.
//
// The deposit path is string-exact end to end: the form posts the typed string, the
// server action forwards that string, and Daml parses it as a `Decimal` (10 dp). Any
// `Number()` on the way through would introduce a binary float where the ledger has an
// exact decimal, so comparisons against a ledger-supplied bound are done on the digits.
//
// This is a comparison helper, not an arithmetic library: it answers "is this amount
// below the vault's minimum" without ever materialising a float.

const DAML_DECIMAL_PLACES = 10

/** Parse a decimal string into a scaled BigInt, or null if it is not a plain decimal. */
export function parseDecimalUnits(value: string): bigint | null {
  const trimmed = value.trim()
  // Plain decimal only. Exponent notation ("1e-8") is rejected rather than converted:
  // it is not what a user types into an amount field, and accepting it here would mean
  // forwarding a string Daml's Decimal parser does not accept.
  if (!/^-?\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-') {
    return null
  }
  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '', fraction = ''] = unsigned.split('.')
  if (fraction.length > DAML_DECIMAL_PLACES) return null
  const padded = fraction.padEnd(DAML_DECIMAL_PLACES, '0')
  const scaled = BigInt(`${whole === '' ? '0' : whole}${padded}`)
  return negative ? -scaled : scaled
}

/**
 * Compare two decimal strings: -1 if a < b, 0 if equal, 1 if a > b.
 * Returns null when either side is not a plain decimal, so callers must handle it
 * rather than receive a misleading ordering.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseDecimalUnits(a)
  const right = parseDecimalUnits(b)
  if (left === null || right === null) return null
  if (left < right) return -1
  return left > right ? 1 : 0
}
