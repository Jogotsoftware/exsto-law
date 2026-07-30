// SB-FIX-1 — the four service-builder defects, pinned. PURE unit tests (no DB):
// every function under test is deliberately pure so the behaviour that was only
// observable in a live build is now checkable in CI.
//
// The reproduction these encode is docs/diagnostics/SB-FIX-1-REPRO.md.
import { describe, it, expect } from 'vitest'
import {
  BUILD_PHASES,
  buildPhaseNumber,
  currentBuildPhase,
  ensureJurisdictionField,
  formatBuildBrief,
  templateDriftFieldIds,
  templateDriftSuggestions,
  GOVERNING_JURISDICTION_FIELD_ID,
  type BuildBriefParts,
} from '@exsto/legal'
import type { IntakeSchema } from '@exsto/legal'

// ─── (1) the build order and where a build IS ───────────────────────────────

describe('the build order is the playbook order', () => {
  // The client strip used to declare its own order with questionnaire/template and
  // workflow/billing swapped, so it named the wrong phase for most of every build.
  // This pins the order to what firm-admin.build-service actually instructs.
  it('is shell → documents → questionnaire → billing → workflow → enable', () => {
    expect(BUILD_PHASES.map((p) => p.artifact)).toEqual([
      'service',
      'template',
      'questionnaire',
      'billing',
      'workflow',
      'enable',
    ])
  })

  it('numbers phases from 1', () => {
    expect(buildPhaseNumber(BUILD_PHASES[0]!)).toBe(1)
    expect(buildPhaseNumber(BUILD_PHASES[5]!)).toBe(6)
  })
})

describe('currentBuildPhase', () => {
  it('marches forward to the first unapproved phase when nothing is pending', () => {
    expect(currentBuildPhase(['service', 'template']).artifact).toBe('questionnaire')
  })

  it('is the card actually in front of the attorney when one is pending', () => {
    // Billing approved, a workflow card proposed and unapproved: the build is on
    // the workflow, not on "the first unapproved phase" by coincidence.
    expect(
      currentBuildPhase(['service', 'template', 'questionnaire', 'billing'], ['workflow']).artifact,
    ).toBe('workflow')
  })

  // THE defect: the attorney goes back to the intake after billing is approved.
  // The old derivation was monotonic and could never move back.
  it('MOVES BACKWARDS when an already-approved artifact is re-proposed', () => {
    const approved = ['service', 'template', 'questionnaire', 'billing']
    expect(currentBuildPhase(approved, []).artifact).toBe('workflow')
    expect(currentBuildPhase(approved, ['questionnaire']).artifact).toBe('questionnaire')
  })

  it('prefers the EARLIEST pending card when several are open', () => {
    expect(currentBuildPhase(['service'], ['workflow', 'questionnaire']).artifact).toBe(
      'questionnaire',
    )
  })

  it('settles on the last phase once everything is approved', () => {
    expect(currentBuildPhase(BUILD_PHASES.map((p) => p.artifact)).artifact).toBe('enable')
  })
})

const briefParts = (over: Partial<BuildBriefParts> = {}): BuildBriefParts => ({
  serviceKey: 'commercial_lease_review',
  service: {
    displayName: 'Commercial Lease Review',
    description: 'A plain-English review of your lease.',
    route: 'auto',
    generationMode: 'ai_draft',
    cost: { type: 'fixed', amount: '450.00', hours: null },
    isActive: false,
  },
  questionnaireFieldIds: ['lease_file', 'concerns'],
  templates: [{ documentKind: 'engagement_letter', tokens: ['client_name'] }],
  lifecycle: null,
  completeness: null,
  pendingArtifacts: [],
  templateDrift: [],
  ...over,
})

describe('the BUILD BRIEF states position and pending work', () => {
  it('always says where the build is, in the shared order', () => {
    const text = formatBuildBrief(briefParts())
    expect(text).toContain('Where this build is: step 5 of 6 — Workflow')
  })

  // The root cause of the re-proposal loop: the brief was derived only from
  // approved state, so "not proposed yet" and "proposed, awaiting you" both
  // rendered as "none yet".
  it('names the cards already awaiting the attorney and forbids re-proposing them', () => {
    const text = formatBuildBrief(briefParts({ pendingArtifacts: ['workflow'] }))
    expect(text).toContain('AWAITING THE ATTORNEY')
    expect(text).toContain('workflow')
    expect(text).toMatch(/Do NOT propose it again/)
  })

  it('reports the pending card as the current phase, not the next one', () => {
    const text = formatBuildBrief(briefParts({ pendingArtifacts: ['questionnaire'] }))
    expect(text).toContain('step 3 of 6 — Client intake')
  })

  it('carries template drift as its own loud line', () => {
    const text = formatBuildBrief(briefParts({ templateDrift: ['lease_years_remaining'] }))
    expect(text).toContain('DRIFT')
    expect(text).toContain('{{lease_years_remaining}}')
  })

  it('says nothing about drift or pending cards when there is none', () => {
    const text = formatBuildBrief(briefParts())
    expect(text).not.toContain('DRIFT')
    expect(text).not.toContain('AWAITING THE ATTORNEY')
  })
})

// ─── (2) questionnaire → template drift ─────────────────────────────────────

const schemaOf = (
  fields: Array<{ id: string; internal?: boolean }>,
  sectionId = 'main',
): IntakeSchema => ({
  sections: [
    {
      id: sectionId,
      title: 'Main',
      fields: fields.map((f) => ({
        id: f.id,
        label: f.id,
        type: 'text',
        ...(f.internal ? { internal: true } : {}),
      })),
    },
  ],
})

