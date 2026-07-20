'use client'

// Shared types + presentation helpers for the matter editor tabs (Overview /
// Activity / Documents / Billing). Not a route — a plain module imported by the
// tab pages and the layout, so humanizers + the questionnaire/transcript renderers
// live in exactly one place.

// ── Workflow shape (ADR 0045 PR3) ───────────────────────────────────────────
// The app cannot import the server lifecycle types (no server-package imports in
// app code), so it declares the MINIMAL shape the data-driven Workflow window needs
// — a structural mirror of verticals/legal/src/lifecycle/types.ts. These are read
// off the matter read contract (queries/matters.ts) verbatim; the app never
// constructs them. Null `matter.workflow` ⇒ the matter has no running instance and
// the page falls back to the existing derived-step window, unchanged.
export type WfGate = 'automatic' | 'attorney' | 'client' | 'system'

export type WfStepActionKind =
  | 'view_intake'
  | 'view_consultation'
  | 'generate_document'
  | 'review_send_document'
  | 'approve_send_invoice'
  | 'await_payment'
  | 'manual_task'
  | 'complete_matter'
  | 'invoke_capability'

export interface WfEdge {
  to: string
  gate: WfGate
  via?: string
  on?: string
  when?: string
}

export interface WfStage {
  key: string
  label: string
  client_label?: string
  entry?: boolean
  terminal?: boolean
  blocking?: boolean
  action?: { kind: WfStepActionKind; config?: Record<string, unknown> }
  documents?: Array<{ templateEntityId?: string; docKind?: string; label?: string }>
  advances_to: WfEdge[]
}

export interface MatterWorkflow {
  instanceId: string
  definitionId: string
  graph: WfStage[]
  currentState: string
  status: string
}

export interface MatterDetail {
  matterEntityId: string
  matterNumber: string
  clientName: string
  clientEmail: string | null
  practiceArea: string
  status: string
  summary: string
  createdAt: string
  attributes: Record<string, unknown>
  questionnaireResponses: Record<string, unknown> | null
  transcriptText: string | null
  latestDraftVersionId: string | null
  latestDraftStatus: string | null
  clientEntityId: string | null
  // Present only when a workflow instance is running for this matter (ADR 0045
  // PR3). Null is the default today; null ⇒ the page renders the existing
  // derived-step window with no behavior change.
  workflow?: MatterWorkflow | null
  // MACHINE-COMMS-1: true ⇒ this matter has NO workflow instance but its service
  // HAS an authored lifecycle — the page shows the honest repair panel instead of
  // the legacy derived-step window.
  workflowRepairAvailable?: boolean
  // WP A1 — resolved governing law: matter override > firm home jurisdiction >
  // null (honest unset). Display + edit control on the Overview facts card.
  governingLaw?: { code: string; displayName: string; source: 'matter' | 'firm' } | null
}

// Client-side replica of the server resolver's stepStates idea (resolve.ts): a
// stage is `done` if it comes before the current stage in graph (display) order,
// `current` if it IS the current stage, `upcoming` otherwise. Kept here (≈5 lines)
// rather than imported so app code never reaches into a server package.
export type WfStepState = 'done' | 'current' | 'upcoming'

export function workflowStepStates(
  graph: WfStage[],
  currentState: string,
): Array<{ stage: WfStage; state: WfStepState }> {
  const currentIdx = graph.findIndex((s) => s.key === currentState)
  return graph.map((stage, i) => ({
    stage,
    state:
      currentIdx === -1
        ? 'upcoming'
        : i < currentIdx
          ? 'done'
          : i === currentIdx
            ? 'current'
            : 'upcoming',
  }))
}

export function humanizeKind(k: string): string {
  return k.replace(/_/g, ' ')
}

// ── Matter workflow steps ──────────────────────────────────────────────────
// There is no first-class "step" record; a matter's progress IS the presence of
// the intake questionnaire, the consultation transcript, and the latest document
// draft, walked in lifecycle order. The first not-done step is the "current" one.
export type StepKey = 'intake' | 'consultation' | 'document' | 'approve' | 'client' | 'bill'
export type StepState = 'done' | 'current' | 'pending'

export interface MatterStep {
  key: StepKey
  title: string
  state: StepState
  subtitle: string
}

export function deriveMatterSteps(
  matter: MatterDetail,
  opts: { hasInvoice?: boolean } = {},
): MatterStep[] {
  const draftLabel = matter.latestDraftStatus
    ? `Latest draft · ${humanizeStatus(matter.latestDraftStatus)}`
    : 'Latest draft ready'
  const hasDraft = matter.latestDraftVersionId !== null
  const approved = matter.latestDraftStatus === 'approved'
  const hasInvoice = opts.hasInvoice === true

  // The first four steps walk in lifecycle order; the first not-done one is the
  // "current" step.
  const coreDefs: Array<{ key: StepKey; title: string; isDone: boolean; subtitle: string }> = [
    {
      key: 'intake',
      title: 'Intake',
      isDone: matter.questionnaireResponses !== null,
      subtitle:
        matter.questionnaireResponses !== null
          ? 'Questionnaire submitted'
          : 'Awaiting the client’s questionnaire',
    },
    {
      key: 'consultation',
      title: 'Consultation',
      isDone: matter.transcriptText !== null,
      subtitle: matter.transcriptText !== null ? 'Call recorded' : 'No consultation transcript yet',
    },
    {
      key: 'document',
      title: 'Document',
      isDone: hasDraft,
      subtitle: hasDraft ? draftLabel : 'No document generated yet',
    },
    {
      key: 'approve',
      title: 'Approve',
      isDone: approved,
      subtitle: approved
        ? 'Approved — document fee accrued'
        : hasDraft
          ? 'Ready for your approval'
          : 'Approve once a document is generated',
    },
  ]
  let currentAssigned = false
  const core = coreDefs.map((d): MatterStep => {
    if (d.isDone) return { key: d.key, title: d.title, state: 'done', subtitle: d.subtitle }
    if (!currentAssigned) {
      currentAssigned = true
      return { key: d.key, title: d.title, state: 'current', subtitle: d.subtitle }
    }
    return { key: d.key, title: d.title, state: 'pending', subtitle: d.subtitle }
  })

  // After approval, "send to client" and "bill" are independently actionable.
  // "Send to client" has no persisted sent-flag, so it stays actionable (current)
  // once approved; "Bill" completes once this matter has an issued invoice.
  const client: MatterStep = {
    key: 'client',
    title: 'Send to client',
    state: approved ? 'current' : 'pending',
    subtitle: approved
      ? 'Email the approved document to the client'
      : 'Available once the document is approved',
  }
  const bill: MatterStep = {
    key: 'bill',
    title: 'Bill',
    state: hasInvoice ? 'done' : approved ? 'current' : 'pending',
    subtitle: hasInvoice
      ? 'Invoice issued'
      : approved
        ? 'Create & send the invoice from accrued fees'
        : 'Available once the document is approved',
  }
  return [...core, client, bill]
}

