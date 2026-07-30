// MULTI-PARTY-1 — pure tests (no DB) for the three multi-party pieces:
//   • extractIntakeParties — repeating intake rows → normalized parties
//     (schema-driven field discovery, legacy 'members' fallback, email dedupe,
//     defensive row handling);
//   • expandRepeatSignerBlocks — ONE authored execution block for a repeating
//     role → N indexed per-party blocks at draft time;
//   • repeatPerParty role parsing + drift + recipient expansion — the config
//     round-trips, indexed markers aren't orphans, and assembleRecipientRows
//     emits one row per party with matching indexed signer keys.
import { describe, it, expect } from 'vitest'
import {
  extractIntakeParties,
  partyFromRow,
  repeaterFieldIds,
} from '../../verticals/legal/src/api/intakeParties.js'
import { expandRepeatSignerBlocks } from '../../verticals/legal/src/esign/executionBlock.js'
import {
  computeMarkerRoleDrift,
  computeSignerEmailGaps,
  isRepeatMarkerKey,
  parseFields,
} from '../../verticals/legal/src/esign/fields.js'
import { parseTemplateEsignConfig } from '../../verticals/legal/src/queries/templates.js'
import { assembleRecipientRows } from '../../verticals/legal/src/api/esignPrefill.js'

const SCHEMA = {
  sections: [
    {
      fields: [
        { id: 'company_name', type: 'text' },
        {
          id: 'members',
          type: 'members_repeater',
          memberFields: [
            { id: 'member_name', type: 'text' },
            { id: 'member_email', type: 'text' },
            { id: 'member_role', type: 'text' },
          ],
        },
      ],
    },
  ],
}

describe('extractIntakeParties', () => {
  it('finds repeater fields in a schema (members_repeater and legacy repeater)', () => {
    expect(repeaterFieldIds(SCHEMA)).toEqual(['members'])
    expect(
      repeaterFieldIds({ sections: [{ fields: [{ id: 'parties', type: 'repeater' }] }] }),
    ).toEqual(['parties'])
  })

  it('normalizes rows via exact and suffix key candidates', () => {
    expect(
      partyFromRow({
        member_name: 'Ana Ruiz',
        member_email: 'ANA@example.com',
        member_role: 'Manager',
      }),
    ).toEqual({ name: 'Ana Ruiz', email: 'ana@example.com', phone: null, title: 'Manager' })
    expect(partyFromRow({ name: 'Bo Li', email: 'bo@x.co', phone: '555' })).toEqual({
      name: 'Bo Li',
      email: 'bo@x.co',
      phone: '555',
      title: null,
    })
  })

  it('drops rows with no identity, keeps name-only rows, and dedupes by email', () => {
    const parties = extractIntakeParties(SCHEMA, {
      members: [
        { member_name: 'Ana', member_email: 'ana@x.co' },
        { member_name: 'Ana Again', member_email: 'ANA@X.CO' },
        { member_name: 'NoEmail Member' },
        { member_email: 'not-an-email', member_name: '' },
        { capital: '100' },
        'junk',
        null,
      ],
    })
    expect(parties.map((p) => [p.name, p.email])).toEqual([
      ['Ana', 'ana@x.co'],
      ['NoEmail Member', null],
    ])
  })

  it('reads the legacy hardcoded members key when the schema field id differs', () => {
    const schema = {
      sections: [
        {
          fields: [
            {
              id: 'partners',
              type: 'members_repeater',
              memberFields: [{ id: 'name', type: 'text' }],
            },
          ],
        },
      ],
    }
    const parties = extractIntakeParties(schema, {
      members: [{ name: 'Legacy Person', email: 'legacy@x.co' }],
    })
    expect(parties).toHaveLength(1)
    expect(parties[0]!.name).toBe('Legacy Person')
  })

  it('is defensive on garbage input', () => {
    expect(extractIntakeParties(null, null)).toEqual([])
    expect(extractIntakeParties(SCHEMA, { members: 'nope' })).toEqual([])
  })
})

describe('expandRepeatSignerBlocks', () => {
  const BODY = [
    'Some agreement text.',
    '',
    '**Accepted and Agreed:**',
    '',
    '{{sign:member}}',
    '',
    '{{name:member}}',
    '',
    '{{date:member}}',
  ].join('\n')

  it('replicates the block per party with indexed keys', () => {
    const out = expandRepeatSignerBlocks(BODY, 'member', 3)
    const fields = parseFields(out)
    expect(fields.map((f) => f.signerKey)).toEqual([
      'member_1',
      'member_1',
      'member_1',
      'member_2',
      'member_2',
      'member_2',
      'member_3',
      'member_3',
      'member_3',
    ])
    // No base-key marker survives expansion.
    expect(out).not.toMatch(/\{\{\s*\w+\s*:\s*member\s*\}\}/)
    expect(out).toContain('**Accepted and Agreed:**')
  })

  it('leaves other roles and prose untouched', () => {
    const body = `${BODY}\n\n{{sign:attorney}}`
    const out = expandRepeatSignerBlocks(body, 'member', 2)
    expect(out).toContain('{{sign:attorney}}')
    expect(out).toContain('Some agreement text.')
  })

  it('is a no-op when the body has no base-key marker (already expanded)', () => {
    const expanded = expandRepeatSignerBlocks(BODY, 'member', 2)
    expect(expandRepeatSignerBlocks(expanded, 'member', 5)).toBe(expanded)
    expect(expandRepeatSignerBlocks('plain text', 'member', 3)).toBe('plain text')
  })

  it('treats count < 1 as one party so markers and recipients always agree', () => {
    const out = expandRepeatSignerBlocks(BODY, 'member', 0)
    expect(out).toContain('{{sign:member_1}}')
    expect(out).not.toContain('{{sign:member_2}}')
  })
})

