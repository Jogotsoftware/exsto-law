'use client'

// Matter › OVERVIEW tab. The case at a glance + the workflow as a clickable step
// list: Intake → Consultation → Document. Each step opens a detail "window"
// (modal) to view/download what it produced (questionnaire, transcript, document)
// and to advance it (record the call, generate documents). Status, title,
// Actions menu and Back live in the layout header.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import {
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
  FileTextIcon,
  EditIcon,
} from '@/components/icons'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
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
  type WfStepState,
  type MatterWorkflow,
} from './shared'
import { MatterTasks } from './MatterTasks'
import { WorkflowEditor } from './WorkflowEditor'

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
      <div className="loading-block">
        <span className="spinner" /> Loading matter…
      </div>
    )
  }
  if (!matter) {
    return <div className="alert alert-error">{error}</div>
  }

  const hasQuestionnaire = matter.questionnaireResponses !== null
  const hasTranscript = matter.transcriptText !== null
  const canGenerate = hasQuestionnaire && hasTranscript
  const steps = deriveMatterSteps(matter, { hasInvoice })

  return (
    <>
      <section>
        <h2>Overview</h2>
        <div className="kv-grid">
          <div>
            <div className="kv-label">Client</div>
            <div className="kv-value">
              {matter.clientEntityId ? (
                <Link href={`/attorney/crm/${matter.clientEntityId}`}>
                  {matter.clientName || 'View client'}
                </Link>
              ) : (
                matter.clientName || '—'
              )}
            </div>
          </div>
          <div>
            <div className="kv-label">Practice area</div>
            <div className="kv-value">{humanizeService(matter.practiceArea)}</div>
          </div>
          <div>
            <div className="kv-label">Opened</div>
            <div className="kv-value">{new Date(matter.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </section>

      {matter.workflow ? (
        // ── Data-driven workflow window (ADR 0045 PR3) ──────────────────────
        // The matter is running an authored lifecycle: render the strip + window
        // straight from matter.workflow.graph. This branch is reached ONLY when a
        // workflow instance exists; the no-workflow path below is untouched.
        <WorkflowWindow matter={matter} workflow={matter.workflow} onChanged={load} />
      ) : (
        // ── Fallback: the existing derived-step window (#197), UNCHANGED ──────
        <section>
          <h2>Workflow</h2>
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

      <MatterTasks matterEntityId={id} />

      {!matter.workflow && openStep === 'intake' && (
        <Modal
          title="Intake — questionnaire"
          onClose={closeStep}
          footer={
            hasQuestionnaire && matter.questionnaireResponses ? (
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
          {hasQuestionnaire && matter.questionnaireResponses ? (
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
            <TranscriptView text={matter.transcriptText} />
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
                disabled={!hasQuestionnaire || busy !== null}
              />
              <button
                disabled={!hasQuestionnaire || !callTranscript.trim() || busy !== null}
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
              {!hasQuestionnaire && (
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
function workflowStripState(state: WfStepState): StepState {
  return state === 'upcoming' ? 'pending' : state
}

function WorkflowWindow({
  matter,
  workflow,
  onChanged,
}: {
  matter: MatterDetail
  workflow: MatterWorkflow
  onChanged: () => Promise<void>
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  // PR6: the "Edit steps for this matter" mode (per-matter workflow customization).
  const [editing, setEditing] = useState(false)
  const steps = workflowStepStates(workflow.graph, workflow.currentState)
  const openEntry = openKey ? steps.find((s) => s.stage.key === openKey) : null

  return (
    <>
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <h2>Workflow</h2>
          <button type="button" className="button" onClick={() => setEditing(true)}>
            <EditIcon size={16} /> Edit steps for this matter
          </button>
        </div>
        <div className="step-list">
          {steps.map(({ stage, state }) => {
            const stripState = workflowStripState(state)
            return (
              <button
                key={stage.key}
                type="button"
                className={`step-row step-${stripState}`}
                onClick={() => setOpenKey(stage.key)}
              >
                <span className="step-ico" aria-hidden>
                  <StepIcon state={stripState} />
                </span>
                <span className="step-titles">
                  <span className="step-title">{stage.label}</span>
                  <span className="step-subtitle">{stage.client_label ?? stage.label}</span>
                </span>
                <span className="step-state-pill">{labelForState(stripState)}</span>
                <span className="step-chevron" aria-hidden>
                  <ChevronRightIcon size={16} />
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-muted text-sm" style={{ marginTop: 'var(--space-3)' }}>
          Click a step to view what it produced, or to advance the matter.
        </p>
      </section>

      {openEntry && (
        <WorkflowStepWindow
          matter={matter}
          workflow={workflow}
          stage={openEntry.stage}
          isCurrent={openEntry.state === 'current'}
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

// One step's pop-up. The body is dispatched by stage.action.kind onto the reused
// step bodies; the current stage additionally gets the Continue advance affordance.
function WorkflowStepWindow({
  matter,
  stage,
  isCurrent,
  onClose,
  onChanged,
}: {
  matter: MatterDetail
  workflow: MatterWorkflow
  stage: WfStage
  isCurrent: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [advancing, setAdvancing] = useState(false)
  const [advanceErr, setAdvanceErr] = useState<string | null>(null)

  // The manual (attorney/client) outgoing edge is the one a human "Continue" fires.
  const manualEdge = isCurrent
    ? (stage.advances_to.find((e) => e.gate === 'attorney' || e.gate === 'client') ?? null)
    : null
  // A current stage with ONLY a system/automatic outgoing edge waits on its event.
  const waitsOnSystem =
    isCurrent &&
    !manualEdge &&
    stage.advances_to.some((e) => e.gate === 'system' || e.gate === 'automatic')

  async function advance() {
    if (!manualEdge) return
    setAdvancing(true)
    setAdvanceErr(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.matter.advance',
        input: {
          matterEntityId: matter.matterEntityId,
          toState: manualEdge.to,
          gate: manualEdge.gate,
          trigger: 'continue',
        },
      })
      await onChanged()
      onClose()
    } catch (e) {
      setAdvanceErr(e instanceof Error ? e.message : String(e))
      setAdvancing(false)
    }
  }

  const continueButton = manualEdge ? (
    <button className="primary" onClick={() => void advance()} disabled={advancing}>
      {advancing && <span className="spinner" />}
      {advancing ? 'Advancing…' : 'Continue'}
    </button>
  ) : null

  // ── review_send_document: reuse ApproveBody + ClientBody in one window ──────
  if (stage.action?.kind === 'review_send_document') {
    return (
      <Modal
        title={stage.label}
        onClose={onClose}
        footer={
          <>
            {matter.latestDraftVersionId && (
              <Link href={`/attorney/review/${matter.latestDraftVersionId}`} className="button">
                Open full review
              </Link>
            )}
            {continueButton}
          </>
        }
      >
        {advanceErr && <div className="alert alert-error">{advanceErr}</div>}
        <ApproveBody matter={matter} onChanged={onChanged} onClose={onClose} />
        <div
          style={{
            marginTop: 'var(--space-5)',
            borderTop: '1px solid var(--border)',
            paddingTop: 'var(--space-4)',
          }}
        >
          <ClientBody matter={matter} />
        </div>
        {waitsOnSystem && <WaitingNote />}
      </Modal>
    )
  }

  // ── approve_send_invoice: reuse the BillStep window verbatim ────────────────
  if (stage.action?.kind === 'approve_send_invoice') {
    return (
      <BillStep
        matter={matter}
        onClose={onClose}
        onChanged={onChanged}
        title={stage.label}
        extraFooter={
          <>
            {advanceErr && (
              <span className="text-sm" style={{ color: 'var(--danger)' }}>
                {advanceErr}
              </span>
            )}
            {continueButton}
          </>
        }
      />
    )
  }

  // ── All other kinds: a Modal with the matching body + Continue footer ───────
  return (
    <Modal title={stage.label} onClose={onClose} footer={continueButton}>
      {advanceErr && <div className="alert alert-error">{advanceErr}</div>}
      <WorkflowStepBody stage={stage} matter={matter} />
      {waitsOnSystem && <WaitingNote />}
    </Modal>
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
function WorkflowStepBody({ stage, matter }: { stage: WfStage; matter: MatterDetail }) {
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
      <TranscriptView text={matter.transcriptText} />
    ) : (
      <p className="text-muted text-sm">No consultation transcript on this matter yet.</p>
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
  if (kind === 'complete_matter') {
    return (
      <p className="text-sm">
        This matter is <strong>complete</strong>. Every step in the workflow has run.
      </p>
    )
  }
  if (kind === 'generate_document') {
    return (
      <p className="text-sm">
        Generate this step’s document from the <strong>Documents</strong> tab; it will appear here
        once drafted.
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
        <Link href={`/attorney/review/${versionId}`} className="button">
          Open full review
        </Link>
        <button onClick={() => downloadAsWord(draft.bodyMarkdown, fileBase)}>Download Word</button>
        <button className="primary" onClick={() => downloadAsPdf(draft.bodyMarkdown, fileBase)}>
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
      {versionId && (
        <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Link href={`/attorney/review/${versionId}`} className="button">
            Open full review
          </Link>
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
function ClientBody({ matter }: { matter: MatterDetail }) {
  const versionId = matter.latestDraftVersionId
  const approved = matter.latestDraftStatus === 'approved'
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function send() {
    if (!versionId) return
    const defaultTo = matter.clientEmail ?? ''
    const to =
      defaultTo ||
      (typeof window !== 'undefined'
        ? (window.prompt('No client email on file. Send to which email?', '') ?? '').trim()
        : '')
    if (!to) {
      setStatus({
        kind: 'err',
        msg: 'No recipient — add a client email or enter one when prompted.',
      })
      return
    }
    if (typeof window !== 'undefined' && !window.confirm(`Email the document to ${to}?`)) return
    setBusy(true)
    setStatus(null)
    try {
      const r = await callAttorneyMcp<{ to?: string }>({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: matter.matterEntityId,
          documentVersionId: versionId,
          shareUrl: shareUrlFor(versionId),
          to,
        },
      })
      setStatus({ kind: 'ok', msg: `Sent to ${r.to ?? to}.` })
    } catch (e) {
      setStatus({ kind: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
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
              ' (no client email on file — you’ll be prompted)'
            )}
            .
          </p>
          <button
            className="primary"
            onClick={() => void send()}
            disabled={busy}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {busy && <span className="spinner" />}
            {busy ? 'Sending…' : 'Email document to client'}
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
