'use client'

// ESIGN-UNIFY-1 ES-4 (design §7) — the workflow-embedded e-sign step window.
//
// When the step becomes current the envelope is ALREADY BUILT server-side
// (legal.esign.workflow_step_context): approved version + template-role-resolved
// recipients + pre-placed marker fields. The window shows that summary with ONE
// primary action — Review & send — which opens the EsignComposer in
// `workflow-step` mode (document locked, recipients editable). Sending submits
// the one esign.send; the stage then HOLDS until every signer signs and the
// envelope's esign.completed fires its system edge (the existing lifecycle
// dispatch in handlers/esign.ts). No draft envelope is ever persisted, and the
// footer never shows a bare Continue (#442: the step's own action completes it).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Modal } from '@/components/Modal'
import { CheckCircleIcon, FileTextIcon, SignatureIcon, UsersIcon } from '@/components/icons'
import { EsignComposer, type WorkflowStepRecipientSeed } from '@/components/esign/EsignComposer'
import type { MatterDetail, WfStage, WfStepState } from './shared'

interface StepRecipient {
  signerKey: string
  label: string
  role: 'needs_to_sign' | 'needs_to_view' | 'receives_copy'
  order: number
  bind: string
  resolved: boolean
  name: string | null
  email: string | null
  title: string | null
  contactEntityId: string | null
}

interface StepContext {
  documentKind: string
  signable: boolean
  document: {
    documentEntityId: string
    documentVersionId: string
    versionNumber: number
    title: string
  } | null
  markerCount: number
  recipients: StepRecipient[]
  subject: string | null
  envelope: { envelopeId: string; status: string } | null
}

const ROLE_LABELS: Record<StepRecipient['role'], string> = {
  needs_to_sign: 'Needs to sign',
  needs_to_view: 'Needs to view',
  receives_copy: 'Receives a copy',
}

function stepDocKind(stage: WfStage): string | null {
  const cfg = (stage.action?.config ?? {}) as { document_kind?: unknown }
  const fromConfig = typeof cfg.document_kind === 'string' ? cfg.document_kind.trim() : ''
  if (fromConfig) return fromConfig
  return stage.documents?.find((d) => d.docKind)?.docKind?.trim() || null
}

