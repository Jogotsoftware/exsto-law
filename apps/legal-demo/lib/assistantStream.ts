import { readDevSession } from './auth'
import { SessionExpiredError } from './mcpAttorney'

const IS_DEV = process.env.NODE_ENV !== 'production'

export type WorkRate = 'quick' | 'balanced' | 'thorough'
// How much matter/client history the assistant is fed per turn (chat setting).
export type ContextDepth = 'lean' | 'balanced' | 'generous'

export interface AssistantStreamInput {
  message: string
  modelId: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  matterEntityId?: string
  contactEntityId?: string
  workRate?: WorkRate
  webSearch?: boolean
  useContext?: boolean
  contextDepth?: ContextDepth
  // Skills the attorney picked from the /skills menu — force-loaded this turn.
  skillSlugs?: string[]
  // Documents attached to this message (Claude only): each { name, text }.
  attachments?: Array<{ name: string; text: string }>
  pageContext?: { path?: string; [k: string]: unknown }
}

export interface StreamMeta {
  provider: string
  model: string
  kind: string
  scope: string
  webSearch: boolean
}

export interface StreamDone {
  eventId: string
  reply: string
  citations: string[]
  model: string
}

// A workflow lifecycle the assistant proposed this turn (PR5) — surfaced as an
// inline approval card; the live write happens only on attorney approve.
export interface WorkflowProposalEvent {
  serviceKey: string
  graph: unknown[]
  summary: string
  confidence: number
}

// A NEW service the assistant proposed this turn (Build-Wizard Phase 1) — surfaced
// as an inline approval card; the version-1 (disabled) write happens only on approve.
export interface ServiceProposalEvent {
  displayName: string
  derivedKey: string
  description: string | null
  route: 'auto' | 'manual'
  generationMode: 'template_merge' | 'ai_draft'
  summary: string
  confidence: number
}

// A NEW data kind the assistant proposed this turn (Build-Wizard, Tier 1
// data-as-schema) — surfaced as an inline approval card; minted only on approve.
export interface KindProposalEvent {
  registry: 'entity' | 'attribute' | 'relationship' | 'event'
  kindName: string
  displayName: string
  description: string | null
  onEntityKind: string | null
  valueType: string | null
  sourceEntityKind: string | null
  targetEntityKind: string | null
  summary: string
  confidence: number
}

// An intake QUESTIONNAIRE the assistant proposed this turn (Build-Wizard Phase 2) —
// surfaced as an inline approval card with the variable-contract coverage; the write
// happens only on approve.
export interface QuestionnaireProposalEvent {
  serviceKey: string
  schema: unknown
  summary: string
  confidence: number
  missingForTokens: string[]
  unusedFields: string[]
}

// A document TEMPLATE the assistant proposed this turn (Build-Wizard Phase 3) —
// surfaced as an inline approval card with the orphan tokens; the write happens only
// on approve.
export interface TemplateProposalEvent {
  serviceKey: string
  name: string
  body: string
  docKind: string
  summary: string
  confidence: number
  tokens: string[]
  orphanTokens: string[]
  // Phase 7 — flow-aware framing: whether a questionnaire exists yet (so orphans read
  // as forward-looking vs. broken) and which orphan tokens already exist firm-wide.
  hasQuestionnaire: boolean
  reusableFromFirm: string[]
}

// A structured interview QUESTION the assistant asked this turn (Build-Wizard Phase 7)
// — surfaced as a click-to-answer QuestionCard; the answer rides back as a HIDDEN
// continuation so the build feels like a wizard, not free chat.
export interface BuildQuestionChoice {
  value: string
  label: string
  hint?: string
}
export interface BuildQuestionEvent {
  key: string
  question: string
  choices: BuildQuestionChoice[]
  allowFreeText: boolean
  multiSelect: boolean
}

// A service's BILLING (fee model) the assistant proposed this turn (Build-Wizard
// Phase 6) — surfaced as an inline approval card; the cost write happens only on
// approve.
export interface CostProposalEvent {
  serviceKey: string
  costType: 'hourly' | 'fixed'
  amount: string
  hours: number | null
  summary: string
  confidence: number
}

