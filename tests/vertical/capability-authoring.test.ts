// WORKFLOW-AUTHORING-1 — pure unit tests for the self-describing invoke_capability
// authoring contract (lifecycle/capabilityAuthoring.ts). No DB: the registry lookup
// stays in workflowAuthoring.ts (proven live by the acceptance receipts); this only
// checks the generator + diagnostics are internally consistent with each other.
import { describe, it, expect } from 'vitest'
import {
  capabilityConfigSchemaProps,
  buildCapabilityConfigExample,
  buildInvokeCapabilityStepTemplate,
  diagnoseCapabilityStepConfig,
  diagnoseMissingCapabilitySlug,
  allowedTransitionTokens,
  diagnoseEdgeTransition,
} from '@exsto/legal'

const RUBRIC_SCHEMA = {
  rubric: { type: 'string', required: true, description: 'what to check for' },
  note: { type: 'string', required: false, description: 'optional extra note' },
}

describe('capabilityConfigSchemaProps', () => {
  it('parses the flat shorthand shape (as seed-capabilities.ts writes it)', () => {
    expect(capabilityConfigSchemaProps(RUBRIC_SCHEMA)).toEqual({
      rubric: { type: 'string', required: true, description: 'what to check for' },
      note: { type: 'string', required: false, description: 'optional extra note' },
    })
  })

  it('parses the { properties: {...} } JSON-Schema shape too', () => {
    expect(capabilityConfigSchemaProps({ properties: RUBRIC_SCHEMA })).toEqual(
      capabilityConfigSchemaProps(RUBRIC_SCHEMA),
    )
  })

  it('is empty for an undefined/non-object schema', () => {
    expect(capabilityConfigSchemaProps(undefined)).toEqual({})
    expect(capabilityConfigSchemaProps('nope' as unknown as Record<string, unknown>)).toEqual({})
  })
})

describe('buildInvokeCapabilityStepTemplate — the worked example the builder is handed', () => {
  const cap = { slug: 'ai_document_review', spec: { config_schema: RUBRIC_SCHEMA } }
  const template = buildInvokeCapabilityStepTemplate(cap)

  it('uses the exact wrapper keys the validator/runtime read', () => {
    expect(template.action.kind).toBe('invoke_capability')
    const config = template.action.config as { capability_slug: string; capability_config: object }
    expect(config.capability_slug).toBe('ai_document_review')
    expect(config.capability_config).toHaveProperty('rubric')
  })

  it('placeholder values are non-empty and visibly placeholders', () => {
    const example = buildCapabilityConfigExample(RUBRIC_SCHEMA)
    expect(example.rubric).toMatch(/^<.*>$/)
  })

  it('round-trips through diagnoseCapabilityStepConfig with ZERO errors — the', () => {
    // generator and the diagnostic read the SAME schema-parsing helper, so a
    // template this module builds can never fail its own diagnostic (the
    // zero-drift guarantee WORKFLOW-AUTHORING-1 exists to provide).
    const rawConfig = template.action.config as Record<string, unknown>
    const errors = diagnoseCapabilityStepConfig(
      'review',
      'ai_document_review',
      rawConfig,
      RUBRIC_SCHEMA,
    )
    expect(errors).toEqual([])
  })
})

describe('diagnoseMissingCapabilitySlug — names the exact expected key', () => {
  it('names "capability_slug" when nothing is present', () => {
    const msg = diagnoseMissingCapabilitySlug('review', {})
    expect(msg).toContain('capability_slug')
    expect(msg).toContain('action.config.capability_slug')
  })

  it('calls out a stray "slug" key by name (the exact observed guess)', () => {
    const msg = diagnoseMissingCapabilitySlug('review', { slug: 'ai_document_review' })
    expect(msg).toContain('Found key "slug"')
    expect(msg).toContain('capability_slug')
  })
})

