'use client'

// eSign envelope detail (Legal Instruments WP-N). Signers & sequential-routing
// card, a document preview with a SIGN-HERE block per signer, and the real
// actions per comp: Resend / Void (active envelopes) and Download executed copy
// (completed). Reuses the EnvelopeStatusView data path (`legal.esign.status`).
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { DocumentSheet } from '@/components/DocumentSheet'
import { downloadAsPdf } from '@/lib/draftExport'
import {
  ChevronLeftIcon,
  RefreshIcon,
  DownloadIcon,
  FileTextIcon,
  ShieldCheckIcon,
} from '@/components/icons'
import { cleanEnvelopeSubject, humanizeDocKind } from '../page'

type EnvelopeBucket = 'action_needed' | 'out' | 'completed' | 'declined' | 'voided'

interface EnvelopeSigner {
  requestId: string
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  signedAt: string | null
  key: string | null
}
interface EnvelopeStatus {
  envelopeId: string
  status: string | null
  subject: string | null
  signers: EnvelopeSigner[]
  documentEntityId: string | null
  executedDocumentVersionId: string | null
  matterEntityId: string | null
  matterNumber: string | null
  documentKind: string | null
  sentAt: string | null
  bucket: EnvelopeBucket
}

const BUCKET_META: Record<EnvelopeBucket, { label: string; fg: string; bg: string }> = {
  action_needed: { label: 'Action needed', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  // Comp's "Out for signature" chip (esignData().stMap.sent) is the warn amber/tan
  // pair, not blue — kept in sync with the list page's BUCKET_META.
  out: { label: 'Out for signature', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  completed: { label: 'Completed', fg: 'var(--li-ok)', bg: 'var(--li-ok-bg)' },
  declined: { label: 'Declined', fg: 'var(--li-danger)', bg: 'var(--li-danger-bg)' },
  voided: { label: 'Voided', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
}

// Per-signer status chip color (delivered/opened/signed/declined/voided/pending).
const SIGNER_META: Record<string, { label: string; fg: string; bg: string }> = {
  signed: { label: 'Signed', fg: 'var(--li-ok)', bg: 'var(--li-ok-bg)' },
  declined: { label: 'Declined', fg: 'var(--li-danger)', bg: 'var(--li-danger-bg)' },
  voided: { label: 'Voided', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
  opened: { label: 'Opened', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  delivered: { label: 'Delivered', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  pending: { label: 'Pending', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
}
function signerMeta(status: string): { label: string; fg: string; bg: string } {
  return SIGNER_META[status] ?? SIGNER_META.pending!
}

function initials(name: string | null, email: string | null): string {
  const src = (name || email || '').trim()
  if (!src) return '·'
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function channelLabel(channel: string | null): string {
  return channel === 'portal' ? 'Client portal' : 'Email link'
}
function signedDisplay(s: EnvelopeSigner): string {
  if (s.signedAt) return `Signed ${formatDate(s.signedAt)}`
  return signerMeta(s.status).label
}

interface DraftGet {
  draft: { bodyMarkdown: string } | null
}

export default function EsignDetailPage({ params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = use(params)
  const router = useRouter()
  const [env, setEnv] = useState<EnvelopeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'resend' | 'void' | 'download'>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    callAttorneyMcp<EnvelopeStatus>({ toolName: 'legal.esign.status', input: { envelopeId } })
      .then(setEnv)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [envelopeId])

  useEffect(() => {
    load()
  }, [load])

  async function onResend(): Promise<void> {
    setBusy('resend')
    setNotice(null)
    setError(null)
    try {
      const r = await callAttorneyMcp<{ notified: number }>({
        toolName: 'legal.esign.resend',
        input: { envelopeId },
      })
      setNotice(
        r.notified === 1
          ? 'Signing link re-sent to the current signer.'
          : `Signing link re-sent to ${r.notified} signers.`,
      )
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function onVoid(): Promise<void> {
    if (
      !window.confirm(
        'Void this envelope? Every open signing link is closed and can no longer be used. This cannot be undone.',
      )
    )
      return
    setBusy('void')
    setNotice(null)
    setError(null)
    try {
      await callAttorneyMcp<{ status: string }>({
        toolName: 'legal.esign.void',
        input: { envelopeId },
      })
      setNotice('Envelope voided.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function onDownload(): Promise<void> {
    if (!env?.executedDocumentVersionId) return
    setBusy('download')
    setError(null)
    try {
      const r = await callAttorneyMcp<DraftGet>({
        toolName: 'legal.draft.get',
        input: { documentVersionId: env.executedDocumentVersionId },
      })
      const body = r.draft?.bodyMarkdown
      if (!body) throw new Error('Executed copy is unavailable.')
      const base = cleanEnvelopeSubject(env.subject) || humanizeDocKind(env.documentKind)
      downloadAsPdf(body, `${base} — Executed`, { status: 'executed' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && !env) return <div className="alert alert-error">{error}</div>
  if (!env)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  const meta = BUCKET_META[env.bucket]
  const isActive = env.status === 'sent' || env.status === 'pending_dispatch'
  const canResend = env.status === 'sent'
  const canDownload = env.bucket === 'completed' && Boolean(env.executedDocumentVersionId)
  const docLabel = humanizeDocKind(env.documentKind)

  return (
    <div className="li-esign-detail">
      <button
        type="button"
        className="li-esign-back"
        onClick={() => router.push('/attorney/esign')}
      >
        <ChevronLeftIcon size={15} />
        All envelopes
      </button>

      <div className="li-esign-detail-head">
        <div>
          <h1 className="li-esign-detail-title">{cleanEnvelopeSubject(env.subject) || docLabel}</h1>
          <div className="li-esign-detail-meta">
            <span className="li-esign-chip" style={{ background: meta.bg, color: meta.fg }}>
              {meta.label}
            </span>
            <span className="li-esign-detail-metatext">
              {(env.matterNumber || '—') + ' · Sent ' + formatDate(env.sentAt)}
            </span>
          </div>
        </div>
        <div className="li-esign-detail-actions">
          {isActive && (
            <>
              {canResend && (
                <button
                  type="button"
                  className="li-esign-btn"
                  onClick={onResend}
                  disabled={busy !== null}
                >
                  <RefreshIcon size={15} />
                  {busy === 'resend' ? 'Resending…' : 'Resend'}
                </button>
              )}
              <button
                type="button"
                className="li-esign-btn li-esign-btn--danger"
                onClick={onVoid}
                disabled={busy !== null}
              >
                {busy === 'void' ? 'Voiding…' : 'Void'}
              </button>
            </>
          )}
          {canDownload && (
            <button
              type="button"
              className="li-esign-btn li-esign-btn--primary"
              onClick={onDownload}
              disabled={busy !== null}
            >
              <DownloadIcon size={15} />
              {busy === 'download' ? 'Preparing…' : 'Download executed copy'}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="li-esign-notice">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-esign-detail-grid">
        <div className="li-esign-detail-main">
          <div className="li-esign-routing">
            <div className="li-esign-routing-head">Signers &amp; routing</div>
            {env.signers.map((s) => {
              const sm = signerMeta(s.status)
              return (
                <div key={s.requestId} className="li-esign-signer">
                  <span className="li-esign-signer-order">{s.order}</span>
                  <span className="li-esign-signer-avatar">{initials(s.name, s.email)}</span>
                  <div className="li-esign-signer-id">
                    <div className="li-esign-signer-name">{s.name || s.email || 'Signer'}</div>
                    <div className="li-esign-signer-contact">
                      {(s.title ? s.title + ' · ' : '') + (s.email || '—')}
                    </div>
                  </div>
                  <div className="li-esign-signer-state">
                    <span className="li-esign-chip" style={{ background: sm.bg, color: sm.fg }}>
                      {sm.label}
                    </span>
                    <div className="li-esign-signer-when">
                      {channelLabel(s.channel) + ' · ' + signedDisplay(s)}
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="li-esign-routing-foot">
              Progress: Pending → Delivered → Opened → Signed. Sequential signers become “Delivered”
              only when prior signers finish.
            </div>
          </div>
        </div>

        <div className="li-esign-detail-side">
          <div className="li-esign-preview-desk">
            <DocumentSheet variant="thumb" className="li-esign-preview-sheet">
              <div className="li-esign-preview-title">
                <FileTextIcon size={15} />
                {cleanEnvelopeSubject(env.subject) || docLabel}
              </div>
              <div className="li-esign-preview-body">
                This is the document sent for signature. Signature and date fields are placed at the
                signing blocks below.
              </div>
              <div className="li-esign-preview-blocks">
                {env.signers.map((s) => (
                  <div key={s.requestId} className="li-esign-signhere">
                    <span className="li-esign-signhere-tag">SIGN HERE</span>
                    <div className="li-esign-signhere-name">
                      {(s.name || s.email || 'Signer') + (s.title ? ' — ' + s.title : '')}
                    </div>
                  </div>
                ))}
              </div>
            </DocumentSheet>
          </div>
          <div className="li-esign-consent">
            <ShieldCheckIcon size={17} />
            <span>
              Signers accept ESIGN/UETA consent before signing. On completion an executed copy with
              a signature certificate and the original’s SHA-256 hash is filed to the matter.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
