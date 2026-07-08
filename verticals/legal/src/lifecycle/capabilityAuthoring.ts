// WORKFLOW-AUTHORING-1 (ADR 0046 follow-on) — the self-describing authoring
// contract for `invoke_capability` steps. Pure, DB-free: everything here is a
// function of a capability's own `spec` (slug + config_schema), never a DB read.
//
// The bug this closes: the builder had to GUESS the invoke_capability step shape
// (capability_slug vs slug, rubric top-level vs nested in config, configSchema as
// a sub-object) because nothing ever told it the shape — only prose. The fix is
// not "make the model guess better," it's "stop making it guess": generate the
// EXACT shape from the SAME schema the validator checks, and hand it to the model
// verbatim (workflowAuthoring.ts loadWorkflowAuthoringContext → get_workflow_context).
// The SAME functions also build the validator's error text (workflowAuthoring.ts
// validateProposedLifecycle), so the example the model is shown and the message it
// gets on a miss can never drift from each other or from what the runtime reads
// (capabilityRuntime.ts: `stepConfig.capability_slug`, `stepConfig.capability_config`).
//
// The wrapper shape itself — the two keys `capability_slug` / `capability_config`
// — is NOT capability data; it's the invoke_capability step KIND's contract
// (CapabilityStepConfig, types.ts), identical for every capability. Building the
// example through a `CapabilityStepConfig`-typed literal (not raw object literals)
// means a future rename of those fields fails the TS build here too — the drift
// guard is the type system, not a second copy of the key names.
import type { CapabilityStepConfig, StepAction } from './types.js'

export interface CapabilityConfigProp {
  type?: string
  required?: boolean
  description?: string
}

// The one place `config_schema`'s permissive JSON-Schema-ish shape is parsed —
// `{ properties: { key: {...} } }` OR the flat `{ key: {...} }` shorthand seed data
// uses (verticals/legal/demo/seed-capabilities.ts). Both the example builder and
// the validator's diagnostic read through this, so they can never disagree about
// what a config_schema means.
export function capabilityConfigSchemaProps(
  schema: Record<string, unknown> | undefined,
): Record<string, CapabilityConfigProp> {
  if (!schema || typeof schema !== 'object') return {}
  const props = (schema.properties as Record<string, unknown> | undefined) ?? schema
  const out: Record<string, CapabilityConfigProp> = {}
  for (const [key, raw] of Object.entries(props)) {
    const field = (raw && typeof raw === 'object' ? raw : {}) as CapabilityConfigProp
    out[key] = { type: field.type, required: field.required, description: field.description }
  }
  return out
}

// A worked-example `capability_config` object: one placeholder value per schema
// key, wrapped in <…> so it reads unmistakably as "replace me" rather than a real
// value the model might leave verbatim.
export function buildCapabilityConfigExample(
  schema: Record<string, unknown> | undefined,
): Record<string, string> {
  const props = capabilityConfigSchemaProps(schema)
  const example: Record<string, string> = {}
  for (const [key, field] of Object.entries(props)) {
    example[key] = `<${field.description ?? key}>`
  }
  return example
}

// The literal `stage.action` shape to emit for THIS capability — generated, not
// hand-written, and typed through CapabilityStepConfig so the two key names can't
// silently diverge from what the validator/runtime read.
export function buildInvokeCapabilityStepTemplate(cap: {
  slug: string
  spec: { config_schema?: Record<string, unknown> }
}): { action: StepAction } {
  const config: CapabilityStepConfig = {
    capability_slug: cap.slug,
    capability_config: buildCapabilityConfigExample(cap.spec.config_schema),
  }
  return {
    action: { kind: 'invoke_capability', config: config as unknown as Record<string, unknown> },
  }
}

// Keys a model plausibly writes when it means `capability_slug` but guesses the
// name instead of reading it. Checked against the RAW config object (before it's
// cast to CapabilityStepConfig) so a miss can be named specifically rather than
// just reported as "missing."
const SLUG_KEY_GUESSES = ['slug', 'capability', 'capability_id', 'cap_slug', 'name']

// Keys a model plausibly writes when it means to hand over a capability's config
// but either flattens it onto action.config or pastes the schema itself instead of
// filling it in.
const SCHEMA_KEY_GUESSES = ['configSchema', 'config_schema', 'schema']

// Precise, actionable errors for a single invoke_capability stage's RAW
// action.config against the capability's real config_schema — pure (no DB): the
// registry lookup (does the capability exist / is it invocable) stays in
// workflowAuthoring.ts, which has the DB-backed registry; this only compares the
// raw object shape the model produced to the schema it should have followed, so it
// is unit-testable without a live tenant. Every message states the exact expected
// path so ONE correction lands it — never N rounds of blind mutation.
export function diagnoseCapabilityStepConfig(
  stageKey: string,
  slug: string,
  rawConfig: Record<string, unknown>,
  schema: Record<string, unknown> | undefined,
): string[] {
  const errors: string[] = []
  const cfg = rawConfig as unknown as CapabilityStepConfig
  const capabilityConfig = (cfg.capability_config ?? {}) as Record<string, unknown>
  const props = capabilityConfigSchemaProps(schema)

  const strayConfigSchemaKey = SCHEMA_KEY_GUESSES.find((k) => k in rawConfig)
  if (strayConfigSchemaKey) {
    errors.push(
      `stage "${stageKey}": action.config has a "${strayConfigSchemaKey}" key — that is metadata describing the shape, not a field to set. Remove it; set the actual values under action.config.capability_config instead.`,
    )
  }

  for (const [key, field] of Object.entries(props)) {
    if (!field.required) continue
    const v = capabilityConfig[key]
    const empty = v == null || (typeof v === 'string' && !v.trim())
    if (!empty) continue
    const flattened = key in rawConfig
    const hint = flattened
      ? ` Found "${key}" directly on action.config — it must be nested INSIDE action.config.capability_config, e.g. ${JSON.stringify({ capability_slug: slug, capability_config: { [key]: '…' } })}.`
      : ` Expected at action.config.capability_config.${key}.`
    errors.push(
      `stage "${stageKey}" runs capability "${slug}" but its required config "${key}" is missing.${hint}`,
    )
  }

  return errors
}

// Errors for a stray/misnamed `capability_slug`. Pure, DB-free — called before the
// registry lookup so a wrong key name is named specifically rather than reported as
// a bare "missing."
export function diagnoseMissingCapabilitySlug(
  stageKey: string,
  rawConfig: Record<string, unknown>,
): string {
  const strayKey = SLUG_KEY_GUESSES.find((k) => k in rawConfig)
  const hint = strayKey
    ? ` Found key "${strayKey}" instead — the required key name is exactly "capability_slug" (a direct child of action.config, e.g. ${JSON.stringify({ capability_slug: String(rawConfig[strayKey]), capability_config: {} })}).`
    : ' Expected at action.config.capability_slug.'
  return `stage "${stageKey}" is an invoke_capability step but names no capability_slug.${hint}`
}