// An ENABLE request the assistant proposed this turn (Build-Wizard Phase 6 — the
// terminal step) — surfaced as the final approval card; the status flip to active
// happens only on approve.
export interface EnableProposalEvent {
  serviceKey: string
  summary: string
}

export interface AssistantStreamHandlers {
  onMeta?: (meta: StreamMeta) => void
  onThinking?: (text: string) => void
  onText?: (text: string) => void
  // The assistant is generating a tool input (drafting a document/questionnaire into a
  // propose_* call) — a heartbeat shown as a live "drafting" animation.
  onDrafting?: () => void
  // The assistant loaded a specialized skill (playbook) for this turn.
  onSkill?: (skill: { slug: string; name: string }) => void
  // The assistant produced a downloadable document (a deliverable, not the prose).
  onDocument?: (doc: { title: string; markdown: string }) => void
  // The assistant proposed a service workflow (PR5) — render an approval card.
  onWorkflowProposal?: (proposal: WorkflowProposalEvent) => void
  // The assistant proposed a NEW service (Build-Wizard Phase 1) — render a card.
  onServiceProposal?: (proposal: ServiceProposalEvent) => void
  onKindProposal?: (proposal: KindProposalEvent) => void
  // The assistant proposed an intake questionnaire (Build-Wizard Phase 2).
  onQuestionnaireProposal?: (proposal: QuestionnaireProposalEvent) => void
  // The assistant proposed a document template (Build-Wizard Phase 3).
  onTemplateProposal?: (proposal: TemplateProposalEvent) => void
  // The assistant proposed the billing/fee model (Build-Wizard Phase 6).
  onCostProposal?: (proposal: CostProposalEvent) => void
  // The assistant proposed enabling the service (Build-Wizard Phase 6 — terminal).
  onEnableProposal?: (proposal: EnableProposalEvent) => void
  // The assistant asked a structured interview question (Build-Wizard Phase 7).
  onBuildQuestion?: (question: BuildQuestionEvent) => void
  onDone?: (done: StreamDone) => void
  onError?: (message: string) => void
}

