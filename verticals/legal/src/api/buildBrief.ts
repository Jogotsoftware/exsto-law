// BUILD BRIEF (BUILDER-HARDENING-1 WP4) — the live, server-derived state of the
// service currently being built in the guided wizard, injected into the volatile
// system block each turn while a build is active. The model must never need to
// re-ask something the substrate already knows.
//
// Deliberately DERIVED, not stored: every fact here is read fresh from what the
// substrate already persists (the service row, its questionnaire, its document
// templates, its authored lifecycle, its cost, its completeness gate), so the
// brief can never drift from reality and needs no new table, kind, or migration.
// The original session brief called for a persisted "chat-conversation namespace"
// store — no such pattern exists in this repo; derivation covers the same need
// (approved artifacts + open items) from the source of truth instead.
import type { ActionContext } from '@exsto/substrate'
import type { Lifecycle } from '../lifecycle/index.js'
import {
  listServicesIncludingInactive,
  collectQuestionnaireFieldIds,
  serviceCompleteness,
  type ServiceDefinition,
  type ServiceCompleteness,
} from './services.js'
import { getServiceLifecycle } from './serviceLifecycle.js'
import { loadServiceTemplateTokens } from './intakeAuthoring.js'

// Everything the brief renders, loaded in one place so the formatter is pure
// (and unit-testable without a database).
export interface BuildBriefParts {
  serviceKey: string
  service: Pick<
    ServiceDefinition,
    'displayName' | 'description' | 'route' | 'generationMode' | 'cost' | 'isActive'
  > | null
  questionnaireFieldIds: string[]
  templates: Array<{ documentKind: string; tokens: string[] }>
  lifecycle: { graph: Lifecycle; version: number } | null
  completeness: ServiceCompleteness | null
}

const MAX_BRIEF_CHARS = 4000

// Render the brief as the compact block the volatile system prompt carries.
// Pure — no DB. Kept terse: the model needs identifiers and structure, not prose.
export function formatBuildBrief(parts: BuildBriefParts): string {
  const lines: string[] = [
    "--- Current build (live state — read this before asking or proposing ANYTHING; never re-ask what's already here) ---",
    `Service under construction: "${parts.serviceKey}"`,
  ]
  if (!parts.service) {
    lines.push(
      'The service shell does not exist yet (nothing approved). Only the shell can be proposed at this point.',
    )
    return lines.join('\n')
  }
  const s = parts.service
  lines.push(
    `Shell (approved): ${s.displayName} — route=${s.route}, generation_mode=${s.generationMode}, status=${s.isActive ? 'ACTIVE (live)' : 'disabled draft'}`,
  )
  if (s.description) lines.push(`Client-facing description: ${s.description}`)
  if (parts.templates.length) {
    for (const t of parts.templates) {
      lines.push(
        `Template (approved): ${t.documentKind} — tokens: ${t.tokens.join(', ') || '(none)'}`,
      )
    }
  } else {
    lines.push('Templates: none yet.')
  }
  lines.push(
    parts.questionnaireFieldIds.length
      ? `Questionnaire (approved) fields: ${parts.questionnaireFieldIds.join(', ')}`
      : 'Questionnaire: none yet.',
  )
  if (parts.lifecycle) {
    const steps = parts.lifecycle.graph
      .map(
        (st) =>
          `${st.key}(${st.action?.kind ?? 'manual_task'}/${st.advances_to[0]?.gate ?? 'terminal'})`,
      )
      .join(' → ')
    lines.push(`Workflow (approved, v${parts.lifecycle.version}): ${steps}`)
  } else {
    lines.push('Workflow: none yet.')
  }
  lines.push(
    s.cost
      ? `Billing (approved): ${s.cost.type} ${s.cost.amount}${s.cost.hours ? ` (${s.cost.hours}h)` : ''}`
      : 'Billing: not set yet.',
  )
  if (parts.completeness) {
    lines.push(
      parts.completeness.ready
        ? 'Enable gate: READY — propose Enable when the attorney is done.'
        : `Open items before Enable: ${parts.completeness.missing.join('; ')}`,
    )
  }
  const text = lines.join('\n')
  return text.length > MAX_BRIEF_CHARS ? `${text.slice(0, MAX_BRIEF_CHARS)} …[truncated]` : text
}

// Load the live parts for a service under construction. Read-only; each loader
// tolerates the artifact not existing yet (early in a build most don't).
// NOTE: a service under construction is a DISABLED draft for the whole build
// (only the terminal Enable flips it active), and getService is deliberately
// active-only — so the brief must read via the include-inactive admin list, or
// it would claim "no shell" for the entire build (caught by a live check).
export async function loadBuildBriefParts(
  ctx: ActionContext,
  serviceKey: string,
): Promise<BuildBriefParts> {
  const service = await listServicesIncludingInactive(ctx)
    .then((all) => all.find((s) => s.serviceKey === serviceKey) ?? null)
    .catch(() => null)
  if (!service) {
    return {
      serviceKey,
      service: null,
      questionnaireFieldIds: [],
      templates: [],
      lifecycle: null,
      completeness: null,
    }
  }
  const [questionnaireFieldIds, templateTokens, lifecycle, completeness] = await Promise.all([
    collectQuestionnaireFieldIds(ctx, serviceKey).catch(() => [] as string[]),
    loadServiceTemplateTokens(ctx, serviceKey).catch(() => ({ templates: [], tokens: [] })),
    getServiceLifecycle(ctx, serviceKey).catch(() => null),
    serviceCompleteness(ctx, serviceKey).catch(() => null),
  ])
  return {
    serviceKey,
    service: {
      displayName: service.displayName,
      description: service.description,
      route: service.route,
      generationMode: service.generationMode,
      cost: service.cost,
      isActive: service.isActive,
    },
    questionnaireFieldIds,
    templates: templateTokens.templates.map((t) => ({
      documentKind: t.documentKind,
      tokens: t.tokens,
    })),
    lifecycle,
    completeness,
  }
}

// One-call convenience the chat path uses: '' when the key is blank (no build
// active), the formatted block otherwise.
export async function buildBuildBriefText(
  ctx: ActionContext,
  serviceKey: string | undefined,
): Promise<string> {
  const key = (serviceKey ?? '').trim()
  if (!key) return ''
  return formatBuildBrief(await loadBuildBriefParts(ctx, key))
}
