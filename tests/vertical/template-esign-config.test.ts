// ESIGN-UNIFY-1 ES-3 — template-embedded e-sign config (0187 planned). Pure
// tests (no DB): the defensive config parser, the legacy template_signature
// fallback, marker↔role drift validation (the editor warning AND the AI
// proposal gate share ONE helper), the AI-proposal round trip through
// validateProposedTemplate, and per-rule bind resolution via the injected-
// resolver assembly core the DB-backed resolveTemplateRecipients delegates to.
import { describe, it, expect } from 'vitest'
import {
  parseTemplateEsignConfig,
  templateSignatureToEsignConfig,
  parseTemplateSignature,
  EMPTY_ESIGN_CONFIG,
  validateProposedTemplate,
  assembleRecipientRows,
  type TemplateEsignConfig,
  type ResolvedIdentity,
} from '@exsto/legal'
import { computeMarkerRoleDrift, computeSignerEmailGaps, parseMarkerLine } from '@exsto/legal/esign'

describe('parseTemplateEsignConfig — defensive read', () => {
  it('reads a well-formed config through unchanged', () => {
    const raw: TemplateEsignConfig = {
      signable: true,
      roles: [
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'matter_primary_contact',
          order: 1,
        },
        {
          key: 'attorney',
          label: 'Attorney',
          recipientRole: 'needs_to_sign',
          bind: 'attorney_of_record',
          order: 2,
        },
      ],
    }
    expect(parseTemplateEsignConfig(raw)).toEqual(raw)
  })

  it('reads absent/malformed values as the unsignable empty config', () => {
    expect(parseTemplateEsignConfig(null)).toEqual(EMPTY_ESIGN_CONFIG)
    expect(parseTemplateEsignConfig(undefined)).toEqual(EMPTY_ESIGN_CONFIG)
    expect(parseTemplateEsignConfig('nope')).toEqual(EMPTY_ESIGN_CONFIG)
    expect(parseTemplateEsignConfig({ signable: 'yes', roles: 'many' })).toEqual(EMPTY_ESIGN_CONFIG)
  })

  it('coerces malformed role fields to safe defaults and drops keyless roles', () => {
    const parsed = parseTemplateEsignConfig({
      signable: true,
      roles: [
        { key: ' client ', recipientRole: 'rainbow', bind: 'teleport', order: 'first' },
        { label: 'No key — dropped' },
        { key: 'witness', label: '', recipientRole: 'needs_to_view', bind: 'manual', order: 3 },
      ],
    })
    expect(parsed.signable).toBe(true)
    expect(parsed.roles).toEqual([
      { key: 'client', label: 'client', recipientRole: 'needs_to_sign', bind: 'manual', order: 1 },
      {
        key: 'witness',
        label: 'witness',
        recipientRole: 'needs_to_view',
        bind: 'manual',
        order: 3,
      },
    ])
  })

  it('accepts contact_role:<name> binds and collapses duplicate keys (last wins)', () => {
    const parsed = parseTemplateEsignConfig({
      signable: true,
      roles: [
        { key: 'client', label: 'Old', bind: 'manual', recipientRole: 'needs_to_sign', order: 1 },
        {
          key: 'client',
          label: 'New',
          bind: 'contact_role:guarantor',
          recipientRole: 'needs_to_sign',
          order: 2,
        },
      ],
    })
    expect(parsed.roles).toHaveLength(1)
    expect(parsed.roles[0]).toMatchObject({ label: 'New', bind: 'contact_role:guarantor' })
    // A bare "contact_role:" (no name) is not a valid bind — coerces to manual.
    const bare = parseTemplateEsignConfig({
      signable: true,
      roles: [{ key: 'x', label: 'X', bind: 'contact_role:', recipientRole: 'needs_to_sign' }],
    })
    expect(bare.roles[0]!.bind).toBe('manual')
  })
})