export function EsignWorkflowStep({
  stage,
  matter,
  state,
  onChanged,
  onClose,
}: {
  stage: WfStage
  matter: MatterDetail
  state: WfStepState
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const docKind = stepDocKind(stage)
  const [ctx, setCtx] = useState<StepContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    if (!docKind) {
      setLoading(false)
      return
    }
    setErr(null)
    try {
      const res = await callAttorneyMcp<StepContext>({
        toolName: 'legal.esign.workflow_step_context',
        input: { matterEntityId: matter.matterEntityId, documentKind: docKind },
      })
      setCtx(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [docKind, matter.matterEntityId])

  useEffect(() => {
    void load()
  }, [load])

  // ── Composer mode: the wizard fills the window (document locked to the
  // approved version; recipients arrive pre-resolved, still editable). ────────
  if (composing && ctx?.document) {
    const seeds: WorkflowStepRecipientSeed[] = ctx.recipients.map((r) => ({
      name: r.name ?? '',
      email: r.email ?? '',
      title: r.title ?? '',
      role: r.role,
      order: r.order,
      key: r.signerKey,
      label: r.label,
    }))
    return (
      <Modal title={stage.label} onClose={() => setComposing(false)} size="wide">
        <EsignComposer
          source={{
            kind: 'workflow-step',
            matterEntityId: matter.matterEntityId,
            documentEntityId: ctx.document.documentEntityId,
            documentVersionId: ctx.document.documentVersionId,
            documentTitle: ctx.document.title,
            versionNumber: ctx.document.versionNumber,
            subject: ctx.subject ?? undefined,
            recipients: seeds,
          }}
          onClose={() => setComposing(false)}
          onSent={() => {
            // The step's own action is complete (esign.sent); the WORKFLOW
            // advances later, on esign.completed. Refresh both surfaces.
            void load()
            void onChanged()
          }}
        />
      </Modal>
    )
  }

  const envelopeStatus = ctx?.envelope?.status ?? null
  const sent = envelopeStatus === 'sent' || envelopeStatus === 'pending_dispatch'
  const completed = envelopeStatus === 'completed'
  const unresolved = (ctx?.recipients ?? []).filter(
    (r) => r.role === 'needs_to_sign' && !r.resolved,
  )

  return (
    <Modal title={stage.label} onClose={onClose}>
      {loading ? (
        <p className="text-muted">Loading the e-sign step…</p>
      ) : !docKind ? (
        <p className="text-muted">
          This e-sign step names no document kind — edit the step and set which document it sends.
        </p>
      ) : (
        <>
          {err && <div className="alert alert-error">{err}</div>}

          {/* ── Envelope already out: honest sent / completed state ─────────── */}
          {completed && (
            <div className="li-esign2-step-status is-done">
              <CheckCircleIcon size={18} />
              <div>
                <div className="li-esign2-step-status-title">Everyone has signed</div>
                <div className="li-esign2-step-status-sub">
                  The executed version is recorded on the matter; the workflow advances
                  automatically.
                  {ctx?.envelope && (
                    <>
                      {' '}
                      <Link href={`/attorney/esign/${ctx.envelope.envelopeId}`}>View envelope</Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {sent && (
            <div className="li-esign2-step-status">
              <SignatureIcon size={18} />
              <div>
                <div className="li-esign2-step-status-title">Sent — awaiting signatures</div>
                <div className="li-esign2-step-status-sub">
                  This step completes on its own when every signer has signed (the matter advances
                  on completion).
                  {ctx?.envelope && (
                    <>
                      {' '}
                      <Link href={`/attorney/esign/${ctx.envelope.envelopeId}`}>View envelope</Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {envelopeStatus === 'declined' && (
            <div className="alert alert-error">
              A signer declined the last envelope — review and send a fresh one below.
            </div>
          )}

          {/* ── The auto-built envelope summary ─────────────────────────────── */}
          {!sent && !completed && (
            <>
              {!ctx?.document ? (
                <p className="text-muted">
                  Waiting for an approved version of this document — the e-sign step opens once the
                  review step approves it.
                </p>
              ) : (
                <div className="li-esign2-step-summary">
                  <div className="li-esign2-step-row">
                    <span className="li-esign2-step-row-ico" aria-hidden="true">
                      <FileTextIcon size={17} />
                    </span>
                    <span>
                      <strong>{ctx.document.title}</strong> — version {ctx.document.versionNumber},
                      approved
                    </span>
                  </div>
                  <div className="li-esign2-step-row">
                    <span className="li-esign2-step-row-ico" aria-hidden="true">
                      <UsersIcon size={17} />
                    </span>
                    <span>
                      {ctx.recipients.length === 0
                        ? 'No recipients pre-resolved — add them in the composer.'
                        : ctx.recipients
                            .map(
                              (r) =>
                                `${r.name || r.email || `${r.label} (fill in)`} · ${ROLE_LABELS[r.role]}`,
                            )
                            .join(' — ')}
                    </span>
                  </div>
                  <div className="li-esign2-step-row">
                    <span className="li-esign2-step-row-ico" aria-hidden="true">
                      <SignatureIcon size={17} />
                    </span>
                    <span>
                      {ctx.markerCount > 0
                        ? `${ctx.markerCount} signature field${ctx.markerCount === 1 ? '' : 's'} pre-placed from the template`
                        : 'Whole-document signing (no field markers in this version)'}
                    </span>
                  </div>
                  {unresolved.length > 0 && (
                    <p className="li-esign2-step-warn">
                      {unresolved.map((r) => r.label).join(', ')}{' '}
                      {unresolved.length === 1 ? 'has' : 'have'} no email on file yet — fill them in
                      before sending.
                    </p>
                  )}
                  {state === 'current' ? (
                    <div className="li-esign2-step-cta">
                      <button
                        type="button"
                        className="li-esign-btn li-esign-btn--primary"
                        onClick={() => setComposing(true)}
                      >
                        Review &amp; send
                      </button>
                    </div>
                  ) : (
                    <p className="text-muted">
                      {state === 'done'
                        ? 'This step is complete.'
                        : 'Available when the workflow reaches this step.'}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  )
}
