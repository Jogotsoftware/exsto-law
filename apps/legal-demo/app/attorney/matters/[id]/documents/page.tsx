'use client'

// Matter › DOCUMENTS tab. Two lanes: the GENERATED latest draft (download PDF/Word,
// email-to-client, open review) and UPLOADED documents (signed PDFs, exhibits,
// client files) stored in Supabase Storage. Generation happens from the Overview
// tab; uploads POST to the dedicated upload route and download via the proxy route.
import { use, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import { SendToClientModal } from '@/components/SendToClientModal'
import { formatDate } from '@/lib/datetime'
import { MoreVerticalIcon, UploadIcon } from '@/components/icons'
import { readDevSession } from '@/lib/auth'
import { humanizeKind, humanizeStatus, type MatterDetail } from '../shared'

const IS_DEV = process.env.NODE_ENV !== 'production'

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

// Dev-shim headers (mirrors mcpAttorney.ts) for the matter-scoped document
// routes' raw fetches — production is cookie-only and unaffected.
function devAuthHeaders(): Record<string, string> {
  if (!IS_DEV) return {}
  const dev = readDevSession()
  return dev ? { 'x-actor-id': dev.actorId, 'x-tenant-id': dev.tenantId } : {}
}

// GET a matter-document route and save it as a file via a Blob, rather than a
// plain <a href> navigation — so the (dev-only) auth headers above actually
// reach the request, and the real filename from Content-Disposition is kept.
async function downloadRouteAsFile(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, { headers: devAuthHeaders() })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Download failed (${res.status}).`)
  }
  const cd = res.headers.get('content-disposition') ?? ''
  const m = /filename="([^"]+)"/.exec(cd)
  const filename = m?.[1] ?? fallbackFilename
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objUrl)
}

// Extraction (server-side, via ./extract) supports exactly what
// verticals/legal/src/api/reviewDocument.ts's extractDocumentText supports —
// mirrored here so the menu never offers a conversion that will 415. Images
// and legacy .doc have no text layer / no parser; View + AI review still work.
function isConvertible(contentType: string, filename: string): boolean {
  const f = filename.toLowerCase()
  return (
    contentType === 'application/pdf' ||
    f.endsWith('.pdf') ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    f.endsWith('.docx') ||
    contentType === 'text/plain' ||
    contentType === 'text/markdown' ||
    f.endsWith('.txt') ||
    f.endsWith('.md')
  )
}

// Comp doc-row glyphs: colored letter-page icons keyed off the file's real kind
// (Word/PDF/other), not decoration — matches legal-instruments.dc.html verbatim.
type DocGlyph = 'word' | 'pdf' | 'other'
function glyphFor(contentType: string, filename: string): DocGlyph {
  const f = filename.toLowerCase()
  if (contentType === 'application/pdf' || f.endsWith('.pdf')) return 'pdf'
  if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword' ||
    f.endsWith('.docx') ||
    f.endsWith('.doc')
  )
    return 'word'
  return 'other'
}
function DocIcon({ kind }: { kind: DocGlyph }): ReactElement {
  if (kind === 'word') {
    return (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          fill="#EAF0FB"
          stroke="#2B579A"
          strokeWidth="1.3"
        />
        <path d="M14 3v5h5" stroke="#2B579A" strokeWidth="1.3" fill="none" />
        <text x="12" y="18" fontSize="6.5" fontWeight="800" fill="#2B579A" textAnchor="middle">
          W
        </text>
      </svg>
    )
  }
  if (kind === 'pdf') {
    return (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          fill="#FBECEA"
          stroke="#C4443B"
          strokeWidth="1.3"
        />
        <path d="M14 3v5h5" stroke="#C4443B" strokeWidth="1.3" fill="none" />
        <text x="12" y="18" fontSize="5.4" fontWeight="800" fill="#C4443B" textAnchor="middle">
          PDF
        </text>
      </svg>
    )
  }
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        fill="#F3ECFB"
        stroke="#7A5AD1"
        strokeWidth="1.3"
      />
      <path d="M14 3v5h5" stroke="#7A5AD1" strokeWidth="1.3" fill="none" />
      <line x1="7.5" y1="12" x2="16" y2="12" stroke="#7A5AD1" strokeWidth="1.2" />
      <line x1="7.5" y1="15" x2="16" y2="15" stroke="#7A5AD1" strokeWidth="1.2" />
    </svg>
  )
}

export default function MatterDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [matter, setMatter] = useState<MatterDetail | null>(null)
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [uploads, setUploads] = useState<UploadedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [showSend, setShowSend] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailStatus, setEmailStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Which upload row has an AI review being enqueued (manual trigger/re-run).
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const browseRef = useRef<HTMLInputElement>(null)

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

  // Manual AI review of one uploaded document. Async by design: the memo lands
  // in the review queue and the "draft ready" email fires when it finishes.
  async function runAiReview(documentVersionId: string) {
    setReviewBusyId(documentVersionId)
    setUploadError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.document.review.run',
        input: { matterEntityId: id, documentVersionId },
      })
      setEmailStatus({
        kind: 'ok',
        msg: 'AI review queued — the memo will appear in your review queue (you will get an email).',
      })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setReviewBusyId(null)
    }
  }

  async function doUpload(file: File) {
    setUploadError(null)
    setUploadBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      // Pre-existing gap (not new to this restyle): a raw fetch — unlike
      // callAttorneyMcp — never forwarded the dev-only x-actor-id/x-tenant-id
      // shim, so uploads always 401'd under local `?demo_user=` testing. Same
      // fix as mcpAttorney.ts; production is unaffected (IS_DEV false, cookie-only).
      const res = await fetch(`/api/attorney/matters/${id}/documents/upload`, {
        method: 'POST',
        headers: devAuthHeaders(),
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Upload failed (${res.status}).`)
      }
      await load()
      setShowUpload(false)
      setPendingFile(null)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadBusy(false)
    }
  }

  // ── Uploaded-document actions (WP-B2: the full comp menu, real conversions) ──
  async function viewUpload(u: UploadedDoc) {
    setUploadError(null)
    try {
      await downloadRouteAsFile(
        `/api/attorney/matters/${id}/documents/${u.documentVersionId}/download`,
        u.originalFilename,
      )
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    }
  }

  async function downloadUploadAsWord(u: UploadedDoc) {
    setUploadError(null)
    try {
      await downloadRouteAsFile(
        `/api/attorney/matters/${id}/documents/${u.documentVersionId}/convert-word`,
        `${u.originalFilename} (Converted copy).doc`,
      )
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    }
  }

  async function downloadUploadAsPdf(u: UploadedDoc) {
    setUploadError(null)
    // PDF originals need no conversion — download as-is (founder decision).
    if (glyphFor(u.contentType, u.originalFilename) === 'pdf') {
      await viewUpload(u)
      return
    }
    // Anything else convertible: extract server-side, then reuse the EXACT
    // print-based PDF export drafts already use — one PDF path, not two.
    try {
      const res = await fetch(
        `/api/attorney/matters/${id}/documents/${u.documentVersionId}/extract`,
        { headers: devAuthHeaders() },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Could not extract text (${res.status}).`)
      }
      const data = (await res.json()) as { text: string }
      downloadAsPdf(data.text, `${u.originalFilename} (Converted copy)`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    }
  }

  // Email an upload with the existing compose flow, pre-attached — reuses the
  // SAME attachment resolution (mailAttachments.ts resolveMatterAttachments,
  // {kind:'upload'}) the manual Attach picker already uses in Mail; this just
  // pre-selects it via query params instead of requiring a second pick.
  function emailUpload(u: UploadedDoc) {
    const params = new URLSearchParams({
      compose: '1',
      to: matter?.clientEmail ?? '',
      subject: `${u.originalFilename} — ${matter?.matterNumber ?? ''}`,
      attachKind: 'upload',
      attachId: u.documentVersionId,
      attachLabel: u.originalFilename,
      matterId: id,
    })
    window.location.href = `/attorney/mail?${params.toString()}`
  }

  if (loading) {
    return (
      <div className="loading-block" role="status">
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
      {showSend && draft && matter && (
        <SendToClientModal
          matter={{
            entityId: id,
            matterNumber: matter.matterNumber,
            clientName: matter.clientName,
            clientEmail: matter.clientEmail,
          }}
          doc={{
            documentVersionId: draft.documentVersionId,
            documentKind: draft.documentKind,
            versionNumber: draft.versionNumber,
            status: draft.status,
          }}
          onClose={() => setShowSend(false)}
          onSent={(msg) => {
            setEmailStatus({ kind: 'ok', msg })
            setTimeout(() => setEmailStatus(null), 6000)
          }}
        />
      )}

      <div className="li-mat-card li-mat-doccard">
        <div className="li-mat-doccard-head">
          <h2 className="li-mat-card-title">Documents</h2>
          <button type="button" className="li-mat-upload-btn" onClick={() => setShowUpload(true)}>
            <UploadIcon size={16} />
            Upload
          </button>
        </div>

        {emailStatus && (
          <div className={`alert ${emailStatus.kind === 'ok' ? 'alert-success' : 'alert-error'}`}>
            {emailStatus.msg}
          </div>
        )}
        {uploadError && <div className="alert alert-error">{uploadError}</div>}

        {!draft && uploads.length === 0 ? (
          <p className="text-muted" style={{ padding: '8px 4px 16px' }}>
            No documents yet. Generate one from the <strong>Overview</strong> tab, or upload a file.
          </p>
        ) : (
          <div className="li-mat-doclist">
            {draft && (
              <div className="li-mat-docrow">
                <span className="li-mat-docrow-icon">
                  <DocIcon kind="word" />
                </span>
                <span className="li-mat-docrow-title">
                  {humanizeKind(draft.documentKind)}
                  <span className="li-mat-docrow-tag">v{draft.versionNumber}</span>
                </span>
                <span className="li-mat-docrow-date">
                  {humanizeStatus(draft.status)} · {formatDate(draft.recordedAt)}
                </span>
                <span className="li-mat-docrow-menu">
                  <button
                    type="button"
                    className="li-mat-kebab"
                    title="Document actions"
                    onClick={() => setOpenMenuId((v) => (v === 'draft' ? null : 'draft'))}
                  >
                    <MoreVerticalIcon size={16} />
                  </button>
                  {openMenuId === 'draft' && (
                    <>
                      <div className="li-mat-menu-backdrop" onClick={() => setOpenMenuId(null)} />
                      <div className="li-mat-menu">
                        <Link
                          href={`/attorney/review/${draft.documentVersionId}`}
                          className="li-mat-menu-item"
                          onClick={() => setOpenMenuId(null)}
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="li-mat-menu-item"
                          onClick={() => {
                            setOpenMenuId(null)
                            downloadAsWord(draft.bodyMarkdown, fileBase, { status: draft.status })
                          }}
                        >
                          Download Word
                        </button>
                        <button
                          type="button"
                          className="li-mat-menu-item"
                          onClick={() => {
                            setOpenMenuId(null)
                            downloadAsPdf(draft.bodyMarkdown, fileBase, { status: draft.status })
                          }}
                        >
                          Download PDF
                        </button>
                        <button
                          type="button"
                          className="li-mat-menu-item"
                          onClick={() => {
                            setOpenMenuId(null)
                            setShowSend(true)
                          }}
                        >
                          Email
                        </button>
                      </div>
                    </>
                  )}
                </span>
              </div>
            )}

            {uploads.map((u) => {
              const glyph = glyphFor(u.contentType, u.originalFilename)
              return (
                <div key={u.documentVersionId} className="li-mat-docrow">
                  <span className="li-mat-docrow-icon">
                    <DocIcon kind={glyph} />
                  </span>
                  <span className="li-mat-docrow-title">
                    {u.originalFilename}
                    <span className="li-mat-docrow-tag">{formatBytes(u.sizeBytes)}</span>
                  </span>
                  <span className="li-mat-docrow-date">
                    {new Date(u.uploadedAt).toLocaleDateString()}
                  </span>
                  <span className="li-mat-docrow-menu">
                    <button
                      type="button"
                      className="li-mat-kebab"
                      title="Document actions"
                      onClick={() =>
                        setOpenMenuId((v) =>
                          v === u.documentVersionId ? null : u.documentVersionId,
                        )
                      }
                    >
                      <MoreVerticalIcon size={16} />
                    </button>
                    {openMenuId === u.documentVersionId && (
                      <>
                        <div className="li-mat-menu-backdrop" onClick={() => setOpenMenuId(null)} />
                        <div className="li-mat-menu">
                          <button
                            type="button"
                            className="li-mat-menu-item"
                            onClick={() => {
                              setOpenMenuId(null)
                              void viewUpload(u)
                            }}
                          >
                            View
                          </button>
                          {isConvertible(u.contentType, u.originalFilename) && (
                            <>
                              <button
                                type="button"
                                className="li-mat-menu-item"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  void downloadUploadAsWord(u)
                                }}
                              >
                                Download Word
                              </button>
                              <button
                                type="button"
                                className="li-mat-menu-item"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  void downloadUploadAsPdf(u)
                                }}
                              >
                                Download PDF
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="li-mat-menu-item"
                            onClick={() => {
                              setOpenMenuId(null)
                              emailUpload(u)
                            }}
                          >
                            Email
                          </button>
                          <button
                            type="button"
                            className="li-mat-menu-item"
                            disabled={reviewBusyId === u.documentVersionId}
                            onClick={() => {
                              setOpenMenuId(null)
                              void runAiReview(u.documentVersionId)
                            }}
                          >
                            {reviewBusyId === u.documentVersionId ? 'Queued…' : 'AI review'}
                          </button>
                        </div>
                      </>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showUpload && (
        <div className="li-mat-modal-backdrop" onClick={() => !uploadBusy && setShowUpload(false)}>
          <div className="li-mat-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="li-mat-upload-head">
              <h2>Upload document</h2>
              <button
                type="button"
                className="li-mat-modal-x"
                onClick={() => setShowUpload(false)}
                disabled={uploadBusy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="li-mat-upload-body">
              <div
                className={dragOver ? 'li-mat-dropzone is-over' : 'li-mat-dropzone'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) setPendingFile(f)
                }}
              >
                <span className="li-mat-dropzone-ico">
                  <UploadIcon size={26} />
                </span>
                <div className="li-mat-dropzone-title">Drag &amp; drop a file here</div>
                <div className="li-mat-dropzone-sub">PDF, Word, or images · up to 25 MB</div>
                <button
                  type="button"
                  className="li-mat-browse-btn"
                  onClick={() => browseRef.current?.click()}
                >
                  Browse files
                </button>
                <input
                  ref={browseRef}
                  type="file"
                  hidden
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt,application/pdf,image/png,image/jpeg,image/tiff,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) setPendingFile(f)
                  }}
                />
              </div>
              {pendingFile && (
                <div className="li-mat-pendingfile">
                  <span className="li-mat-docrow-icon">
                    <DocIcon kind={glyphFor(pendingFile.type, pendingFile.name)} />
                  </span>
                  <div className="li-mat-pendingfile-name">
                    {pendingFile.name}
                    {uploadBusy && <span className="li-mat-pendingfile-bar" />}
                  </div>
                  <span className="text-muted text-sm">{formatBytes(pendingFile.size)}</span>
                </div>
              )}
              <div className="li-mat-upload-actions">
                <button
                  type="button"
                  className="li-mat-btn-ghost"
                  onClick={() => setShowUpload(false)}
                  disabled={uploadBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="li-mat-btn-primary"
                  disabled={!pendingFile || uploadBusy}
                  onClick={() => pendingFile && void doUpload(pendingFile)}
                >
                  {uploadBusy ? 'Uploading…' : 'Add to matter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
