'use client'

// Matter › OVERVIEW tab. The case at a glance + the workflow as a clickable step
// list: Intake → Consultation → Document. Each step opens a detail "window"
// (modal) to view/download what it produced (questionnaire, transcript, document)
// and to advance it (record the call, generate documents). Status, title,
// Actions menu and Back live in the layout header.
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp, McpToolError } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import {
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
  FileTextIcon,
  EditIcon,
} from '@/components/icons'
import { GemCluster } from '@/components/GemSparkle'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import { SendToClientModal, type SendToClientDoc } from '@/components/SendToClientModal'
import {
  humanizeService,
  humanizeStatus,
  QuestionnaireView,
  TranscriptView,
  deriveMatterSteps,
  questionnaireToMarkdown,
  workflowStepStates,
  type MatterDetail,
  type StepKey,
  type StepState,
  type WfStage,
  type WfEdge,
  type WfStepState,
  type MatterWorkflow,
} from './shared'
import { WorkflowEditor } from './WorkflowEditor'
import {
  RunnerReview,
  CapabilityStatePanel,
  ClientReviewStep,
  CompleteMatterStep,
} from './RunnerReview'
import { skipStep } from '@/lib/stepRunner'
import { US_STATE_OPTIONS } from '@/lib/usStates'
import { useConfirm } from '@/components/ConfirmModal'
import { NotesSection } from '@/components/NotesSection'

const GENERATABLE: Array<{ kind: string; label: string }> = [
  { kind: 'operating_agreement', label: 'operating agreement' },
  { kind: 'engagement_letter', label: 'engagement letter' },
]

