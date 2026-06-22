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
import { CheckCircleIcon, ClockIcon, ChevronRightIcon, FileTextIcon } from '@/components/icons'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import {
  humanizeService,
  humanizeStatus,
  QuestionnaireView,
  TranscriptView,
  deriveMatterSteps,
  questionnaireToMarkdown,
  type MatterDetail,
  type StepKey,
  type StepState,
} from './shared'
import { MatterTasks } from './MatterTasks'

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

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(res.matter)
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
  const steps = deriveMatterSteps(matter)

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

      <MatterTasks matterEntityId={id} />

      {openStep === 'intake' && (
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

      {openStep === 'consultation' && (
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

      {openStep === 'document' && (
        <DocumentStep
          matter={matter}
          generating={generating}
          error={error}
          canGenerate={canGenerate}
          onGenerate={generate}
          onClose={closeStep}
        />
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
}: {
  matter: MatterDetail
  generating: string | null
  error: string | null
  canGenerate: boolean
  onGenerate: (documentKind: string) => void
  onClose: () => void
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
    <Modal title="Document" onClose={onClose} footer={footer}>
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