describe('legacy template_signature fallback (§6.1 read-time shim)', () => {
  it('maps signer_roles to needs_to_sign roles in declared order', () => {
    const cfg = templateSignatureToEsignConfig(
      parseTemplateSignature({ required: true, signer_roles: ['client', 'attorney'] }),
    )
    expect(cfg.signable).toBe(true)
    expect(cfg.roles).toEqual([
      {
        key: 'client',
        label: 'Client',
        recipientRole: 'needs_to_sign',
        bind: 'matter_primary_contact',
        order: 1,
      },
      {
        key: 'attorney',
        label: 'Attorney',
        recipientRole: 'needs_to_sign',
        bind: 'attorney_of_record',
        order: 2,
      },
    ])
  })

  it('witness/notary bind to the primary contact (the only honest legacy read)', () => {
    const cfg = templateSignatureToEsignConfig(
      parseTemplateSignature({ required: true, signer_roles: ['witness', 'notary'] }),
    )
    expect(cfg.roles.map((r) => r.bind)).toEqual([
      'matter_primary_contact',
      'matter_primary_contact',
    ])
  })

  it('unsigned/malformed legacy declarations read as the empty config', () => {
    expect(templateSignatureToEsignConfig(parseTemplateSignature(null))).toEqual(EMPTY_ESIGN_CONFIG)
    expect(
      templateSignatureToEsignConfig(parseTemplateSignature({ required: false, signer_roles: [] })),
    ).toEqual(EMPTY_ESIGN_CONFIG)
    // required:true with no valid roles must never look signable.
    expect(
      templateSignatureToEsignConfig(
        parseTemplateSignature({ required: true, signer_roles: ['ceo'] }),
      ),
    ).toEqual(EMPTY_ESIGN_CONFIG)
  })
})

describe('marker↔role drift (computeMarkerRoleDrift)', () => {
  const body = [
    '# Agreement',
    '',
    '**Accepted and Agreed:**',
    '',
    '{{sign:client}}',
    '{{name:client}}',
    '{{date:client}}',
    '',
    '{{sign:manager}}',
  ].join('\n')

  it('reports no drift when markers and roles agree', () => {
    const drift = computeMarkerRoleDrift(body, [
      { key: 'client', recipientRole: 'needs_to_sign' },
      { key: 'manager', recipientRole: 'needs_to_sign' },
    ])
    expect(drift.markerKeysWithoutRole).toEqual([])
    expect(drift.rolesWithoutSignMarker).toEqual([])
  })

  it('flags marker keys with no role row', () => {
    const drift = computeMarkerRoleDrift(body, [{ key: 'client' }])
    expect(drift.markerKeysWithoutRole).toEqual(['manager'])
  })

  it('flags needs_to_sign roles with no {{sign:key}} marker — viewers/copies exempt', () => {
    const drift = computeMarkerRoleDrift('{{sign:client}}', [
      { key: 'client', recipientRole: 'needs_to_sign' },
      { key: 'witness', recipientRole: 'needs_to_sign' },
      { key: 'observer', recipientRole: 'needs_to_view' },
    ])
    expect(drift.rolesWithoutSignMarker).toEqual(['witness'])
    // observer has no marker at all AND no role complaint (view-only)…
    expect(drift.rolesWithoutSignMarker).not.toContain('observer')
    // …and a name/date-only key still needs its role (not a sign complaint).
    const nameOnly = computeMarkerRoleDrift('{{date:client}}', [
      { key: 'client', recipientRole: 'needs_to_sign' },
    ])
    expect(nameOnly.rolesWithoutSignMarker).toEqual(['client'])
  })

  it('parseMarkerLine classifies whole lines only, with prefix labels', () => {
    expect(parseMarkerLine('{{sign:client}}')).toEqual({
      type: 'sign',
      signerKey: 'client',
      label: 'Signature',
    })
    expect(parseMarkerLine('Managing Member: {{sign:manager}}')).toEqual({
      type: 'sign',
      signerKey: 'manager',
      label: 'Managing Member',
    })
    expect(parseMarkerLine('please sign {{sign:client}} here')).toBeNull()
    expect(parseMarkerLine('{{client_name}}')).toBeNull()
  })
})

