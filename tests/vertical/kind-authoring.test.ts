// Data-as-schema authoring (Build-Wizard Tier 1) — pure unit contracts:
// kind-name normalization, the closed proposable-registry set, reuse-over-create
// rejection, and per-registry attachment requirements. No DB, no model.
import { describe, it, expect } from 'vitest'
import {
  normalizeKindName,
  validateProposedKind,
  PROPOSABLE_REGISTRIES,
  type KindAuthoringContext,
} from '@exsto/legal'
import { slugifyCapability } from '@exsto/legal'

const CTX: KindAuthoringContext = {
  entityKinds: ['matter', 'client', 'document', 'skill'],
  attributeKinds: ['matter_status', 'serial_number'],
  relationshipKinds: ['draft_of', 'document_of'],
  eventKinds: ['matter.opened', 'draft.completed'],
  proposableRegistries: PROPOSABLE_REGISTRIES,
  valueTypes: ['text', 'number', 'boolean', 'date', 'json'],
}

describe('normalizeKindName — substrate snake_case convention', () => {
  it('snake_cases arbitrary names', () => {
    expect(normalizeKindName('Opposition Deadline!')).toBe('opposition_deadline')
    expect(normalizeKindName('  Serial-Number  ')).toBe('serial_number')
  })
  it('empty input stays empty', () => {
    expect(normalizeKindName('   ')).toBe('')
  })
})

describe('validateProposedKind — closed registries, reuse-first, real attachments', () => {
  it('rejects a non-proposable registry (executable catalogs are closed)', () => {
    const r = validateProposedKind(
      { registry: 'workflow_step', kindName: 'auto_file', displayName: 'Auto-file' },
      CTX,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/request_capability/)
  })

  it('rejects a duplicate kind (reuse, never re-mint)', () => {
    const r = validateProposedKind(
      {
        registry: 'attribute',
        kindName: 'serial_number',
        displayName: 'Serial number',
        onEntityKind: 'matter',
        valueType: 'text',
      },
      CTX,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/REUSE/)
  })

  it('an attribute must attach to a REAL entity kind', () => {
    const r = validateProposedKind(
      {
        registry: 'attribute',
        kindName: 'filing_class',
        displayName: 'Filing class',
        onEntityKind: 'trademark_filing_thing_that_does_not_exist',
        valueType: 'text',
      },
      CTX,
    )
    expect(r.ok).toBe(false)
  })

  it('a relationship needs real source + target entity kinds', () => {
    const bad = validateProposedKind(
      {
        registry: 'relationship',
        kindName: 'opposes',
        displayName: 'Opposes',
        sourceEntityKind: 'matter',
        targetEntityKind: 'nope',
      },
      CTX,
    )
    expect(bad.ok).toBe(false)
    const good = validateProposedKind(
      {
        registry: 'relationship',
        kindName: 'opposes',
        displayName: 'Opposes',
        sourceEntityKind: 'matter',
        targetEntityKind: 'client',
      },
      CTX,
    )
    expect(good.ok).toBe(true)
  })

  it('accepts a valid new event kind and normalizes the name', () => {
    const r = validateProposedKind(
      { registry: 'event', kindName: 'Opposition Deadline', displayName: 'Opposition deadline' },
      CTX,
    )
    expect(r.ok).toBe(true)
    expect(r.normalizedKindName).toBe('opposition_deadline')
  })
})

describe('slugifyCapability — stable library keys', () => {
  it('lowercases and underscores', () => {
    expect(slugifyCapability('Auto-file with the NC Secretary of State')).toBe(
      'auto_file_with_the_nc_secretary_of_state',
    )
  })
})
