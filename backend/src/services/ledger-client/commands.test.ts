import { describe, expect, test } from 'bun:test'
import { acsFilter, createCommand, exerciseCommand, overwriteTemplateId } from './commands'

describe('overwriteTemplateId', () => {
  test('uses the package-name reference form', () => {
    expect(overwriteTemplateId('Vault', 'Vault')).toBe('#overwrite-vault:Overwrite.Vault:Vault')
    expect(overwriteTemplateId('VaultPosition', 'VaultPosition')).toBe(
      '#overwrite-vault:Overwrite.VaultPosition:VaultPosition',
    )
  })
})

describe('createCommand', () => {
  test('produces the verified JsCommands shape', () => {
    const body = createCommand({
      templateId: '#overwrite-vault:Overwrite.Vault:Vault',
      createArguments: { operator: 'op::1220' },
      actAs: ['op::1220'],
      commandId: 'create-1',
    })
    expect(body).toEqual({
      commands: {
        actAs: ['op::1220'],
        commandId: 'create-1',
        disclosedContracts: [],
        commands: [
          {
            CreateCommand: {
              templateId: '#overwrite-vault:Overwrite.Vault:Vault',
              createArguments: { operator: 'op::1220' },
            },
          },
        ],
      },
    })
  })
})

describe('userId', () => {
  test('is omitted by default (token supplies it on an authed ledger)', () => {
    const body = createCommand({
      templateId: '#overwrite-vault:Overwrite.Allocation:Holding',
      createArguments: {},
      actAs: ['p'],
      commandId: 'c',
    })
    expect('userId' in body.commands).toBe(false)
  })

  test('is included when provided (no-auth ledger, e.g. local sandbox)', () => {
    const body = createCommand({
      templateId: '#overwrite-vault:Overwrite.Allocation:Holding',
      createArguments: {},
      actAs: ['p'],
      commandId: 'c',
      userId: 'participant_admin',
    })
    expect(body.commands.userId).toBe('participant_admin')
  })
})

describe('exerciseCommand', () => {
  test('produces the verified ExerciseCommand shape', () => {
    const body = exerciseCommand({
      templateId: '#overwrite-vault:Overwrite.VaultPosition:VaultPosition',
      contractId: 'abc123',
      choice: 'QueueWithdraw',
      choiceArgument: {},
      actAs: ['alice::1220'],
      commandId: 'qw-1',
    })
    const cmd = body.commands.commands[0]
    expect(cmd && 'ExerciseCommand' in cmd && cmd.ExerciseCommand.choice).toBe('QueueWithdraw')
    expect(cmd && 'ExerciseCommand' in cmd && cmd.ExerciseCommand.contractId).toBe('abc123')
    expect(body.commands.actAs).toEqual(['alice::1220'])
  })
})

describe('disclosed contracts', () => {
  const disclosed = [
    {
      templateId: 'pkg:Mod:Tpl',
      contractId: '00abc',
      createdEventBlob: 'YmxvYg==',
      synchronizerId: 'sync::1220',
    },
  ]

  test('exerciseCommand forwards disclosed contracts into the submission body', () => {
    const body = exerciseCommand({
      templateId: '#splice-api-token-transfer-instruction-v1:X:TransferInstruction',
      contractId: '00offer',
      choice: 'TransferInstruction_Accept',
      choiceArgument: {},
      actAs: ['op::1220'],
      commandId: 'acc-1',
      disclosed,
    })
    expect(body.commands.disclosedContracts).toEqual(disclosed)
  })

  test('createCommand forwards disclosed contracts', () => {
    const body = createCommand({
      templateId: '#overwrite-vault:Overwrite.Vault:Vault',
      createArguments: {},
      actAs: ['p'],
      commandId: 'c',
      disclosed,
    })
    expect(body.commands.disclosedContracts).toEqual(disclosed)
  })

  test('defaults to an empty array when omitted (existing call sites unchanged)', () => {
    const body = exerciseCommand({
      templateId: '#t',
      contractId: 'c',
      choice: 'X',
      choiceArgument: {},
      actAs: ['p'],
      commandId: 'c',
    })
    expect(body.commands.disclosedContracts).toEqual([])
  })
})

describe('acsFilter', () => {
  test('produces the verified active-contracts filter shape', () => {
    const body = acsFilter({
      party: 'alice::1220',
      templateId: '#overwrite-vault:Overwrite.VaultPosition:VaultPosition',
      activeAtOffset: 42,
    })
    expect(body.verbose).toBe(true)
    expect(body.activeAtOffset).toBe(42)
    const partyFilter = body.filter.filtersByParty['alice::1220']
    expect(partyFilter?.cumulative[0]?.identifierFilter.TemplateFilter.value.templateId).toBe(
      '#overwrite-vault:Overwrite.VaultPosition:VaultPosition',
    )
    expect(
      partyFilter?.cumulative[0]?.identifierFilter.TemplateFilter.value.includeCreatedEventBlob,
    ).toBe(true)
  })
})
