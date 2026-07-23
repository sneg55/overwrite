import { describe, expect, it } from 'bun:test'
import { AppError, ErrorIds } from '@/constants/errorIds'
import { type DepositRealDeps, depositReal, type TransferPort } from './deposit-real'
import { assertWholeHolding } from './deposit-validation'

// The doubles return settled promises rather than being `async`: an async function with
// no await is a lint error, and these have nothing to await.
function makeDeps(over: Partial<DepositRealDeps> = {}) {
  const calls: string[] = []
  const transfer: TransferPort = {
    transferToOperator: () => {
      calls.push('move')
      return Promise.resolve()
    },
  }
  const deps: DepositRealDeps = {
    depositor: 'alice::ns',
    vaultCid: 'v1',
    holdingCid: 'h1',
    operator: 'op::ns',
    transfer,
    recordDeposit: (movedCid: string) => {
      calls.push(`record:${movedCid}`)
      return Promise.resolve({ recorded: true })
    },
    resolveMovedHolding: () => Promise.resolve('op-holding-1'),
    ...over,
  }
  return { calls, deps }
}

// Run `fn` and return whatever it threw. Used instead of `expect(...).rejects`, whose
// bun type signature is not a Thenable, so awaiting it is a lint error.
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to reject, but it resolved')
}

describe('depositReal', () => {
  it('moves CBTC to the operator, then records the position against the moved holding', async () => {
    const { calls, deps } = makeDeps()
    await depositReal(deps)
    expect(calls).toEqual(['move', 'record:op-holding-1'])
  })

  it('never records if the move fails', async () => {
    const { calls, deps } = makeDeps({
      transfer: {
        transferToOperator: () => Promise.reject(new Error('registry rejected')),
      },
    })
    const err = await thrownBy(() => depositReal(deps))
    expect((err as Error).message).toBe('registry rejected')
    expect(calls).toEqual([])
  })

  it('throws rather than recording when the moved holding cannot be resolved', async () => {
    const { calls, deps } = makeDeps({ resolveMovedHolding: () => Promise.resolve('') })
    await thrownBy(() => depositReal(deps))
    expect(calls).toEqual(['move'])
  })
})

describe('assertWholeHolding', () => {
  it('accepts a request equal to the whole holding', () => {
    expect(() => assertWholeHolding('0.5', '0.5')).not.toThrow()
  })

  it('tolerates float noise within epsilon', () => {
    expect(() => assertWholeHolding('0.30000000001', '0.3')).not.toThrow()
  })

  it('rejects a partial amount with DEP_BAD_AMOUNT', () => {
    try {
      assertWholeHolding('0.2', '0.5')
      throw new Error('expected assertWholeHolding to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).id).toBe(ErrorIds.DEP_BAD_AMOUNT)
    }
  })
})