export default function MatterOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [callTranscript, setCallTranscript] = useState('')
  const [openStep, setOpenStep] = useState<StepKey | null>(null)
  const [hasInvoice, setHasInvoice] = useState(false)
  // The matter header's "Close matter" action lands here with ?closeMatter=1 —
  // auto-opens the workflow's complete_matter stage window (WP-B). Read via
  // window.location (not useSearchParams) to match the app's established
  // no-Suspense-boundary convention for query-triggered opens (billing ?add=,
  // mail ?compose=).
  const [closeMatterRequested, setCloseMatterRequested] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('closeMatter') === '1') {
      setCloseMatterRequested(true)
    }
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(res.matter)
      // Whether this matter already has an issued invoice — drives the Bill step's
      // "done" state. Best-effort: a billing read must never block the overview.
      const inv = await callAttorneyMcp<{ items: unknown[] }>({
        toolName: 'legal.billing.matter_invoiced',
        input: { matterEntityId: id },
      }).catch(() => ({ items: [] as unknown[] }))
      setHasInvoice((inv.items ?? []).length > 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function action(label: string, toolName: string, input: Record<string, unknown>) {
    setBusy(label)
    setError(null)
    try {
      await callAttorneyMcp({ toolName, input })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Draft generation is async: legal.draft.generate enqueues a worker job and
  // returns immediately (the document_version appears only once the worker runs).
  // So enqueue ONCE, then poll the matter until the new draft lands (or give up) —
  // the step + modal reflect it without a manual refresh, and the attorney isn't
  // tempted to re-click and enqueue a duplicate job.
  async function generate(documentKind: string) {
    if (generating) return
    setError(null)
    setGenerating(documentKind)
    const startVersion = matter?.latestDraftVersionId ?? null
    try {
      await callAttorneyMcp({
        toolName: 'legal.draft.generate',
        input: { matterEntityId: id, documentKind },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGenerating(null)
      return
    }
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 3500))
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      }).catch(() => null)
      if (res?.matter) {
        setMatter(res.matter)
        if (res.matter.latestDraftVersionId && res.matter.latestDraftVersionId !== startVersion) {
          break
        }
      }
    }
    setGenerating(null)
  }

  function openStepAt(key: StepKey) {
    setError(null)
    setOpenStep(key)
  }
  function closeStep() {
    setError(null)
    setOpenStep(null)
  }

  if (!matter && !error) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading matter…
      </div>
    )
  }
  if (!matter) {
    return <div className="alert alert-error">{error}</div>
  }

  // B3.1 (product-walk trace, 2026-07-20): renamed from `hasQuestionnaire`. This is
  // whether the CLIENT has submitted intake ANSWERS on THIS matter — a different
  // fact from whether the SERVICE has a questionnaire SCHEMA configured (that
  // flag is also called `hasQuestionnaire` in serviceAuthoring.ts /
  // intakeTemplateTools.ts). The two are easy to conflate reading across
  // matter-scoped vs service-scoped surfaces — a live service can have a real
  // schema while a given matter's client just hasn't filled it in yet.
  const hasSubmittedIntake = matter.questionnaireResponses !== null
  const hasTranscript = matter.transcriptText !== null
  const canGenerate = hasSubmittedIntake && hasTranscript
  const steps = deriveMatterSteps(matter, { hasInvoice })

  return (
    <>
      <div className="li-mat-ov-col">
        <div className="li-mat-card li-mat-facts">
          <div>
            <div className="li-mat-facts-label">Client</div>
            {matter.clientEntityId ? (
              <Link href={`/attorney/crm/${matter.clientEntityId}`} className="li-mat-facts-link">
                {matter.clientName || 'View client'}
              </Link>
            ) : (
              <div className="li-mat-facts-value">{matter.clientName || '—'}</div>
            )}
          </div>
          <div>
            <div className="li-mat-facts-label">Practice area</div>
            <div className="li-mat-facts-value">{humanizeService(matter.practiceArea)}</div>
          </div>
          <div>
            <div className="li-mat-facts-label">Opened</div>
            <div className="li-mat-facts-value">
              {new Date(matter.createdAt).toLocaleDateString()}
            </div>
          </div>
          <GoverningLawFact matter={matter} onChanged={load} />
        </div>

        {matter.workflow ? (
          // ── Data-driven workflow window (ADR 0045 PR3) ──────────────────────
          // The matter is running an authored lifecycle: render the strip + window
          // straight from matter.workflow.graph. This branch is reached ONLY when a
          // workflow instance exists; the no-workflow path below is untouched.
          <WorkflowWindow
            matter={matter}
            workflow={matter.workflow}
            onChanged={load}
            initialOpenKey={
              closeMatterRequested
                ? (matter.workflow.graph.find((s) => s.action?.kind === 'complete_matter')?.key ??
                  null)
                : null
            }
          />
        ) : matter.workflowRepairAvailable ? (
          // ── MACHINE-COMMS-1: honest repair panel ─────────────────────────────
          // The matter has NO workflow instance but its service HAS an authored
          // lifecycle — never pretend with the legacy derived steps; say so and
          // offer to start the real workflow.
          <WorkflowRepairPanel matterEntityId={id} onStarted={load} />
        ) : (
          // ── Fallback: the existing derived-step window (#197), UNCHANGED ──────
          <section className="li-mat-card">
            <h2 className="li-mat-card-title">Workflow</h2>
            {/* The page-level error banner only shows when no modal is open; modals
                surface their own errors in-context (an action started in a modal). */}
            {error && openStep === null && <div className="alert alert-error">{error}</div>}
            <div className="step-list">
              {steps.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`step-row step-${s.state}`}
                  onClick={() => openStepAt(s.key)}
                >
                  <span className="step-ico" aria-hidden>
                    <StepIcon state={s.state} />
                  </span>
                  <span className="step-titles">
                    <span className="step-title">{s.title}</span>
                    <span className="step-subtitle">{s.subtitle}</span>
                  </span>
                  <span className="step-state-pill">{labelForState(s.state)}</span>
                  <span className="step-chevron" aria-hidden>
                    <ChevronRightIcon size={16} />
                  </span>
                </button>
              ))}
            </div>
            <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
              Click a step to view or download what it produced, or to advance it.
            </p>
          </section>
        )}

        {/* MACHINE-COMMS-1 — working notes on the matter (attorney + AI-extracted). */}
        <NotesSection targetEntityId={id} createInput={{ matterEntityId: id }} variant="card" />

        {/* MACHINE-COMMS-1 — ad-hoc client email: AI-drafted, lands in the review
            queue where approving it sends it. Not in the comp — a real capability
            the app is richer for; kept, restyled into the same card language. */}
        <section className="li-mat-card">
          <h2 className="li-mat-card-title">Communications</h2>
          <DraftEmailControl matterEntityId={id} />
        </section>
      </div>

      {!matter.workflow && openStep === 'intake' && (
        <Modal
          title="Intake — questionnaire"
          onClose={closeStep}
          footer={
            hasSubmittedIntake && matter.questionnaireResponses ? (
              <>
                <button
                  onClick={() =>
                    downloadAsWord(
                      questionnaireToMarkdown(matter.questionnaireResponses!),
                      `${matter.matterNumber}-intake`,
                    )
                  }
                >
                  Download Word
                </button>
                <button
                  className="primary"
                  onClick={() =>
                    downloadAsPdf(
                      questionnaireToMarkdown(matter.questionnaireResponses!),
                      `${matter.matterNumber}-intake`,
                    )
                  }
                >
                  Download PDF
                </button>
              </>
            ) : null
          }
        >
          {hasSubmittedIntake && matter.questionnaireResponses ? (
            <QuestionnaireView data={matter.questionnaireResponses} />
          ) : (
            <p className="text-muted">
              The client hasn’t submitted the intake questionnaire yet. Drafting unlocks once intake
              is complete.
            </p>
          )}
        </Modal>
      )}

      {!matter.workflow && openStep === 'consultation' && (
        <Modal title="Consultation" onClose={closeStep}>
          {error && <div className="alert alert-error">{error}</div>}
          {hasTranscript && matter.transcriptText ? (
            <>
              <TranscriptView text={matter.transcriptText} />
              <ExtractToNotesButton matterEntityId={id} />
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p className="text-muted text-sm">
                No transcript yet. Paste the consultation transcript (or attach a real Granola
                transcript) to record the call.
              </p>
              <textarea
                value={callTranscript}
                onChange={(e) => setCallTranscript(e.target.value)}
                placeholder="Paste the consultation transcript…"
                rows={6}
                disabled={!hasSubmittedIntake || busy !== null}
              />
              <button
                disabled={!hasSubmittedIntake || !callTranscript.trim() || busy !== null}
                onClick={async () => {
                  await action('record-call', 'legal.call.record_manual', {
                    matterEntityId: id,
                    transcriptText: callTranscript,
                  })
                  setCallTranscript('')
                }}
              >
                {busy === 'record-call' && <span className="spinner" />}
                {busy === 'record-call' ? 'Recording…' : 'Record consultation call'}
              </button>
              {!hasSubmittedIntake && (
                <p className="text-muted text-sm">
                  Recording unlocks once the client completes intake.
                </p>
              )}
            </div>
          )}
        </Modal>
      )}

      {!matter.workflow && openStep === 'document' && (
        <DocumentStep
          matter={matter}
          generating={generating}
          error={error}
          canGenerate={canGenerate}
          onGenerate={generate}
          onClose={closeStep}
        />
      )}

      {!matter.workflow && openStep === 'approve' && (
        <ApproveStep matter={matter} onClose={closeStep} onChanged={load} />
      )}

      {!matter.workflow && openStep === 'client' && (
        <ClientStep matter={matter} onClose={closeStep} />
      )}

      {!matter.workflow && openStep === 'bill' && (
        <BillStep matter={matter} onClose={closeStep} onChanged={load} />
      )}
    </>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircleIcon size={18} />
  if (state === 'current') return <ClockIcon size={18} />
  return <FileTextIcon size={18} />
}