// Drive the attorney assistant streaming endpoint and fan the SSE events out to
// the handlers. Mirrors callAttorneyMcp's auth (signed cookie in prod; dev shim
// headers locally) and its 401 → bounce-to-sign-in behaviour.
export async function streamAssistant(
  input: AssistantStreamInput,
  handlers: AssistantStreamHandlers,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (IS_DEV) {
    const dev = readDevSession()
    if (dev) {
      headers['x-actor-id'] = dev.actorId
      headers['x-tenant-id'] = dev.tenantId
    }
  }

  const res = await fetch('/api/attorney/assistant/stream', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })

  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/'
    }
    throw new SessionExpiredError()
  }
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      const parsed = JSON.parse(await res.text())
      detail = parsed?.error ?? ''
    } catch {
      // ignore
    }
    handlers.onError?.(detail || `Request failed (${res.status})`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    // One SSE record is its `data:` line(s). We send a single-line JSON payload.
    const line = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!line) return
    const data = line.slice(5).trim()
    if (!data) return
    let evt: { type: string; [k: string]: unknown }
    try {
      evt = JSON.parse(data)
    } catch {
      return
    }
    switch (evt.type) {
      case 'meta':
        handlers.onMeta?.(evt as unknown as StreamMeta)
        break
      case 'thinking':
        handlers.onThinking?.(String(evt.text ?? ''))
        break
      case 'text':
        handlers.onText?.(String(evt.text ?? ''))
        break
      case 'drafting':
        handlers.onDrafting?.()
        break
      case 'skill':
        handlers.onSkill?.({ slug: String(evt.slug ?? ''), name: String(evt.name ?? '') })
        break
      case 'document':
        handlers.onDocument?.({
          title: String(evt.title ?? 'Document'),
          markdown: String(evt.markdown ?? ''),
        })
        break
      case 'workflow_proposal':
        handlers.onWorkflowProposal?.({
          serviceKey: String(evt.serviceKey ?? ''),
          graph: Array.isArray(evt.graph) ? (evt.graph as unknown[]) : [],
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
        })
        break
      case 'service_proposal':
        handlers.onServiceProposal?.({
          displayName: String(evt.displayName ?? ''),
          derivedKey: String(evt.derivedKey ?? ''),
          description: typeof evt.description === 'string' ? evt.description : null,
          route: evt.route === 'auto' ? 'auto' : 'manual',
          generationMode: evt.generationMode === 'ai_draft' ? 'ai_draft' : 'template_merge',
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
        })
        break
      case 'questionnaire_proposal':
        handlers.onQuestionnaireProposal?.({
          serviceKey: String(evt.serviceKey ?? ''),
          schema: evt.schema ?? null,
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
          missingForTokens: Array.isArray(evt.missingForTokens)
            ? (evt.missingForTokens as string[])
            : [],
          unusedFields: Array.isArray(evt.unusedFields) ? (evt.unusedFields as string[]) : [],
        })
        break
      case 'template_proposal':
        handlers.onTemplateProposal?.({
          serviceKey: String(evt.serviceKey ?? ''),
          name: String(evt.name ?? ''),
          body: String(evt.body ?? ''),
          docKind: String(evt.docKind ?? ''),
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
          tokens: Array.isArray(evt.tokens) ? (evt.tokens as string[]) : [],
          orphanTokens: Array.isArray(evt.orphanTokens) ? (evt.orphanTokens as string[]) : [],
          hasQuestionnaire: evt.hasQuestionnaire === true,
          reusableFromFirm: Array.isArray(evt.reusableFromFirm)
            ? (evt.reusableFromFirm as string[])
            : [],
        })
        break
      case 'cost_proposal':
        handlers.onCostProposal?.({
          serviceKey: String(evt.serviceKey ?? ''),
          costType: evt.costType === 'hourly' ? 'hourly' : 'fixed',
          amount: String(evt.amount ?? ''),
          hours: typeof evt.hours === 'number' ? evt.hours : null,
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
        })
        break
      case 'enable_proposal':
        handlers.onEnableProposal?.({
          serviceKey: String(evt.serviceKey ?? ''),
          summary: String(evt.summary ?? ''),
        })
        break
      case 'kind_proposal':
        handlers.onKindProposal?.({
          registry:
            evt.registry === 'entity' || evt.registry === 'relationship' || evt.registry === 'event'
              ? evt.registry
              : 'attribute',
          kindName: String(evt.kindName ?? ''),
          displayName: String(evt.displayName ?? ''),
          description: typeof evt.description === 'string' ? evt.description : null,
          onEntityKind: typeof evt.onEntityKind === 'string' ? evt.onEntityKind : null,
          valueType: typeof evt.valueType === 'string' ? evt.valueType : null,
          sourceEntityKind: typeof evt.sourceEntityKind === 'string' ? evt.sourceEntityKind : null,
          targetEntityKind: typeof evt.targetEntityKind === 'string' ? evt.targetEntityKind : null,
          summary: String(evt.summary ?? ''),
          confidence: typeof evt.confidence === 'number' ? evt.confidence : 0.7,
        })
        break
      case 'build_question':
        handlers.onBuildQuestion?.({
          key: String(evt.key ?? ''),
          question: String(evt.question ?? ''),
          choices: Array.isArray(evt.choices)
            ? (evt.choices as Array<Record<string, unknown>>).map((c) => ({
                value: String(c.value ?? ''),
                label: String(c.label ?? ''),
                hint: typeof c.hint === 'string' && c.hint ? c.hint : undefined,
              }))
            : [],
          allowFreeText: evt.allowFreeText === true,
          multiSelect: evt.multiSelect === true,
        })
        break
      case 'done':
        handlers.onDone?.(evt as unknown as StreamDone)
        break
      case 'error':
        handlers.onError?.(String(evt.message ?? 'Something went wrong.'))
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    // Records are separated by a blank line (\n\n).
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const record = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      dispatch(record)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}
