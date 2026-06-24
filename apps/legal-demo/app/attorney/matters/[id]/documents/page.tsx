'use client'

// Matter › DOCUMENTS tab. Two lanes: the GENERATED latest draft (download PDF/Word,
// email-to-client, open review) and UPLOADED documents (signed PDFs, exhibits,
// client files) stored in Supabase Storage. Generation happens from the Overview
// tab; uploads POST to the dedicated upload route and download via the proxy route.
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord, shareUrlFor } from '@/lib/draftExport'
import { formatDate } from '@/lib/datetime'
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
interface UploadedDoc {
  documentVersionId: string
  documentEntityId: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  documentKind: string
  uploadedAt: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function MatterDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [uploads, setUploads] = useState<UploadedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailStatus, setEmailStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const docs = await callAttorneyMcp<{ documents: UploadedDoc[] }>({
        toolName: 'legal.document.list',
        input: { matterEntityId: id },
      }).catch(() => ({ documents: [] as UploadedDoc[] }))
      setUploads(docs.documents)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setUploadError(null)
    setUploadBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/attorney/matters/${id}/documents/upload`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Upload failed (${res.status}).`)
      }
      await load()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadBusy(false)
    }
  }

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
    <>
      <section>
        <h2>Documents</h2>
        {!draft ? (
          <p className="text-muted">
            No generated documents yet. Generate one from the <strong>Overview</strong> tab once
            intake and the consultation are in.
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
                {formatDate(draft.recordedAt)}
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
                className={`alert ${emailStatus.kind === 'ok' ? 'alert-success' : 'alert-error'}`}
                style={{ marginTop: 'var(--space-3)' }}
              >
                {emailStatus.msg}
              </div>
            )}
          </>
        )}
      </section>

      <section style={{ marginTop: 'var(--space-5)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}
        >
          <h2>Uploaded documents</h2>
          <button
            className="primary"
            disabled={uploadBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadBusy && <span className="spinner" />}
            {uploadBusy ? 'Uploading…' : 'Upload document'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            disabled={uploadBusy}
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt,application/pdf,image/png,image/jpeg,image/tiff,text/plain"
            onChange={onPickFile}
          />
        </div>
        <p className="text-muted text-sm">
          Signed PDFs, exhibits, or any client file — stored securely. Max 25 MB (PDF, Word, images,
          text).
        </p>
        {uploadError && <div className="alert alert-error">{uploadError}</div>}
        {uploads.length === 0 ? (
          <p className="text-muted">No uploaded documents yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.documentVersionId}>
                    <td>{u.originalFilename}</td>
                    <td className="text-sm text-muted">{formatBytes(u.sizeBytes)}</td>
                    <td className="text-sm text-muted">
                      {new Date(u.uploadedAt).toLocaleDateString()}
                    </td>
                    <td>
                      <a
                        href={`/api/attorney/matters/${id}/documents/${u.documentVersionId}/download`}
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
