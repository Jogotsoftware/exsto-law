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
import { loadServiceTemplateTokens, templateDriftFieldIds } from './intakeAuthoring.js'
import { getQuestionnaire } from './services.js'
import {
  BUILD_PHASES,
  buildPhaseNumber,
  currentBuildPhase,
  type BuildArtifact,
} from './buildOrder.js'

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
  // SB-FIX-1 (1) — the artifacts already PROPOSED and still sitting unapproved in
  // front of the attorney. The brief is otherwise derived purely from persisted
  // state, and a proposed card persists nothing, so without this the model cannot
  // tell "not proposed yet" from "proposed, awaiting the attorney" — and after any
  // detour it re-derives its position from approvals alone and proposes the same
  // card again (REPRO §C3: a cost card shown three times, a workflow card silently
  // abandoned). Card state lives on the client, so the client sends it.
  pendingArtifacts: BuildArtifact[]
  // SB-FIX-1 (2) — intake questions no document template merges.
  templateDrift: string[]
}

const MAX_BRIEF_CHARS = 4000

// Which build phases are DONE, read off the live artifacts the brief already loaded.
// Derived, never stored — same doctrine as the rest of this file. 'enable' is done
// only once the service is actually active.
function approvedArtifacts(parts: BuildBriefParts): BuildArtifact[] {
  const done: BuildArtifact[] = []
  if (parts.service) done.push('service')
  if (parts.templates.length) done.push('template')
  if (parts.questionnaireFieldIds.length) done.push('questionnaire')
  if (parts.service?.cost) done.push('billing')
  if (parts.lifecycle) done.push('workflow')
  if (parts.service?.isActive) done.push('enable')
  return done
}

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
  // SB-FIX-1 (1): the artifact lines below say "none yet" when nothing is APPROVED.
  // On its own that reads identically whether a card was never proposed or is sitting
  // on the attorney's screen right now — which is exactly the confusion that made the
  // model re-propose. So each line that would say "none yet" says "awaiting approval"
  // instead when its card is pending.
  const pendingNow = parts.pendingArtifacts ?? []
  const awaiting = (a: BuildArtifact, none: string): string =>
    pendingNow.includes(a)
      ? `${none.split(':')[0]}: PROPOSED — the card is on the attorney's screen awaiting approval. Do not propose it again.`
      : none
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
    lines.push(awaiting('template', 'Templates: none yet.'))
  }
  lines.push(
    parts.questionnaireFieldIds.length
      ? `Questionnaire (approved) fields: ${parts.questionnaireFieldIds.join(', ')}`
      : awaiting('questionnaire', 'Questionnaire: none yet.'),
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
    lines.push(awaiting('workflow', 'Workflow: none yet.'))
  }
  lines.push(
    s.cost
      ? `Billing (approved): ${s.cost.type} ${s.cost.amount}${s.cost.hours ? ` (${s.cost.hours}h)` : ''}`
      : awaiting('billing', 'Billing: not set yet.'),
  )
  if (parts.completeness) {
    lines.push(
      parts.completeness.ready
        ? 'Enable gate: READY — propose Enable when the attorney is done.'
        : `Open items before Enable: ${parts.completeness.missing.join('; ')}`,
    )
  }
  // SB-FIX-1 (2) — the reverse half of the variable contract. Loud, because the
  // failure is silent by nature: the client answers a question that reaches no
  // document and nobody finds out until a matter runs.
  const drift = parts.templateDrift ?? []
  if (drift.length) {
    lines.push(
      `DRIFT — the intake collects ${drift.map((d) => `"${d}"`).join(', ')} but no ` +
        `template merges ${drift.length === 1 ? 'it' : 'them'} ` +
        `(${drift.map((d) => `{{${d}}}`).join(', ')} ${drift.length === 1 ? 'appears' : 'appear'} in no document body). ` +
        `Before Enable: re-propose the template with ${drift.length === 1 ? 'that token' : 'those tokens'} ` +
        `placed where ${drift.length === 1 ? 'it belongs' : 'they belong'}, or tell the attorney in one line why the ` +
        `${drift.length === 1 ? 'answer is' : 'answers are'} collected without ` +
        `appearing in the document. Do not leave it unsaid.`,
    )
  }
  // SB-FIX-1 (1) — where the build IS, stated rather than re-derived from prose.
  // The pending line comes first and is unambiguous: a card already on screen is
  // never re-proposed, and a revision detour ENDS by returning to it.
  const approved = approvedArtifacts(parts)
  if (pendingNow.length) {
    lines.push(
      `AWAITING THE ATTORNEY — you already proposed ${pendingNow.join(', ')} and ` +
        `${pendingNow.length === 1 ? 'that card is' : 'those cards are'} still on ` +
        `screen unapproved. Do NOT propose ${pendingNow.length === 1 ? 'it' : 'them'} ` +
        `again. If the attorney has just sent you somewhere else (a change to an earlier piece), ` +
        `handle that, and when it is approved come back and pick up ` +
        `${pendingNow.length === 1 ? 'that card' : 'those cards'} — not the step ` +
        `before it.`,
    )
  }
  const phase = currentBuildPhase(approved, pendingNow)
  lines.push(
    `Where this build is: step ${buildPhaseNumber(phase)} of ${BUILD_PHASES.length} — ` +
      `${phase.label}. The order is ${BUILD_PHASES.map((p) => p.label).join(' → ')}. ` +
      `Do the current step; never restart at an earlier one just because a detour ended.`,
  )
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
  pendingArtifacts: BuildArtifact[] = [],
): Promise<BuildBriefParts> {
  // The pending list arrives from the client (card state lives there), so it is
  // filtered to the known artifacts before it can reach the prompt text — a request
  // body must never be able to write free prose into the system block.
  const pending = pendingArtifacts.filter((a) => BUILD_PHASES.some((p) => p.artifact === a))
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
      pendingArtifacts: pending,
      templateDrift: [],
    }
  }
  const [questionnaireFieldIds, templateTokens, lifecycle, completeness, schema] =
    await Promise.all([
      collectQuestionnaireFieldIds(ctx, serviceKey).catch(() => [] as string[]),
      loadServiceTemplateTokens(ctx, serviceKey).catch(() => ({ templates: [], tokens: [] })),
      getServiceLifecycle(ctx, serviceKey).catch(() => null),
      serviceCompleteness(ctx, serviceKey).catch(() => null),
      getQuestionnaire(ctx, serviceKey).catch(() => null),
    ])
  // SB-FIX-1 (2) — only meaningful once the service HAS documents to drift from.
  const templateDrift = templateTokens.templates.length
    ? templateDriftFieldIds(schema, templateTokens.tokens)
    : []
  return {
    serviceKey,
    pendingArtifacts: pending,
    templateDrift,
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
  pendingArtifacts: BuildArtifact[] = [],
): Promise<string> {
  const key = (serviceKey ?? '').trim()
  if (!key) return ''
  return formatBuildBrief(await loadBuildBriefParts(ctx, key, pendingArtifacts))
}
