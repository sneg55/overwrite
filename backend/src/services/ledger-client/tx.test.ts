import { describe, expect, test } from 'bun:test'
import { createdOf, firstCreated, parseTx } from './tx'

const raw = {
  transaction: {
    events: [
      {
        CreatedEvent: {
          templateId: 'abc123:Overwrite.Vault:Vault',
          contractId: '00vault',
          createArgument: { epochNumber: '1', windowState: 'Open' },
        },
      },
      {
        CreatedEvent: {
          templateId: 'abc123:Overwrite.VaultPosition:VaultPosition',
          contractId: '00pos',
          createArgument: { depositor: 'alice', principalCbtc: '1.0' },
        },
      },
      { ExercisedEvent: { exerciseResult: { some: 'result' } } },
    ],
  },
}

describe('parseTx', () => {
  test('extracts created contracts with payloads and the exercise result', () => {
    const tx = parseTx(raw)
    expect(tx.created).toHaveLength(2)
    expect(tx.exerciseResult).toEqual({ some: 'result' })
    expect(createdOf(tx, 'Vault', 'Vault')).toHaveLength(1)
    expect(firstCreated(tx, 'VaultPosition', 'VaultPosition').contractId).toBe('00pos')
    expect(firstCreated(tx, 'Vault', 'Vault').payload.windowState).toBe('Open')
  })

  test('firstCreated throws when the template is absent', () => {
    expect(() => firstCreated(parseTx(raw), 'CallOption', 'CallOption')).toThrow('E_LGR_003')
  })

  test('tolerates a malformed response', () => {
    expect(parseTx({}).created).toEqual([])
    expect(parseTx(null).created).toEqual([])
  })
})
