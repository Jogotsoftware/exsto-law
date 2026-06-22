'use client'

// Matter › OVERVIEW tab. The case at a glance + the workflow as a clickable step
// list: Intake → Consultation → Document. Each step opens a detail "window"
// (modal) to view/download what it produced (questionnaire, transcript, document)
// and to advance it (record the call, generate the document). Status, title,
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

export default function MatterOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
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
        {error && <div className="alert alert-error">{error}</div>}
        <div className="step-list">
          {steps.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`step-row step-${s.state}`}
              onClick={() => setOpenStep(s.key)}
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

      {openStep === 'intake' && (
        <Modal
          title="Intake — questionnaire"
          onClose={() => setOpenStep(null)}
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
        <Modal title="Consultation" onClose={() => setOpenStep(null)}>
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
          busy={busy}
          canGenerate={hasQuestionnaire && hasTranscript}
          onGenerate={(documentKind) =>
            action(`generate-${documentKind}`, 'legal.draft.generate', {
              matterEntityId: id,
              documentKind,
            })
          }
          onClose={() => setOpenStep(null)}
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
// the Documents tab does) for view/download; if there's no draft yet, surfaces the
// generate actions inline.
function DocumentStep({
  matter,
  busy,
  canGenerate,
  onGenerate,
  onClose,
}: {
  matter: MatterDetail
  busy: string | null
  canGenerate: boolean
  onGenerate: (documentKind: string) => void
  onClose: () => void
}) {
  const versionId = matter.latestDraftVersionId
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!versionId) return
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
      {versionId ? (
        loading || !draft ? (
          <p className="text-muted text-sm">
            <span className="spinner" /> Loading document…
          </p>
        ) : (
          <div className="kv-grid">
            <div>
              <div className="kv-label">Document</div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p className="text-muted text-sm">
            No document generated yet. Generate one from the captured intake + consultation; it will
            appear here and under the <strong>Documents</strong> tab when ready.
          </p>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <button
              className="primary"
              disabled={!canGenerate || busy !== null}
              onClick={() => onGenerate('operating_agreement')}
            >
              {busy === 'generate-operating_agreement' && <span className="spinner" />}
              Generate operating agreement
            </button>
            <button
              disabled={!canGenerate || busy !== null}
              onClick={() => onGenerate('engagement_letter')}
            >
              {busy === 'generate-engagement_letter' && <span className="spinner" />}
              Generate engagement letter
            </button>
          </div>
          {!canGenerate && (
            <p className="text-muted text-sm">
              Drafting unlocks once intake is submitted and the consultation is recorded.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
