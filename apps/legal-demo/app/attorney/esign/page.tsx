'use client'

// eSign envelopes list (Legal Instruments WP-N). Three stat cards (Action needed
// / Out for signature / Completed), filter pills with counts, and a table of every
// envelope in the firm — all backed by the real `legal.esign.envelopes_list` read.
// "Action needed" = an active envelope currently blocked on the FIRM's own
// signer (see WIRING §WP-N for the exact rule).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { FileTextIcon, PlusIcon } from '@/components/icons'

type EnvelopeBucket = 'action_needed' | 'out' | 'completed' | 'declined' | 'voided'

interface EnvelopeSigner {
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  key: string | null
  signedAt: string | null
}
interface EnvelopeListItem {
  envelopeId: string
  subject: string | null
  status: string
  bucket: EnvelopeBucket
  documentEntityId: string | null
  documentKind: string | null
  matterEntityId: string | null
  matterNumber: string | null
  contactEntityId: string | null
  contactName: string | null
  signers: EnvelopeSigner[]
  signedCount: number
  signerCount: number
  sentAt: string | null
  updatedAt: string | null
}

// One color language across the stat-card dot, filter pill, and row chip.
const BUCKET_META: Record<EnvelopeBucket, { label: string; fg: string; bg: string }> = {
  action_needed: { label: 'Action needed', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  // Comp's "Out for signature" chip (esignData().stMap.sent) is the warn amber/tan
  // pair, not blue.
  out: { label: 'Out for signature', fg: 'var(--li-warn)', bg: 'var(--li-warn-bg)' },
  completed: { label: 'Completed', fg: 'var(--li-ok)', bg: 'var(--li-ok-bg)' },
  declined: { label: 'Declined', fg: 'var(--li-danger)', bg: 'var(--li-danger-bg)' },
  voided: { label: 'Voided', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
}

export function humanizeDocKind(kind: string | null): string {
  if (!kind) return 'Document'
  // 0170: uploaded-PDF envelopes carry the esign_upload document kind.
  if (kind === 'esign_upload') return 'Uploaded PDF'
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// The stored envelope subject carries a "Signature requested: " lead-in written at
// send time (verticals/legal/src/api/esign.ts, sendEnvelope) so the string reads
// well as an email subject line. The comp shows a clean document title instead —
// strip the lead-in here, at render time only. Never touch the stored subject or
// the send/create path.
const SUBJECT_PREFIX_RE = /^Signature requested:\s*/i
export function cleanEnvelopeSubject(subject: string | null): string | null {
  return subject ? subject.replace(SUBJECT_PREFIX_RE, '') : subject
}

function signerNames(signers: EnvelopeSigner[]): string {
  const names = signers.map((s) => s.name || s.email || 'Signer')
  if (names.length === 0) return '—'
  return names.join(', ')
}

function formatSent(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

// Compact relative "updated" like the comp ("2h ago", else a short date).
function formatUpdated(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return formatSent(iso)
}

type Pill = { key: 'all' | EnvelopeBucket; label: string }
const PILLS: Pill[] = [
  { key: 'all', label: 'All' },
  { key: 'action_needed', label: 'Action needed' },
  { key: 'out', label: 'Out for signature' },
  { key: 'completed', label: 'Completed' },
  { key: 'declined', label: 'Declined' },
]

export default function EsignPage() {
  const router = useRouter()
  const [envelopes, setEnvelopes] = useState<EnvelopeListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Pill['key']>('all')

  const load = useCallback(() => {
    callAttorneyMcp<{ envelopes: EnvelopeListItem[] }>({ toolName: 'legal.esign.envelopes_list' })
      .then((r) => setEnvelopes(r.envelopes))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<EnvelopeBucket, number> = {
      action_needed: 0,
      out: 0,
      completed: 0,
      declined: 0,
      voided: 0,
    }
    for (const e of envelopes ?? []) c[e.bucket]++
    return c
  }, [envelopes])

  const pillCount = (key: Pill['key']): number =>
    key === 'all' ? (envelopes?.length ?? 0) : counts[key]

  const view = useMemo(() => {
    if (!envelopes) return null
    if (filter === 'all') return envelopes
    return envelopes.filter((e) => e.bucket === filter)
  }, [envelopes, filter])

  return (
    <div className="li-esign">
      <div className="li-esign-head">
        <div>
          <h1 className="li-esign-title">eSign</h1>
          <p className="li-esign-sub">
            Send documents for signature and track every envelope end to end.
          </p>
        </div>
        <button
          type="button"
          className="li-esign-newbtn"
          onClick={() => router.push('/attorney/esign/new')}
        >
          <PlusIcon size={16} />
          New envelope
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="li-esign-stats">
        {(['action_needed', 'out', 'completed'] as const).map((b) => (
          <div key={b} className="li-esign-stat">
            <div className="li-esign-stat-label">
              <span className="li-esign-stat-dot" style={{ background: BUCKET_META[b].fg }} />
              {BUCKET_META[b].label}
            </div>
            <div className="li-esign-stat-num">{counts[b]}</div>
          </div>
        ))}
      </div>

      <div className="li-esign-pills">
        {PILLS.map((p) => {
          const active = filter === p.key
          return (
            <button
              key={p.key}
              type="button"
              className={`li-esign-pill${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => setFilter(p.key)}
            >
              {p.label}
              <span className="li-esign-pill-count">{pillCount(p.key)}</span>
            </button>
          )
        })}
      </div>

      {view === null && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}

      {view && view.length === 0 && (
        <div className="li-esign-empty">
          {envelopes && envelopes.length === 0
            ? 'No envelopes yet. Upload a PDF with “New envelope”, or send a drafted document from Review.'
            : 'No envelopes in this filter.'}
        </div>
      )}

      {view && view.length > 0 && (
        <div className="li-esign-table">
          <div className="li-esign-thead">
            <span>DOCUMENT</span>
            <span>SIGNERS</span>
            <span>STATUS</span>
            <span>SENT</span>
            <span className="li-esign-th-right">UPDATED</span>
          </div>
          <div className="li-esign-tbody">
            {view.map((e) => {
              const meta = BUCKET_META[e.bucket]
              return (
                <Link
                  key={e.envelopeId}
                  href={`/attorney/esign/${e.envelopeId}`}
                  className="li-esign-row"
                >
                  <span className="li-esign-cell-doc">
                    <span className="li-esign-doc-ico" aria-hidden="true">
                      <FileTextIcon size={16} />
                    </span>
                    <span className="li-esign-doc-text">
                      <span className="li-esign-doc-subject">
                        {cleanEnvelopeSubject(e.subject) || humanizeDocKind(e.documentKind)}
                      </span>
                      <span className="li-esign-doc-sub">
                        {(e.matterNumber || e.contactName || '—') +
                          ' · ' +
                          humanizeDocKind(e.documentKind)}
                      </span>
                    </span>
                  </span>
                  <span className="li-esign-cell-signers">
                    <span className="li-esign-signer-names">{signerNames(e.signers)}</span>
                    <span className="li-esign-signer-progress">
                      {e.signedCount} of {e.signerCount} signed
                    </span>
                  </span>
                  <span>
                    <span className="li-esign-chip" style={{ background: meta.bg, color: meta.fg }}>
                      {meta.label}
                    </span>
                  </span>
                  <span className="li-esign-cell-sent">{formatSent(e.sentAt)}</span>
                  <span className="li-esign-cell-updated">{formatUpdated(e.updatedAt)}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