// Flatten the questionnaire payload into simple markdown so the intake step can be
// downloaded (PDF/Word) via the same client-side export the drafts use.
export function questionnaireToMarkdown(
  data: Record<string, unknown>,
  heading = 'Intake questionnaire',
): string {
  const lines: string[] = [`# ${heading}`, '']
  for (const [k, v] of Object.entries(data)) {
    const label = humanizeKey(k)
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      const rows = v as Array<Record<string, unknown>>
      const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
      lines.push(`## ${label}`, '')
      lines.push(`| ${cols.map(humanizeKey).join(' | ')} |`)
      lines.push(`| ${cols.map(() => '---').join(' | ')} |`)
      for (const row of rows) {
        lines.push(`| ${cols.map((c) => mdCell(row[c])).join(' | ')} |`)
      }
      lines.push('')
    } else {
      lines.push(`**${label}:** ${humanizeValue(v)}`, '')
    }
  }
  return lines.join('\n')
}

function mdCell(value: unknown): string {
  return humanizeValue(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function humanizeService(key: string): string {
  if (!key) return '—'
  if (key === 'llc_formation') return 'NC LLC formation'
  if (key === 'oa_amendment') return 'OA amendment'
  if (key === 'business_formation') return 'NC LLC formation'
  if (key === 'other') return 'Custom'
  return key.replace(/_/g, ' ')
}

export function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

export function statusBadgeClass(status: string): string {
  if (['consultation_scheduled', 'consultation_completed'].includes(status)) return 'badge info'
  if (['drafting', 'review_pending'].includes(status)) return 'badge warn'
  if (['engagement_signed', 'matter_active'].includes(status)) return 'badge ok'
  return 'badge'
}

function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function humanizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + 'T00:00:00').toLocaleDateString()
    }
    return value.replace(/_/g, ' ')
  }
  if (typeof value === 'number') return String(value)
  // Structured address fields store a StructuredAddress object; show the
  // human-readable line, not the raw JSON.
  if (typeof value === 'object' && value !== null && 'formatted_address' in value) {
    const formatted = (value as { formatted_address?: unknown }).formatted_address
    if (typeof formatted === 'string' && formatted.trim() !== '') return formatted
  }
  return JSON.stringify(value)
}

export function QuestionnaireView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  const tabular: Array<[string, Array<Record<string, unknown>>]> = []
  const simple: Array<[string, unknown]> = []
  for (const [k, v] of entries) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      tabular.push([k, v as Array<Record<string, unknown>>])
    } else {
      simple.push([k, v])
    }
  }

  return (
    <>
      {simple.length > 0 && (
        <div className="kv-grid">
          {simple.map(([k, v]) => (
            <div key={k}>
              <div className="kv-label">{humanizeKey(k)}</div>
              <div className="kv-value">{humanizeValue(v)}</div>
            </div>
          ))}
        </div>
      )}
      {tabular.map(([k, rows]) => (
        <div key={k} style={{ marginTop: 'var(--space-5)' }}>
          <h3>{humanizeKey(k)}</h3>
          <RepeaterTable rows={rows} />
        </div>
      ))}
    </>
  )
}

function RepeaterTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-muted">None.</p>
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{humanizeKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{humanizeValue(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TranscriptView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="transcript">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="transcript-spacer" />
        if (/^\[.*\]$/.test(trimmed)) {
          return (
            <div key={i} className="transcript-meta">
              {trimmed}
            </div>
          )
        }
        if (/^Summary:/i.test(trimmed)) {
          return (
            <div key={i} className="transcript-summary">
              <strong>Summary</strong>
              <span>{trimmed.slice('Summary:'.length).trim()}</span>
            </div>
          )
        }
        const m = trimmed.match(/^([A-Za-z][A-Za-z ()'.-]{0,40}):\s*(.*)$/)
        if (m) {
          const speaker = m[1]!
          const dialogue = m[2]!
          const isAttorney = /attorney|juan/i.test(speaker)
          return (
            <div key={i} className={`transcript-line ${isAttorney ? 'attorney' : 'client'}`}>
              <div className="transcript-speaker">{speaker}</div>
              <div className="transcript-text">{dialogue}</div>
            </div>
          )
        }
        return (
          <div key={i} className="transcript-continuation">
            {trimmed}
          </div>
        )
      })}
    </div>
  )
}
