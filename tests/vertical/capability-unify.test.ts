// CAPABILITY-UNIFY-1 — pure unit tests for the authoring-surface changes: the
// document_generation step template renders its three config keys as placeholders and
// round-trips through its own diagnostic; generate_document is deprecated (still a
// runtime kind, excluded from the authorable set). No DB — the registry/template
// lookups (proven live by the prod acceptance receipts) stay in workflowAuthoring.ts.
import { describe, it, expect } from 'vitest'
import {
  STEP_ACTION_KINDS,
  AUTHORABLE_STEP_ACTION_KINDS,
  isDeprecatedStepActionKind,
  buildInvokeCapabilityStepTemplate,
  buildCapabilityConfigExample,
  diagnoseCapabilityStepConfig,
  capabilityConfigSchemaProps,
} from '@exsto/legal'

// The document_generation capability's config_schema (mirrors seed-capabilities.ts):
// the per-step reuse mechanism — one block, a different template per step.
const DOC_GEN_SCHEMA = {
  template_entity_id: {
    type: 'string',
    required: true,
    description: 'The EXACT firm template entity id this step drafts.',
  },
  generation_mode: {
    type: 'string',
    required: true,
    description: "How to produce the document: 'template_merge' or 'ai_draft'.",
  },
  instructions: {
    type: 'string',
    required: false,
    description: 'Optional drafting instructions/prompt for ai_draft mode.',
  },
}

describe('document_generation stepTemplate (WP4) — the shape the builder is handed', () => {
  const cap = { slug: 'document_generation', spec: { config_schema: DOC_GEN_SCHEMA } }
  const template = buildInvokeCapabilityStepTemplate(cap)
  const config = template.action.config as {
    capability_slug: string
    capability_config: Record<string, string>
  }

  it('is an invoke_capability step naming the document_generation slug', () => {
    expect(template.action.kind).toBe('invoke_capability')
    expect(config.capability_slug).toBe('document_generation')
  })

  it('renders all three config keys as visible <…> placeholders', () => {
    expect(config.capability_config.template_entity_id).toMatch(/^<.*>$/)
    expect(config.capability_config.generation_mode).toMatch(/^<.*>$/)
    expect(config.capability_config.instructions).toMatch(/^<.*>$/)
  })

  it('round-trips through its own diagnostic with ZERO errors once real values fill it', () => {
    // The generated example uses placeholders; a real config (required keys filled)
    // must produce no diagnostic errors — the zero-drift guarantee.
    const realConfig = {
      capability_slug: 'document_generation',
      capability_config: { template_entity_id: 'tmpl-123', generation_mode: 'ai_draft' },
    }
    expect(
      diagnoseCapabilityStepConfig('draft', 'document_generation', realConfig, DOC_GEN_SCHEMA),
    ).toEqual([])
  })

  it('flags a MISSING required template_entity_id (the required-config diagnostic)', () => {
    const bad = {
      capability_slug: 'document_generation',
      capability_config: { generation_mode: 'ai_draft' },
    }
    const errs = diagnoseCapabilityStepConfig('draft', 'document_generation', bad, DOC_GEN_SCHEMA)
    expect(errs.join(' ')).toContain('template_entity_id')
  })

  it('parses the schema to exactly the three declared props', () => {
    expect(Object.keys(capabilityConfigSchemaProps(DOC_GEN_SCHEMA)).sort()).toEqual([
      'generation_mode',
      'instructions',
      'template_entity_id',
    ])
    // Only the two required keys carry placeholders that MUST be filled; instructions
    // is optional. The example still renders all keys (WP4 part 1).
    expect(Object.keys(buildCapabilityConfigExample(DOC_GEN_SCHEMA)).length).toBe(3)
  })
})

describe('generate_document deprecation (WP5)', () => {
  it('stays a RUNTIME kind (existing definitions keep validating/running)', () => {
    expect(STEP_ACTION_KINDS).toContain('generate_document')
    expect(isDeprecatedStepActionKind('generate_document')).toBe(true)
  })

  it('is EXCLUDED from the authorable set (no new generate_document steps)', () => {
    expect(AUTHORABLE_STEP_ACTION_KINDS).not.toContain('generate_document')
  })

  it('keeps invoke_capability authorable (the replacement path)', () => {
    expect(AUTHORABLE_STEP_ACTION_KINDS).toContain('invoke_capability')
    expect(isDeprecatedStepActionKind('invoke_capability')).toBe(false)
  })
})