describe('templateDriftFieldIds', () => {
  // The live repro: the attorney asked for "how many years are left on the lease",
  // the questionnaire gained the field, and no document ever merged it.
  it('flags a client field no template token references', () => {
    const drift = templateDriftFieldIds(
      schemaOf([{ id: 'client_name' }, { id: 'lease_years_remaining' }]),
      ['client_name'],
    )
    expect(drift).toEqual(['lease_years_remaining'])
  })

  it('ignores internal (attorney-filled) fields — those are firm-side by design', () => {
    const drift = templateDriftFieldIds(
      schemaOf([{ id: 'client_name' }, { id: 'internal_note', internal: true }]),
      ['client_name'],
    )
    expect(drift).toEqual([])
  })

  it('ignores system tokens the platform resolves itself', () => {
    // matter_number is a curated merge slot — never a drift item.
    const drift = templateDriftFieldIds(schemaOf([{ id: 'matter_number' }]), [])
    expect(drift).toEqual([])
  })

  it('is silent when every field is merged', () => {
    expect(templateDriftFieldIds(schemaOf([{ id: 'client_name' }]), ['client_name'])).toEqual([])
  })

  it('is silent with no schema at all', () => {
    expect(templateDriftFieldIds(null, ['client_name'])).toEqual([])
  })
})

describe('templateDriftSuggestions', () => {
  it('says nothing before the service has any documents to drift from', () => {
    const s = templateDriftSuggestions(schemaOf([{ id: 'anything' }]), [], {
      hasTemplates: false,
    })
    expect(s).toEqual([])
  })

  it('names the field and its token when a template exists', () => {
    const s = templateDriftSuggestions(
      schemaOf([{ id: 'client_name' }, { id: 'lease_years_remaining' }]),
      ['client_name'],
      { hasTemplates: true },
    )
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('lease_years_remaining')
    expect(s[0]).toContain('{{lease_years_remaining}}')
  })
})

// ─── (3) governing jurisdiction is a default, not a judgment call ────────────

describe('ensureJurisdictionField', () => {
  const ids = (schema: unknown): string[] =>
    ((schema as IntakeSchema).sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => f.id))

  it('adds the reusable question to a document-drafting service that omitted it', () => {
    const { schema, added } = ensureJurisdictionField(schemaOf([{ id: 'company_name' }]), {
      jurisdictionSensitive: true,
    })
    expect(added).toBe(true)
    expect(ids(schema)).toContain(GOVERNING_JURISDICTION_FIELD_ID)
  })

  it('adds it as a real select with the honest-unset escape, never a hardcoded state', () => {
    const { schema } = ensureJurisdictionField(schemaOf([{ id: 'company_name' }]), {
      jurisdictionSensitive: true,
    })
    const field = (schema as IntakeSchema).sections
      .flatMap((s) => s.fields)
      .find((f) => f.id === GOVERNING_JURISDICTION_FIELD_ID)!
    expect(field.type).toBe('select')
    expect(field.allow_unknown).toBe(true)
    expect((field.options ?? []).length).toBeGreaterThan(50)
    expect(field.label_i18n?.es).toBeTruthy()
  })

  it('never adds a second copy', () => {
    const { schema, added } = ensureJurisdictionField(
      schemaOf([{ id: GOVERNING_JURISDICTION_FIELD_ID }]),
      { jurisdictionSensitive: true },
    )
    expect(added).toBe(false)
    expect(ids(schema).filter((i) => i === GOVERNING_JURISDICTION_FIELD_ID)).toHaveLength(1)
  })

  it('leaves a service that drafts nothing alone (consultation/advice)', () => {
    const { schema, added } = ensureJurisdictionField(schemaOf([{ id: 'concerns' }]), {
      jurisdictionSensitive: false,
    })
    expect(added).toBe(false)
    expect(ids(schema)).not.toContain(GOVERNING_JURISDICTION_FIELD_ID)
  })

  it('lands it in a CLIENT-FACING section, never an attorney-only one', () => {
    const schema: IntakeSchema = {
      sections: [
        {
          id: 'firm_use',
          title: 'Firm use',
          fields: [{ id: 'attorney_note', label: 'note', type: 'text', internal: true }],
        },
        {
          id: 'about_you',
          title: 'About you',
          fields: [{ id: 'company_name', label: 'c', type: 'text' }],
        },
      ],
    }
    const out = ensureJurisdictionField(schema, { jurisdictionSensitive: true })
      .schema as IntakeSchema
    const section = out.sections.find((s) =>
      (s.fields ?? []).some((f) => f.id === GOVERNING_JURISDICTION_FIELD_ID),
    )!
    expect(section.id).toBe('about_you')
  })

  it('makes its own client-facing section when every existing one is internal', () => {
    const schema: IntakeSchema = {
      sections: [
        {
          id: 'firm_use',
          title: 'Firm use',
          fields: [{ id: 'attorney_note', label: 'note', type: 'text', internal: true }],
        },
      ],
    }
    const out = ensureJurisdictionField(schema, { jurisdictionSensitive: true })
      .schema as IntakeSchema
    expect(out.sections).toHaveLength(2)
    expect(out.sections[1]!.fields[0]!.id).toBe(GOVERNING_JURISDICTION_FIELD_ID)
  })

  it('does not mutate the calling schema object', () => {
    const original = schemaOf([{ id: 'company_name' }])
    ensureJurisdictionField(original, { jurisdictionSensitive: true })
    expect(original.sections[0]!.fields).toHaveLength(1)
  })
})