// ── WP A1: governing-law fact + inline edit ─────────────────────────────────
// Shows the RESOLVED governing law (matter override > firm home jurisdiction >
// honest "Not set") with its source, and a small pencil affordance that swaps in
// a state <select> wired to legal.matter.set_governing_law. Choosing "Use firm
// default" clears the matter override so the firm rung takes over.
function GoverningLawFact({
  matter,
  onChanged,
}: {
  matter: MatterDetail
  onChanged: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const resolved = matter.governingLaw ?? null

  async function set(code: string) {
    setSaving(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.matter.set_governing_law',
        input: { matterEntityId: matter.matterEntityId, governingLaw: code },
      })
      await onChanged()
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="li-mat-facts-label">Governing law</div>
      {editing ? (
        <span className="li-mat-govlaw-edit">
          <select
            className="li-mat-govlaw-select"
            // The select's value is the MATTER'S OWN override (not the firm
            // fallback): '' here means "no override — use firm default".
            value={resolved?.source === 'matter' ? resolved.code : ''}
            disabled={saving}
            onChange={(e) => set(e.target.value)}
            aria-label="Governing law"
          >
            <option value="">Use firm default</option>
            {US_STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="li-mat-govlaw-btn"
            onClick={() => {
              setEditing(false)
              setErr(null)
            }}
            disabled={saving}
          >
            Cancel
          </button>
          {err && <span className="li-mat-govlaw-err">{err}</span>}
        </span>
      ) : (
        <div className="li-mat-facts-value li-mat-govlaw-value">
          {resolved ? resolved.displayName : 'Not set'}
          {resolved && (
            <span className="li-mat-govlaw-src">
              {resolved.source === 'matter' ? 'this matter' : 'firm default'}
            </span>
          )}
          <button
            type="button"
            className="li-mat-govlaw-btn"
            onClick={() => setEditing(true)}
            aria-label="Edit governing law"
          >
            <EditIcon size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── MACHINE-COMMS-1: honest workflow repair panel ───────────────────────────
// Shown when the matter has NO workflow instance but its service HAS an authored
// lifecycle (matter.workflowRepairAvailable). Instead of the legacy derived steps
// (which would pretend a workflow is running), say plainly that the workflow was
// never started and offer to start it — POST /workflow/start → startMatterWorkflow,
// then reload the matter so the real workflow window takes over.
function WorkflowRepairPanel({
  matterEntityId,
  onStarted,
}: {
  matterEntityId: string
  onStarted: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/attorney/matters/${matterEntityId}/workflow/start`, {
        method: 'POST',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to start the workflow.')
      await onStarted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Workflow</h2>
      <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: 'var(--space-3)' }}>
        <p style={{ marginTop: 0 }}>
          <strong>Workflow not started</strong>
        </p>
        <p className="text-muted text-sm">
          This matter was opened without its service&apos;s workflow instance, so there are no steps
          running yet. Start the workflow to pick up the service&apos;s authored steps from the
          beginning.
        </p>
        {err && <div className="alert alert-error">{err}</div>}
        <button
          className="primary"
          onClick={() => void start()}
          disabled={busy}
          style={{ marginTop: 'var(--space-2)' }}
        >
          {busy && <span className="spinner" />}
          {busy ? 'Starting…' : 'Start workflow'}
        </button>
      </div>
    </section>
  )
}

// ── MACHINE-COMMS-1: ad-hoc "Draft email" control ───────────────────────────
// Opens a small inline form; legal.email.draft only ENQUEUES (the model work runs
// on the worker), so the success state points at the review queue where approving
// the draft sends it.
function DraftEmailControl({ matterEntityId }: { matterEntityId: string }) {
  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)

  async function draft() {
    if (busy || !purpose.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.email.draft',
        input: { matterEntityId, purpose: purpose.trim() },
      })
      setQueued(true)
      setOpen(false)
      setPurpose('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-muted text-sm">
        Have the AI draft an email to the client from this matter&apos;s facts. Nothing reaches the
        client unapproved — the draft lands in the Review queue first.
      </p>
      {err && <div className="alert alert-error">{err}</div>}
      {queued && (
        <div className="alert alert-success">
          Email draft queued — it will appear in the Review queue; approving it sends it.
        </div>
      )}
      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={3}
            placeholder="What should this email say?"
            disabled={busy}
            autoFocus
          />
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <button
              className="primary"
              onClick={() => void draft()}
              disabled={busy || !purpose.trim()}
            >
              {busy && <span className="spinner" />}
              {busy ? 'Queuing…' : 'Draft email'}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                setErr(null)
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setQueued(false)
            setOpen(true)
          }}
        >
          Draft email
        </button>
      )}
    </div>
  )
}

// ── MACHINE-COMMS-1: "Extract to notes" (transcript → notes) ────────────────
// Rendered under the transcript. legal.transcript.extract only ENQUEUES; the
// distilled summary + facts land as notes on the matter when the worker finishes.
function ExtractToNotesButton({ matterEntityId }: { matterEntityId: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)

  async function extract() {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.transcript.extract',
        input: { matterEntityId },
      })
      setQueued(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (queued) {
    return (
      <div className="alert alert-success" style={{ marginTop: 'var(--space-3)' }}>
        Extraction queued — notes will appear on this matter.
      </div>
    )
  }
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      {err && <div className="alert alert-error">{err}</div>}
      <button
        onClick={() => void extract()}
        disabled={busy}
        title="Distill this transcript into notes on the matter — a summary plus extracted facts, for your review."
      >
        {busy && <span className="spinner" />}
        {busy ? 'Queuing…' : 'Extract to notes'}
      </button>
    </div>
  )
}

// ── P11: "Upload transcript" fallback ───────────────────────────────────────
// For a consultation step whose transcript never arrived on its own: a plain
// text-file picker (.txt/.md/.vtt) that records the call through the SAME door as
// the transcript-tab paste (legal.call.record_manual → call.ingest) — never
// document.upload, which is the matter-DOCUMENT lane. Capture (notes extraction)
// then fires off the arrival automatically, like any other transcript.
const MAX_TRANSCRIPT_UPLOAD_BYTES = 1_000_000

function UploadTranscriptControl({
  matterEntityId,
  onChanged,
}: {
  matterEntityId: string
  onChanged?: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file || busy) return
    setErr(null)
    if (file.size > MAX_TRANSCRIPT_UPLOAD_BYTES) {
      setErr('That file is too large — transcript uploads are capped at 1 MB of plain text.')
      return
    }
    setBusy(true)
    try {
      const text = (await file.text()).trim()
      if (!text) throw new Error('That file is empty — nothing to record.')
      await callAttorneyMcp({
        toolName: 'legal.call.record_manual',
        input: { matterEntityId, transcriptText: text },
      })
      await onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {err && <div className="alert alert-error">{err}</div>}
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.vtt,text/plain,text/markdown,text/vtt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          void handleFile(f)
        }}
      />
      <div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Recording…' : 'Upload transcript'}
        </button>
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
        Plain-text transcript files (.txt, .md, .vtt). Once recorded, the consultation is captured
        into notes on the matter automatically.
      </p>
    </div>
  )
}

function labelForState(state: StepState): string {
  if (state === 'done') return 'Done'
  if (state === 'current') return 'Current'
  return 'Pending'
}

// ── Data-driven workflow window (ADR 0045 PR3) ──────────────────────────────
// Renders the matter's RUNNING lifecycle straight from matter.workflow.graph: a
// step strip (done/current/upcoming via the client-side stepStates replica) and a
// per-step pop-up whose body is chosen by stage.action.kind. The pop-up reuses the
// exact same step bodies the legacy window uses (QuestionnaireView, TranscriptView,
// ApproveBody+ClientBody, BillStep) — nothing is rewritten. The current stage's
// pop-up carries a "Continue" affordance that fires legal.matter.advance through
// the manual (attorney/client) outgoing edge and reloads, so the window swaps to
// the next step in place. A stage whose only outgoing edge is system/automatic
// disables Continue and shows a waiting note (the engine advances on the event).
// A step's real performer role, derived from its own outgoing edges (the same
// attorney/client/system signal WorkflowStepWindow already uses to decide the
// advance control) — not fabricated per-row demo data. 'automatic' gets the
// GemSparkle affordance per the comp; the others get a tinted, numbered icon.
type StepRole = 'automatic' | 'attorney' | 'client' | 'system'
function stepRole(stage: WfStage): StepRole {
  const edges = stage.advances_to
  if (edges.some((e) => e.gate === 'client')) return 'client'
  if (edges.some((e) => e.gate === 'attorney')) return 'attorney'
  if (edges.some((e) => e.gate === 'automatic')) return 'automatic'
  return 'system'
}

function WorkflowWindow({
  matter,
  workflow,
  onChanged,
  initialOpenKey = null,
}: {
  matter: MatterDetail
  workflow: MatterWorkflow
  onChanged: () => Promise<void>
  // Deep-link support: the matter-header "Close matter" action opens straight to
  // the complete_matter stage's window (WP-B).
  initialOpenKey?: string | null
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpenKey)
  // PR6: the "Edit steps for this matter" mode (per-matter workflow customization).
  const [editing, setEditing] = useState(false)
  const steps = workflowStepStates(workflow.graph, workflow.currentState)
  const openEntry = openKey ? steps.find((s) => s.stage.key === openKey) : null

  return (
    <>
      <section className="li-mat-card">
        <div className="li-mat-card-head">
          <h2 className="li-mat-card-title">Workflow</h2>
          <button
            type="button"
            className="li-mat-pencil"
            onClick={() => setEditing(true)}
            title="Edit steps for this matter"
            aria-label="Edit steps for this matter"
          >
            <EditIcon size={16} />
          </button>
        </div>
        <div className="li-mat-wf-list">
          {steps.map(({ stage, state }, i) => {
            const role = stepRole(stage)
            return (
              <button
                key={stage.key}
                type="button"
                className="li-mat-wf-row"
                onClick={() => setOpenKey(stage.key)}
              >
                <span className={`li-mat-wf-ico li-mat-wf-ico-${role}`}>
                  {role === 'automatic' ? <GemCluster size={18} /> : i + 1}
                </span>
                <span className="li-mat-wf-name">{stage.label}</span>
                {state === 'done' ? (
                  <CheckCircleIcon size={18} className="li-mat-wf-check" />
                ) : state === 'current' ? (
                  <span className="li-mat-wf-status li-mat-wf-status-current">Current</span>
                ) : (
                  <span className="li-mat-wf-status li-mat-wf-status-upcoming">Upcoming</span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {openEntry && (
        <WorkflowStepWindow
          matter={matter}
          workflow={workflow}
          stage={openEntry.stage}
          state={openEntry.state}
          onClose={() => setOpenKey(null)}
          onChanged={onChanged}
        />
      )}

      {editing && (
        <WorkflowEditor
          matterEntityId={matter.matterEntityId}
          workflow={workflow}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </>
  )
}

// One step's pop-up — the in-place runner (WORKFLOW-RUNNER-1). The body is chosen
// by stage.action.kind and its state; document steps render the FULL review inside
// the modal (RunnerReview), capability steps render honest worker state, and the
// terminal step completes/archives — all without ever navigating away. The current
// stage carries the advance affordance: Continue on an attorney gate, Skip on a
// client gate, a waiting note on a system/automatic gate.
function WorkflowStepWindow({
  matter,
  stage,
  state,
  onClose,
  onChanged,
}: {
  matter: MatterDetail
  workflow: MatterWorkflow
  stage: WfStage
  state: WfStepState
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const isCurrent = state === 'current'
  // Human advance edges for the current stage (attorney → Continue, client → Skip).
  const attorneyEdge = isCurrent
    ? (stage.advances_to.find((e) => e.gate === 'attorney') ?? null)
    : null
  const clientEdge = isCurrent ? (stage.advances_to.find((e) => e.gate === 'client') ?? null) : null
  const systemEdge = isCurrent
    ? (stage.advances_to.find((e) => e.gate === 'system' || e.gate === 'automatic') ?? null)
    : null
  const waitsOnSystem = isCurrent && !attorneyEdge && !clientEdge && !!systemEdge

  // An attorney edge whose `via` names a DIFFERENT action (e.g. review_send_document's
  // draft.approve) is finished by that step's own embedded control (Approve/Reject),
  // never by a bare Continue — legal.matter.advance's GUARD 2 rejects it outright (the
  // M-MRJHEC8X defect this exists to prevent). Mirror that guard here so Continue is
  // never offered where it would just bounce off a 409.
  const attorneyEdgeHasOwnAction =
    !!attorneyEdge?.via && attorneyEdge.via !== 'legal.matter.advance'

  // The advance control appended to a step's footer: Continue (attorney gate, plain
  // advance only) or Skip (client gate — advance without the client). A step whose
  // attorney edge has its own completing action gets neither here — its embedded
  // surface is the completion path. A system-only gate has none.
  const advanceFooter =
    attorneyEdge && !attorneyEdgeHasOwnAction ? (
      <ContinueButton matter={matter} edge={attorneyEdge} onChanged={onChanged} onClose={onClose} />
    ) : clientEdge ? (
      <SkipButton matter={matter} stageKey={stage.key} onChanged={onChanged} onClose={onClose} />
    ) : null
  const waitsNote = waitsOnSystem ? <WaitingNote /> : null

  const kind = stage.action?.kind
  const isDocKind = kind === 'review_send_document' || kind === 'generate_document'
  const isProducingCapability = kind === 'invoke_capability' && (stage.documents?.length ?? 0) > 0

  // ── Document steps: the full review, in the pop-up (WP2 flagship) ───────────
  if (isDocKind || isProducingCapability) {
    return (
      <RunnerReview
        matter={matter}
        stage={stage}
        isCurrent={isCurrent}
        producing
        onChanged={onChanged}
        onClose={onClose}
        advanceFooter={advanceFooter}
        waitsNote={waitsNote}
      />
    )
  }

  // ── Complete + archive the matter (WP3) ─────────────────────────────────────
  if (kind === 'complete_matter') {
    return (
      <CompleteMatterStep
        stage={stage}
        matter={matter}
        onChanged={onChanged}
        onClose={onClose}
        advanceFooter={advanceFooter}
      />
    )
  }

  // ── approve_send_invoice: reuse the BillStep window verbatim ────────────────
  if (kind === 'approve_send_invoice') {
    return (
      <BillStep
        matter={matter}
        onClose={onClose}
        onChanged={onChanged}
        title={stage.label}
        extraFooter={advanceFooter}
      />
    )
  }

  // ── Client-gated wait (no attorney edge): the honest client-status panel ────
  // Checked BEFORE invoke_capability: a current client-gated capability stage
  // (e.g. request_client_materials → wait for the client) is WAITING ON THE
  // CLIENT, not "running on the worker" — the capability fired on entry and
  // finished; the spinner panel would spin forever on a client wait.
  if (isCurrent && clientEdge && !attorneyEdge) {
    return (
      <ClientReviewStep stage={stage} matter={matter} onChanged={onChanged} onClose={onClose} />
    )
  }

  // ── invoke_capability (non-producing): honest worker state ──────────────────
  if (kind === 'invoke_capability') {
    return (
      <CapabilityStatePanel
        stage={stage}
        matter={matter}
        state={state}
        onChanged={onChanged}
        onClose={onClose}
        advanceFooter={advanceFooter}
        waitsNote={waitsNote}
      />
    )
  }

  // ── All other kinds (view_intake / view_consultation / await_payment /
  //    manual_task): a Modal with the matching body + advance footer ───────────
  return (
    <Modal title={stage.label} onClose={onClose} footer={advanceFooter}>
      <WorkflowStepBody stage={stage} matter={matter} onChanged={onChanged} />
      {waitsNote}
    </Modal>
  )
}

// Continue: advance the matter along an attorney-gated edge, then close so the
// window swaps to the next step in place.
function ContinueButton({
  matter,
  edge,
  onChanged,
  onClose,
}: {
  matter: MatterDetail
  edge: WfEdge
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [advancing, setAdvancing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // A 409 from the advance-guard (this step has its own completing action, e.g.
  // a review step's Approve) is shown as styled in-modal guidance, never the raw
  // "Request failed (409): …" wall a real failure gets. Defense in depth — the
  // parent hides Continue entirely once an edge's `via` names its own action, so
  // this should be unreachable in normal use; it still guards a stale-graph race.
  const [guardMessage, setGuardMessage] = useState<string | null>(null)
  async function advance() {
    setAdvancing(true)
    setErr(null)
    setGuardMessage(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.matter.advance',
        input: {
          matterEntityId: matter.matterEntityId,
          toState: edge.to,
          gate: edge.gate,
          trigger: 'continue',
        },
      })
      await onChanged()
      onClose()
    } catch (e) {
      if (e instanceof McpToolError && e.status === 409) {
        setGuardMessage(e.detail || e.message)
      } else {
        setErr(e instanceof Error ? e.message : String(e))
      }
      setAdvancing(false)
    }
  }
  return (
    <>
      {guardMessage ? (
        <div className="alert alert-warn li-modal-foot-guard">{guardMessage}</div>
      ) : (
        err && <span className="li-modal-foot-error">{err}</span>
      )}
      <button className="primary" onClick={() => void advance()} disabled={advancing}>
        {advancing && <span className="spinner" />}
        {advancing ? 'Advancing…' : 'Continue'}
      </button>
    </>
  )
}

// Skip: attorney advances a client-gated step without the client's acceptance
// (Contract W skip — records the override in the matter history).
function SkipButton({
  matter,
  stageKey,
  onChanged,
  onClose,
}: {
  matter: MatterDetail
  stageKey: string
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { confirm, confirmElement } = useConfirm()
  async function skip() {
    const ok = await confirm({
      title: 'Skip this client step?',
      body: 'Advances the matter without the client’s acceptance — the skip is recorded in the matter history as an attorney override.',
      confirmLabel: 'Skip step',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setErr(null)
    try {
      await skipStep(matter.matterEntityId, stageKey)
      await onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <>
      {confirmElement}
      {err && (
        <span className="text-sm" style={{ color: 'var(--danger)', marginRight: 'auto' }}>
          {err}
        </span>
      )}
      <button className="warn" onClick={() => void skip()} disabled={busy}>
        {busy && <span className="spinner" />}
        {busy ? 'Skipping…' : 'Skip this step'}
      </button>
    </>
  )
}

function WaitingNote() {
  return (
    <p className="text-muted text-sm" style={{ marginTop: 'var(--space-4)' }}>
      This step advances automatically when its event arrives (e.g. the invoice is paid). There’s
      nothing to do here by hand.
    </p>
  )
}

// Body for the simple step-action kinds, reusing the existing view components.
function WorkflowStepBody({
  stage,
  matter,
  onChanged,
}: {
  stage: WfStage
  matter: MatterDetail
  onChanged?: () => Promise<void>
}) {
  const kind = stage.action?.kind
  if (kind === 'view_intake') {
    return matter.questionnaireResponses ? (
      <QuestionnaireView data={matter.questionnaireResponses} />
    ) : (
      <p className="text-muted text-sm">
        The client hasn’t submitted the intake questionnaire yet.
      </p>
    )
  }
  if (kind === 'view_consultation') {
    return matter.transcriptText ? (
      <>
        <TranscriptView text={matter.transcriptText} />
        <ExtractToNotesButton matterEntityId={matter.matterEntityId} />
      </>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p className="text-muted text-sm">
          No consultation transcript on this matter yet. It arrives on its own from a recorded
          meeting — or upload the transcript file here.
        </p>
        <UploadTranscriptControl matterEntityId={matter.matterEntityId} onChanged={onChanged} />
      </div>
    )
  }
  if (kind === 'await_payment') {
    return (
      <p className="text-sm">
        Waiting for the client’s payment. Once the invoice is marked paid, the matter moves on
        automatically.
      </p>
    )
  }
  // manual_task and any unmapped kind: a plain status panel.
  return (
    <p className="text-sm">
      {stage.client_label ?? stage.label}
      {stage.documents && stage.documents.length > 0 && (
        <>
          {' — '}
          {stage.documents
            .map((d) => d.label ?? d.docKind)
            .filter(Boolean)
            .join(', ')}
        </>
      )}
    </p>
  )
}

interface DraftPayload {
  documentKind: string
  versionNumber: number
  status: string
  bodyMarkdown: string
}

// Document step detail. Lazily loads the latest draft (legal.draft.get, exactly as
// the Documents tab does) for view/download; the generate actions stay available
// either way, so a second document kind is still reachable once a first one exists.
function DocumentStep({
  matter,
  generating,
  error,
  canGenerate,
  onGenerate,
  onClose,
  extraFooter,
}: {
  matter: MatterDetail
  generating: string | null
  error: string | null
  canGenerate: boolean
  onGenerate: (documentKind: string) => void
  onClose: () => void
  // Optional advance affordance the data-driven workflow window appends to the
  // Modal footer; the legacy path omits it (its own derived strip drives advance).
  extraFooter?: React.ReactNode
}) {
  const versionId = matter.latestDraftVersionId
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!versionId) {
      setDraft(null)
      return
    }
    let cancelled = false
    setLoading(true)
    callAttorneyMcp<{ draft: DraftPayload | null }>({
      toolName: 'legal.draft.get',
      input: { documentVersionId: versionId },
    })
      .then((r) => {
        if (!cancelled) setDraft(r.draft)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [versionId])

  const fileBase = draft ? `${matter.matterNumber}-${draft.documentKind}` : matter.matterNumber

  const footer =
    versionId && draft ? (
      <>
        <button
          onClick={() => downloadAsWord(draft.bodyMarkdown, fileBase, { status: draft.status })}
        >
          Download Word
        </button>
        <button
          className="primary"
          onClick={() => downloadAsPdf(draft.bodyMarkdown, fileBase, { status: draft.status })}
        >
          Download PDF
        </button>
      </>
    ) : null

  return (
    <Modal
      title="Document"
      onClose={onClose}
      footer={
        footer || extraFooter ? (
          <>
            {footer}
            {extraFooter}
          </>
        ) : null
      }
    >
      {error && <div className="alert alert-error">{error}</div>}

      {versionId ? (
        loading || !draft ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Loading document…
          </p>
        ) : (
          <div className="kv-grid">
            <div>
              <div className="kv-label">Latest document</div>
              <div className="kv-value">{humanizeService(draft.documentKind)}</div>
            </div>
            <div>
              <div className="kv-label">Version</div>
              <div className="kv-value">v{draft.versionNumber}</div>
            </div>
            <div>
              <div className="kv-label">Status</div>
              <div className="kv-value">{humanizeStatus(draft.status)}</div>
            </div>
          </div>
        )
      ) : (
        <p className="text-muted text-sm">No document generated yet.</p>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="kv-label" style={{ marginBottom: 'var(--space-2)' }}>
          {versionId ? 'Generate another document' : 'Generate a document'}
        </div>
        {generating ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Queued — generating {humanizeService(generating)}… it’ll
            appear here and under the Documents tab when ready.
          </p>
        ) : (
          <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {GENERATABLE.map((g) => (
              <button
                key={g.kind}
                className={g.kind === 'operating_agreement' ? 'primary' : ''}
                disabled={!canGenerate}
                onClick={() => onGenerate(g.kind)}
              >
                Generate {g.label}
              </button>
            ))}
          </div>
        )}
        {!canGenerate && !generating && (
          <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
            Drafting unlocks once intake is submitted and the consultation is recorded.
          </p>
        )}
      </div>
    </Modal>
  )
}

function money(amount: string | null, currency: string): string {
  if (amount == null) return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
}

// ── Approve step ────────────────────────────────────────────────────────────
// Approve the latest draft from the workflow window — the same legal.draft.approve
// the full review page calls. Approval flips the matter to approved AND
// auto-accrues the document fee (handlers/draft.ts), so the Bill step then has
// something to invoice.
function ApproveStep({
  matter,
  onClose,
  onChanged,
  extraFooter,
}: {
  matter: MatterDetail
  onClose: () => void
  onChanged: () => Promise<void>
  extraFooter?: React.ReactNode
}) {
  const versionId = matter.latestDraftVersionId
  return (
    <Modal title="Approve" onClose={onClose}>
      <ApproveBody matter={matter} onChanged={onChanged} onClose={onClose} />
      {versionId && extraFooter && (
        <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          {extraFooter}
        </div>
      )}
    </Modal>
  )
}

// The Approve step's body + its approve action, with NO Modal wrapper, so the
// legacy ApproveStep and the data-driven review_send_document window render the
// same review/approve UI. The Approve button lives in the body (not a Modal
// footer) so the body composes cleanly inside any container.
function ApproveBody({
  matter,
  onChanged,
  onClose,
}: {
  matter: MatterDetail
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const versionId = matter.latestDraftVersionId
  const approved = matter.latestDraftStatus === 'approved'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function approve() {
    if (!versionId) return
    setBusy(true)
    setErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.draft.approve',
        input: { documentVersionId: versionId },
      })
      await onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      {err && <div className="alert alert-error">{err}</div>}
      {!versionId ? (
        <p className="text-muted text-sm">
          No document to approve yet — generate one in the Document step first.
        </p>
      ) : approved ? (
        <p className="text-sm">
          This document is <strong>approved</strong>. The document fee (if the service sets one) is
          accrued and ready to bill in the <strong>Bill</strong> step.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Approving marks the latest draft as the firm-approved version, flips the matter to{' '}
            <strong>approved</strong>, and automatically accrues the document fee. Review it in full
            first if you like.
          </p>
          <button
            className="primary"
            onClick={() => void approve()}
            disabled={busy}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {busy && <span className="spinner" />}
            {busy ? 'Approving…' : 'Approve document'}
          </button>
        </>
      )}
    </>
  )
}

// ── Send-to-client step ─────────────────────────────────────────────────────
// Email the approved document to the client as a secure shared link (the same
// legal.email.send_draft_link the Documents tab uses), gated on approval.
function ClientStep({
  matter,
  onClose,
  extraFooter,
}: {
  matter: MatterDetail
  onClose: () => void
  extraFooter?: React.ReactNode
}) {
  return (
    <Modal title="Send to client" onClose={onClose} footer={extraFooter ?? null}>
      <ClientBody matter={matter} />
    </Modal>
  )
}

// The Send-to-client body + its send action, NO Modal wrapper, so the legacy
// ClientStep and the data-driven review_send_document window share one UI.
// The send itself happens in the unified SendToClientModal (founder comp) —
// this body just gates on approval and opens it on the latest draft.
function ClientBody({ matter }: { matter: MatterDetail }) {
  const versionId = matter.latestDraftVersionId
  const approved = matter.latestDraftStatus === 'approved'
  const [opening, setOpening] = useState(false)
  const [sendDoc, setSendDoc] = useState<SendToClientDoc | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // MatterDetail carries only the latest version id + status; the modal's
  // attachment card needs the kind + version number too — fetch on open.
  async function openSendModal() {
    if (!versionId || opening) return
    setOpening(true)
    setStatus(null)
    try {
      const res = await callAttorneyMcp<{
        draft: {
          documentVersionId: string
          documentKind: string
          versionNumber: number
          status: string
        } | null
      }>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: versionId },
      })
      if (!res.draft) throw new Error('Draft not found.')
      setSendDoc({
        documentVersionId: res.draft.documentVersionId,
        documentKind: res.draft.documentKind,
        versionNumber: res.draft.versionNumber,
        status: res.draft.status,
      })
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      {sendDoc && (
        <SendToClientModal
          matter={{
            entityId: matter.matterEntityId,
            matterNumber: matter.matterNumber,
            clientName: matter.clientName,
            clientEmail: matter.clientEmail,
          }}
          doc={sendDoc}
          onClose={() => setSendDoc(null)}
          onSent={(msg) => setStatus({ kind: 'ok', msg })}
        />
      )}
      {status && (
        <div className={`alert ${status.kind === 'ok' ? 'alert-success' : 'alert-error'}`}>
          {status.msg}
        </div>
      )}
      {!approved ? (
        <p className="text-muted text-sm">
          Approve the document first — then you can email the approved version to the client.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Emails the client a secure link to the approved document
            {matter.clientEmail ? (
              <>
                {' '}
                at <strong>{matter.clientEmail}</strong>
              </>
            ) : (
              ' (no client email on file — enter one in the send window)'
            )}
            .
          </p>
          <button
            className="primary"
            onClick={() => void openSendModal()}
            disabled={opening}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {opening && <span className="spinner" />}
            {opening ? 'Opening…' : 'Email document to client'}
          </button>
        </>
      )}
    </>
  )
}

// ── Bill step ───────────────────────────────────────────────────────────────
// Create the invoice from this matter's accrued/unbilled entries and send it with
// a Pay-now link — without leaving the matter. Reuses legal.billing.unbilled
// (filtered to the matter), legal.service.complete (accrue the flat fee),
// legal.invoice.issue, and legal.invoice.send.
interface BillEntry {
  sourceEventId: string
  kind: 'time' | 'expense' | 'service_fee' | 'document_fee'
  description: string
  amount: string | null
}
interface BillInvoice {
  invoiceEntityId: string
  invoiceNumber: string
  invoiceStatus: string
  amount: string
}

function BillStep({
  matter,
  onClose,
  onChanged,
  title = 'Bill',
  extraFooter,
}: {
  matter: MatterDetail
  onClose: () => void
  onChanged: () => Promise<void>
  title?: string
  extraFooter?: React.ReactNode
}) {
  const id = matter.matterEntityId
  const [entries, setEntries] = useState<BillEntry[]>([])
  const [unbilledTotal, setUnbilledTotal] = useState('0.00')
  const [invoices, setInvoices] = useState<BillInvoice[]>([])
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [u, inv] = await Promise.all([
        callAttorneyMcp<{
          clients: { matters: { matterEntityId: string; entries: BillEntry[]; total: string }[] }[]
          currency: string
        }>({ toolName: 'legal.billing.unbilled' }),
        callAttorneyMcp<{
          items: {
            invoiceEntityId: string
            invoiceNumber: string
            invoiceStatus: string
            amount: string
          }[]
          currency: string
        }>({ toolName: 'legal.billing.matter_invoiced', input: { matterEntityId: id } }),
      ])
      setCurrency(u.currency || inv.currency || 'USD')
      let mine: { entries: BillEntry[]; total: string } | null = null
      for (const c of u.clients ?? [])
        for (const m of c.matters ?? []) if (m.matterEntityId === id) mine = m
      setEntries(mine?.entries ?? [])
      setUnbilledTotal(mine?.total ?? '0.00')
      // Collapse invoiced line items to distinct invoices, summing line amounts.
      const byInvoice = new Map<string, BillInvoice>()
      for (const it of inv.items ?? []) {
        const prev = byInvoice.get(it.invoiceEntityId)
        const sum = (prev ? Number(prev.amount) : 0) + (Number(it.amount) || 0)
        byInvoice.set(it.invoiceEntityId, {
          invoiceEntityId: it.invoiceEntityId,
          invoiceNumber: it.invoiceNumber,
          invoiceStatus: it.invoiceStatus,
          amount: sum.toFixed(2),
        })
      }
      setInvoices([...byInvoice.values()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function markComplete() {
    setBusy('complete')
    setErr(null)
    setNotice(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.service.complete', input: { matterEntityId: id } })
      setNotice('Service marked complete — its flat fee (if any) is now accrued below.')
      await load()
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function createInvoice() {
    if (!matter.clientEntityId) {
      setErr('This matter has no linked client, so an invoice can’t be addressed.')
      return
    }
    setBusy('create')
    setErr(null)
    setNotice(null)
    try {
      const r = await callAttorneyMcp<{ invoiceNumber?: string }>({
        toolName: 'legal.invoice.issue',
        input: {
          clientEntityId: matter.clientEntityId,
          matterEntityId: id,
          lines: entries.map((e) => ({ sourceEventId: e.sourceEventId, kind: e.kind })),
        },
      })
      setNotice(`Invoice ${r.invoiceNumber ?? ''} created — send it below.`)
      await load()
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function sendInvoice(invoiceEntityId: string, number: string) {
    setBusy(`send:${invoiceEntityId}`)
    setErr(null)
    setNotice(null)
    try {
      const r = await callAttorneyMcp<{ to?: string }>({
        toolName: 'legal.invoice.send',
        input: {
          invoiceEntityId,
          payUrlBase: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })
      setNotice(`Invoice ${number} sent${r.to ? ` to ${r.to}` : ''}.`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={title} onClose={onClose} footer={extraFooter ?? null}>
      {err && <div className="alert alert-error">{err}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {loading ? (
        <p className="text-muted text-sm">
          <span className="spinner" /> Loading billing…
        </p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <span className="kv-label">Accrued, not yet invoiced</span>
            <button onClick={() => void markComplete()} disabled={busy === 'complete'}>
              {busy === 'complete' ? 'Working…' : 'Mark service complete'}
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="text-muted text-sm" style={{ marginTop: 'var(--space-2)' }}>
              Nothing accrued yet. Approving the document accrues its fee; “Mark service complete”
              accrues the flat fee; or log time on the Billing tab.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.sourceEventId}>
                      <td>{e.kind.replace(/_/g, ' ')}</td>
                      <td>{e.description || '—'}</td>
                      <td>{money(e.amount, currency)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>
                      Total
                    </td>
                    <td style={{ fontWeight: 600 }}>{money(unbilledTotal, currency)}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <button
                  className="primary"
                  onClick={() => void createInvoice()}
                  disabled={busy === 'create'}
                >
                  {busy === 'create' && <span className="spinner" />}
                  {busy === 'create'
                    ? 'Creating…'
                    : `Create invoice (${money(unbilledTotal, currency)})`}
                </button>
              </div>
            </div>
          )}

          {invoices.length > 0 && (
            <div style={{ marginTop: 'var(--space-5)' }}>
              <span className="kv-label">Invoices</span>
              <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.invoiceEntityId}>
                        <td>{inv.invoiceNumber}</td>
                        <td>{money(inv.amount, currency)}</td>
                        <td>
                          <span
                            className={`badge ${
                              inv.invoiceStatus === 'sent' || inv.invoiceStatus === 'paid'
                                ? 'ok'
                                : 'info'
                            }`}
                          >
                            {inv.invoiceStatus}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {inv.invoiceStatus === 'issued' && (
                            <button
                              onClick={() =>
                                void sendInvoice(inv.invoiceEntityId, inv.invoiceNumber)
                              }
                              disabled={busy === `send:${inv.invoiceEntityId}`}
                            >
                              {busy === `send:${inv.invoiceEntityId}` ? 'Sending…' : 'Send invoice'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