describe('repeatPerParty config + drift', () => {
  it('parse keeps repeatPerParty only for interactive signing roles', () => {
    const cfg = parseTemplateEsignConfig({
      signable: true,
      roles: [
        {
          key: 'member',
          label: 'Member',
          recipientRole: 'needs_to_sign',
          bind: 'manual',
          order: 1,
          repeatPerParty: true,
        },
        {
          key: 'viewer',
          label: 'Viewer',
          recipientRole: 'receives_copy',
          bind: 'manual',
          order: 2,
          repeatPerParty: true,
        },
        {
          key: 'atty',
          label: 'Attorney',
          recipientRole: 'needs_to_sign',
          bind: 'attorney_of_record',
          order: 3,
          presigned: true,
          repeatPerParty: true,
        },
      ],
    })
    expect(cfg.roles[0]!.repeatPerParty).toBe(true)
    expect(cfg.roles[1]!.repeatPerParty).toBeUndefined()
    expect(cfg.roles[2]!.repeatPerParty).toBeUndefined()
  })

  it('isRepeatMarkerKey accepts the base key and numeric suffixes only', () => {
    expect(isRepeatMarkerKey('member', 'member')).toBe(true)
    expect(isRepeatMarkerKey('member_2', 'member')).toBe(true)
    expect(isRepeatMarkerKey('member_x', 'member')).toBe(false)
    expect(isRepeatMarkerKey('membership', 'member')).toBe(false)
  })

  it('drift treats indexed markers as owned by the repeat role, and any indexed sign marker satisfies it', () => {
    const body = '{{sign:member_1}}\n{{sign:member_2}}\n{{sign:atty}}'
    const drift = computeMarkerRoleDrift(body, [
      { key: 'member', recipientRole: 'needs_to_sign', repeatPerParty: true },
      { key: 'atty', recipientRole: 'needs_to_sign' },
    ])
    expect(drift.markerKeysWithoutRole).toEqual([])
    expect(drift.rolesWithoutSignMarker).toEqual([])
  })

  it('email-gap warning skips repeat roles (identity comes from party contacts)', () => {
    expect(
      computeSignerEmailGaps([{ key: 'member', bind: 'manual', repeatPerParty: true }]),
    ).toEqual([])
    expect(computeSignerEmailGaps([{ key: 'other', bind: 'manual' }])).toHaveLength(1)
  })
})

describe('assembleRecipientRows repeat expansion', () => {
  const roles = parseTemplateEsignConfig({
    signable: true,
    roles: [
      {
        key: 'member',
        label: 'Member',
        recipientRole: 'needs_to_sign',
        bind: 'manual',
        order: 1,
        repeatPerParty: true,
      },
      {
        key: 'atty',
        label: 'Attorney',
        recipientRole: 'needs_to_sign',
        bind: 'attorney_of_record',
        order: 2,
      },
    ],
  }).roles

  const resolveBind = async (): Promise<{
    name: string | null
    email: string | null
    title: string | null
    contactEntityId: string | null
  }> => ({ name: 'A. Torney', email: 'a@firm.co', title: null, contactEntityId: null })

  it('emits one indexed row per party, resolved from the party identities', async () => {
    const rows = await assembleRecipientRows(roles, resolveBind, undefined, [
      { name: 'Ana', email: 'ana@x.co', title: null, contactEntityId: 'c1' },
      { name: 'Bo', email: 'bo@x.co', title: null, contactEntityId: 'c2' },
      { name: 'Cy', email: null, title: null, contactEntityId: 'c3' },
    ])
    expect(rows.map((r) => r.signerKey)).toEqual(['member_1', 'member_2', 'member_3', 'atty'])
    expect(rows[0]).toMatchObject({
      label: 'Member 1',
      name: 'Ana',
      email: 'ana@x.co',
      resolved: true,
      contactEntityId: 'c1',
    })
    // A party with no email is an honest unresolved row, never invented.
    expect(rows[2]!.resolved).toBe(false)
    expect(rows[3]!.signerKey).toBe('atty')
  })

  it('degrades to a single unresolved key_1 row when the matter has no parties', async () => {
    const rows = await assembleRecipientRows(roles, resolveBind, undefined, [])
    expect(rows.map((r) => r.signerKey)).toEqual(['member_1', 'atty'])
    expect(rows[0]!.resolved).toBe(false)
  })
})