describe('AI proposal round trip (validateProposedTemplate + esignConfig)', () => {
  const signableBody = 'Terms.\n\n{{sign:client}}\n\n{{name:client}}\n\n{{date:client}}'
  const config: TemplateEsignConfig = {
    signable: true,
    roles: [
      {
        key: 'client',
        label: 'Client',
        recipientRole: 'needs_to_sign',
        bind: 'matter_primary_contact',
        order: 1,
      },
    ],
  }

  it('accepts a consistent signable proposal and reports empty drift', () => {
    const res = validateProposedTemplate(signableBody, [], { esignConfig: config })
    expect(res.ok).toBe(true)
    expect(res.esign).toEqual({ markerKeysWithoutRole: [], rolesWithoutSignMarker: [] })
  })

  it('HARD-fails a signable proposal whose markers/roles drift', () => {
    const orphanMarker = validateProposedTemplate(`${signableBody}\n\n{{sign:ghost}}`, [], {
      esignConfig: config,
    })
    expect(orphanMarker.ok).toBe(false)
    expect(orphanMarker.esign?.markerKeysWithoutRole).toEqual(['ghost'])
    expect(orphanMarker.errors.join(' ')).toMatch(/ghost/)

    const noMarker = validateProposedTemplate('No execution section here.', [], {
      esignConfig: config,
    })
    expect(noMarker.ok).toBe(false)
    expect(noMarker.esign?.rolesWithoutSignMarker).toEqual(['client'])
  })

  it('skips the esign gate for unsigned proposals and when no config is passed', () => {
    const unsigned = validateProposedTemplate('Just a memo.', [], {
      esignConfig: { signable: false, roles: [] },
    })
    expect(unsigned.ok).toBe(true)
    expect(unsigned.esign).toBeNull()
    expect(validateProposedTemplate('Just a memo.', []).esign).toBeNull()
  })

  it('survives the JSON round trip the proposal card makes (SSE → approve payload)', () => {
    const wire = JSON.parse(JSON.stringify(config)) as unknown
    expect(parseTemplateEsignConfig(wire)).toEqual(config)
  })
})