describe('diagnoseCapabilityStepConfig — names the exact expected path', () => {
  it('flags a flattened field with its correct nested path', () => {
    // the observed guess: rubric placed directly on action.config instead of
    // nested under capability_config.
    const errors = diagnoseCapabilityStepConfig(
      'review',
      'ai_document_review',
      { capability_slug: 'ai_document_review', rubric: 'check for X' },
      RUBRIC_SCHEMA,
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('capability_config')
    expect(errors[0]).toContain('directly on action.config')
  })

  it('flags a missing required key with the expected path, no flattening hint', () => {
    const errors = diagnoseCapabilityStepConfig(
      'review',
      'ai_document_review',
      { capability_slug: 'ai_document_review', capability_config: {} },
      RUBRIC_SCHEMA,
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('action.config.capability_config.rubric')
  })

  it('flags a stray configSchema key (the third observed guess)', () => {
    const errors = diagnoseCapabilityStepConfig(
      'review',
      'ai_document_review',
      {
        capability_slug: 'ai_document_review',
        configSchema: RUBRIC_SCHEMA,
        capability_config: { rubric: 'check for X' },
      },
      RUBRIC_SCHEMA,
    )
    expect(errors.some((e) => e.includes('configSchema'))).toBe(true)
  })

  it('is silent when the config is correctly nested and complete', () => {
    const errors = diagnoseCapabilityStepConfig(
      'review',
      'ai_document_review',
      { capability_slug: 'ai_document_review', capability_config: { rubric: 'check for X' } },
      RUBRIC_SCHEMA,
    )
    expect(errors).toEqual([])
  })

  it('optional keys never produce an error when absent', () => {
    const errors = diagnoseCapabilityStepConfig(
      'materials',
      'request_client_materials',
      { capability_slug: 'request_client_materials', capability_config: { message: 'send it' } },
      { message: { type: 'string', required: true }, note: { type: 'string', required: false } },
    )
    expect(errors).toEqual([])
  })
})

// WORKFLOW-AUTHORING-1 — the gate-transition vocabulary. These pin the catalog to
// the EXACT tokens the runtime dispatches on (the "single source" guarantee): if a
// dispatch call site changes, this test is where it surfaces.
describe('gate-transition vocabulary — pinned to the runtime dispatch tokens', () => {
  it('client via = the dispatchClientDelivery action kinds', () => {
    // handlers/booking.ts, documentUpload.ts, clientMessage.ts, clientRequest.ts (WP3).
    expect(allowedTransitionTokens('client')?.sort()).toEqual(
      [
        'booking.create',
        'client.message.post',
        'document.upload',
        'legal.client_request.accept',
      ].sort(),
    )
  })

  it('system on = the dispatchLifecycleEvent event kinds', () => {
    // handlers/invoice.ts, esign.ts, call.ts.
    expect(allowedTransitionTokens('system')?.sort()).toEqual(
      ['esign.completed', 'invoice.paid', 'transcript.received'].sort(),
    )
  })

  it('attorney via = the two attorney advances', () => {
    // handlers/matterWorkflow.ts (legal.matter.advance), handlers/draft.ts (draft.approve).
    expect(allowedTransitionTokens('attorney')?.sort()).toEqual(
      ['draft.approve', 'legal.matter.advance'].sort(),
    )
  })

  it('automatic is free-form (no fixed vocabulary)', () => {
    expect(allowedTransitionTokens('automatic')).toBeNull()
  })
})

describe('diagnoseEdgeTransition — names the offending token + the allowed set', () => {
  it('flags prose in a client via (the exact observed bug)', () => {
    const err = diagnoseEdgeTransition(
      'client_intake',
      'first_review',
      'client',
      'Client submits intake and uploads their draft agreement',
      undefined,
    )
    expect(err).toContain('document.upload')
    expect(err).toContain('never advance')
  })

  it('flags a wrong-punctuation system on (invoice_paid vs invoice.paid)', () => {
    const err = diagnoseEdgeTransition(
      'await_payment',
      'closed',
      'system',
      undefined,
      'invoice_paid',
    )
    expect(err).toContain('invoice.paid')
  })

  it('passes a real token', () => {
    expect(diagnoseEdgeTransition('a', 'b', 'client', 'document.upload', undefined)).toBeNull()
    expect(diagnoseEdgeTransition('a', 'b', 'attorney', 'draft.approve', undefined)).toBeNull()
    expect(diagnoseEdgeTransition('a', 'b', 'system', undefined, 'invoice.paid')).toBeNull()
  })

  it('never constrains an automatic edge (free-form on)', () => {
    expect(
      diagnoseEdgeTransition('a', 'b', 'automatic', undefined, 'anything_descriptive'),
    ).toBeNull()
  })

  it('leaves an ABSENT token to validateLifecycle (no double error)', () => {
    expect(diagnoseEdgeTransition('a', 'b', 'client', undefined, undefined)).toBeNull()
  })
})
