import { describe, expect, it } from 'bun:test'
import type { ActiveContract } from './parse'
import { parseRealHoldings, REAL_CBTC_HOLDING_TID } from './real-holdings'

const REGISTRAR = 'cbtc-network::122003aa'
const ac = (payload: Record<string, unknown>): ActiveContract => ({ contractId: 'c1', payload })

describe('parseRealHoldings', () => {
  it('reads owner, amount, and instrument id from a real CBTC holding', () => {
    const out = parseRealHoldings(
      [
        ac({
          owner: 'op::ns',
          amount: '0.5',
          lock: null,
          instrument: { source: REGISTRAR, id: 'CBTC' },
        }),
      ],
      REGISTRAR,
    )
    expect(out).toEqual([{ cid: 'c1', owner: 'op::ns', instrument: 'CBTC', amount: '0.5' }])
  })

  it('skips a locked holding', () => {
    const out = parseRealHoldings(
      [
        ac({
          owner: 'op::ns',
          amount: '0.5',
          lock: { holders: [] },
          instrument: { source: REGISTRAR, id: 'CBTC' },
        }),
      ],
      REGISTRAR,
    )
    expect(out).toEqual([])
  })

  it('skips a holding whose instrument source is not the registrar', () => {
    const out = parseRealHoldings(
      [
        ac({
          owner: 'op::ns',
          amount: '0.5',
          lock: null,
          instrument: { source: 'other::ns', id: 'CBTC' },
        }),
      ],
      REGISTRAR,
    )
    expect(out).toEqual([])
  })

  it('exposes the package-name-referenced real CBTC holding template id', () => {
    expect(REAL_CBTC_HOLDING_TID).toBe(
      '#utility-registry-holding-v0:Utility.Registry.Holding.V0.Holding:Holding',
    )
  })
})