describe('bind resolution per rule (assembleRecipientRows, injected resolver)', () => {
  const identities: Record<string, ResolvedIdentity> = {
    matter_primary_contact: {
      name: 'Ana Client',
      email: 'ana@example.com',
      title: 'CEO',
      contactEntityId: 'contact-1',
    },
    attorney_of_record: {
      name: 'Juan Pacheco',
      email: 'juan@firm.example',
      title: null,
      contactEntityId: null,
    },
    'contact_role:guarantor': {
      name: 'Gary Guarantor',
      email: 'gary@example.com',
      title: null,
      contactEntityId: 'contact-2',
    },
  }
  const empty: ResolvedIdentity = { name: null, email: null, title: null, contactEntityId: null }
  const calls: string[] = []
  const resolver = async (bind: string): Promise<ResolvedIdentity> => {
    calls.push(bind)
    return identities[bind] ?? empty
  }

  const roles: TemplateEsignConfig['roles'] = [
    {
      key: 'attorney',
      label: 'Attorney',
      recipientRole: 'needs_to_sign',
      bind: 'attorney_of_record',
      order: 2,
    },
    {
      key: 'client',
      label: 'Client',
      recipientRole: 'needs_to_sign',
      bind: 'matter_primary_contact',
      order: 1,
    },
    {
      key: 'guarantor',
      label: 'Guarantor',
      recipientRole: 'needs_to_view',
      bind: 'contact_role:guarantor',
      order: 1,
    },
    {
      key: 'assistant',
      label: 'Assistant',
      recipientRole: 'receives_copy',
      bind: 'manual',
      order: 3,
    },
    {
      key: 'missing',
      label: 'Missing role',
      recipientRole: 'needs_to_sign',
      bind: 'contact_role:undefined_role',
      order: 3,
    },
  ]

  it('resolves each bind by its rule, keeps role facts, sorts by order (stable ties)', async () => {
    calls.length = 0
    const rows = await assembleRecipientRows(roles, resolver)
    // Sorted ascending by order; the two order-1 rows keep config order (client
    // was declared after guarantor? No — client precedes guarantor in the input
    // ORDER OF EQUAL order values: client (idx 1) then guarantor (idx 2)).
    expect(rows.map((r) => r.signerKey)).toEqual([
      'client',
      'guarantor',
      'attorney',
      'assistant',
      'missing',
    ])
    const byKey = Object.fromEntries(rows.map((r) => [r.signerKey, r]))
    expect(byKey.client).toMatchObject({
      email: 'ana@example.com',
      name: 'Ana Client',
      title: 'CEO',
      contactEntityId: 'contact-1',
      resolved: true,
      role: 'needs_to_sign',
    })
    expect(byKey.attorney).toMatchObject({
      email: 'juan@firm.example',
      resolved: true,
      contactEntityId: null,
    })
    expect(byKey.guarantor).toMatchObject({
      email: 'gary@example.com',
      role: 'needs_to_view',
      contactEntityId: 'contact-2',
    })
    // manual: NEVER consults the resolver; always an empty attorney-fillable row.
    expect(byKey.assistant).toMatchObject({ resolved: false, email: null, name: null })
    expect(calls).not.toContain('manual')
    // an unresolvable contact_role degrades to unresolved — never invented.
    expect(byKey.missing).toMatchObject({ resolved: false, email: null })
  })

  it('an unsignable config short-circuits in the DB wrapper contract (empty roles → empty rows)', async () => {
    expect(await assembleRecipientRows([], resolver)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// ESIGN-FIELDS-1 — per-role merge-field identity bindings.
// ─────────────────────────────────────────────────────────────────────────
describe('per-role field bindings (parse + normalize)', () => {
  it('preserves and lower-cases token bindings, drops all-empty fields', () => {
    const parsed = parseTemplateEsignConfig({
      signable: true,
      roles: [
        {
          key: 'member2',
          label: 'Second Member',
          recipientRole: 'needs_to_sign',
          bind: 'manual',
          order: 2,
          fields: { name: 'Member_2_Name', email: ' member_2_email ', title: '' },
        },
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'matter_primary_contact',
          order: 1,
          fields: { name: '', email: '', title: '' },
        },
      ],
    })
    // Token grammar: lower-cased, [a-z0-9_] only, whitespace trimmed.
    expect(parsed.roles[0]!.fields).toEqual({ name: 'member_2_name', email: 'member_2_email' })
    // An all-empty fields object is dropped entirely (bind-only role reads unchanged).
    expect(parsed.roles[1]!.fields).toBeUndefined()
  })

  it('survives the JSON wire round trip', () => {
    const cfg: TemplateEsignConfig = {
      signable: true,
      roles: [
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'manual',
          order: 1,
          fields: { email: 'client_email' },
        },
      ],
    }
    const wire = JSON.parse(JSON.stringify(cfg)) as unknown
    expect(parseTemplateEsignConfig(wire)).toEqual(cfg)
  })
})

describe('computeSignerEmailGaps — signable email coverage', () => {
  it('flags manual roles with no bound email, exempts CRM binds and field-bound emails', () => {
    const gaps = computeSignerEmailGaps([
      {
        key: 'client',
        label: 'Client',
        recipientRole: 'needs_to_sign',
        bind: 'matter_primary_contact',
        order: 1,
      },
      {
        key: 'attorney',
        label: 'Attorney',
        recipientRole: 'needs_to_sign',
        bind: 'attorney_of_record',
        order: 2,
      },
      {
        key: 'member2',
        label: 'Second Member',
        recipientRole: 'needs_to_sign',
        bind: 'manual',
        order: 3,
        fields: { email: 'member_2_email' },
      },
      {
        key: 'witness',
        label: 'Witness',
        recipientRole: 'needs_to_view',
        bind: 'manual',
        order: 4,
      },
    ])
    // Only the manual role with no email SOURCE is a gap.
    expect(gaps).toEqual([{ key: 'witness', label: 'Witness' }])
  })
})

describe('field bindings override bind resolution (assembleRecipientRows)', () => {
  const bind = async (b: string): Promise<ResolvedIdentity> =>
    b === 'matter_primary_contact'
      ? { name: 'Ana Client', email: 'ana@crm.example', title: 'CEO', contactEntityId: 'contact-1' }
      : { name: null, email: null, title: null, contactEntityId: null }
  const values: Record<string, string> = {
    member_2_email: 'member2@example.com',
    member_2_name: 'Bea Member',
    client_email: '',
  }
  const fieldValue = (t: string): string | undefined => values[t.toLowerCase()]

  it('resolves a manual extra signer entirely from intake fields', async () => {
    const rows = await assembleRecipientRows(
      [
        {
          key: 'member2',
          label: 'Second Member',
          recipientRole: 'needs_to_sign',
          bind: 'manual',
          order: 1,
          fields: { name: 'member_2_name', email: 'member_2_email' },
        },
      ],
      bind,
      fieldValue,
    )
    expect(rows[0]).toMatchObject({
      email: 'member2@example.com',
      name: 'Bea Member',
      resolved: true,
      contactEntityId: null,
    })
  })

  it('an unresolvable/empty field falls back to the CRM bind, keeping its contact link', async () => {
    const rows = await assembleRecipientRows(
      [
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'matter_primary_contact',
          order: 1,
          // client_email resolves to '' (unanswered) → falls back to the CRM email.
          fields: { email: 'client_email' },
        },
      ],
      bind,
      fieldValue,
    )
    expect(rows[0]).toMatchObject({
      email: 'ana@crm.example',
      name: 'Ana Client',
      contactEntityId: 'contact-1',
      resolved: true,
    })
  })

  it('a field email overriding the CRM email drops the stale contact link', async () => {
    const rows = await assembleRecipientRows(
      [
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'matter_primary_contact',
          order: 1,
          fields: { email: 'member_2_email' },
        },
      ],
      bind,
      fieldValue,
    )
    // Email came from a field, not the bound contact — link is dropped so the
    // composer can't mis-attach the envelope to contact-1.
    expect(rows[0]).toMatchObject({
      email: 'member2@example.com',
      name: 'Ana Client', // name still from the bind (no name field bound)
      contactEntityId: null,
    })
  })
})

describe('PRESIGN-1 — pre-signed attorney role', () => {
  it('parse honors `presigned` only on the attorney_of_record bind', () => {
    const cfg = parseTemplateEsignConfig({
      signable: true,
      roles: [
        { key: 'attorney', bind: 'attorney_of_record', order: 1, presigned: true },
        // presigned on a client row is nonsensical/unsafe → dropped.
        { key: 'client', bind: 'matter_primary_contact', order: 2, presigned: true },
      ],
    })
    expect(cfg.roles.find((r) => r.key === 'attorney')?.presigned).toBe(true)
    expect(cfg.roles.find((r) => r.key === 'client')?.presigned).toBeUndefined()
  })

  it('assembleRecipientRows propagates presigned only for the attorney bind', async () => {
    const resolve = async (bind: string): Promise<ResolvedIdentity> =>
      bind === 'attorney_of_record'
        ? { name: 'Atty', email: 'atty@firm.test', title: null, contactEntityId: null }
        : { name: 'Client', email: 'client@example.com', title: null, contactEntityId: null }
    const rows = await assembleRecipientRows(
      [
        {
          key: 'attorney',
          label: 'Attorney',
          recipientRole: 'needs_to_sign',
          bind: 'attorney_of_record',
          order: 1,
          presigned: true,
        },
        {
          key: 'client',
          label: 'Client',
          recipientRole: 'needs_to_sign',
          bind: 'matter_primary_contact',
          order: 2,
          presigned: true,
        },
      ] as TemplateEsignConfig['roles'],
      resolve,
    )
    expect(rows.find((r) => r.signerKey === 'attorney')?.presigned).toBe(true)
    expect(rows.find((r) => r.signerKey === 'client')?.presigned).toBe(false)
  })
})
