'use client'

// Matter › DOCUMENTS tab. The documents produced for this matter — the latest
// draft with download (PDF / Word), email-to-client, and a link into full review
// (which carries the version history). Generation happens from the Overview tab.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
import { humanizeKind, humanizeStatus, type MatterDetail } from '../shared'

interface DraftPayload {
  documentVersionId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  bodyMarkdown: string
}
interface SendDraftLinkResult {
  messageId: string
  from: string
  to: string
}

export default function MatterDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailStatus, setEmailStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await callAttorneyMcp<{ matter: MatterDetail | null }>({
        toolName: 'legal.matter.get',
        input: { matterEntityId: id },
      })
      setMatter(res.matter)
      if (res.matter?.latestDraftVersionId) {
        const draftRes = await callAttorneyMcp<{ draft: DraftPayload | null }>({
          toolName: 'legal.draft.get',
          input: { documentVersionId: res.matter.latestDraftVersionId },
        })
        setDraft(draftRes.draft)
      } else {
        setDraft(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function emailDraftLink() {
    if (!draft || !matter) return
    const defaultTo = matter.clientEmail ?? ''
    const to =
      defaultTo ||
      (typeof window !== 'undefined'
        ? (
            window.prompt('No client email on file. Send draft link to which email?', '') ?? ''
          ).trim()
        : '')
    if (!to) {
      setEmailStatus({
        kind: 'err',
        msg: 'No recipient. Add a client email to the contact or enter one when prompted.',
      })
      return
    }
    if (typeof window !== 'undefined' && !window.confirm(`Send draft link to ${to}?`)) return
    setBusy('email')
    setEmailStatus(null)
    try {
      const result = await callAttorneyMcp<SendDraftLinkResult>({
        toolName: 'legal.email.send_draft_link',
        input: {
          matterEntityId: id,
          documentVersionId: draft.documentVersionId,
          shareUrl: shareUrlFor(draft.documentVersionId),
          to,
        },
      })
      setEmailStatus({ kind: 'ok', msg: `Sent to ${result.to}` })
      setTimeout(() => setEmailStatus(null), 6000)
    } catch (err) {
      setEmailStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" /> Loading…
      </div>
    )
  }
  if (error) return <div className="alert alert-error">{error}</div>

  const fileBase = draft
    ? `${humanizeKind(draft.documentKind).replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`
    : ''

  return (
    <section>
      <h2>Documents</h2>
      {!draft ? (
        <p className="text-muted">
          No documents yet. Generate one from the <strong>Overview</strong> tab once intake and the
          consultation are in.
        </p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <h3 style={{ margin: 0 }}>Latest draft — {humanizeKind(draft.documentKind)}</h3>
            <span className="text-sm text-muted">
              v{draft.versionNumber} · {humanizeStatus(draft.status)} ·{' '}
              {new Date(draft.recordedAt).toLocaleDateString()}
            </span>
          </div>
          <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button onClick={() => downloadAsPdf(draft.bodyMarkdown, fileBase)}>
              Download PDF
            </button>
            <button onClick={() => downloadAsWord(draft.bodyMarkdown, fileBase)}>
              Download Word
            </button>
            <button
              onClick={emailDraftLink}
              disabled={busy === 'email'}
              title={
                matter?.clientEmail
                  ? `Will send to ${matter.clientEmail}`
                  : "No client email on file — you'll be prompted"
              }
            >
              {busy === 'email' && <span className="spinner" />}
              {busy === 'email' ? 'Sending…' : 'Email link to client'}
            </button>
            <Link
              href={`/attorney/review/${draft.documentVersionId}`}
              style={{ marginLeft: 'auto' }}
            >
              <button className="primary">Open full review</button>
            </Link>
          </div>
          {emailStatus && (
            <div
              className={`alert ${emailStatus.kind === 'ok' ? '' : 'alert-error'}`}
              style={
                emailStatus.kind === 'ok'
                  ? {
                      background: 'var(--ok-soft)',
                      color: '#166534',
                      border: '1px solid #86efac',
                      marginTop: 'var(--space-3)',
                    }
                  : { marginTop: 'var(--space-3)' }
              }
            >
              {emailStatus.msg}
            </div>
          )}
        </>
      )}
    </section>
  )
}
