'use client'

// Pick documents to attach to a client email. Lists a matter's uploaded files and
// generated drafts (legal.mail.attachable_documents) and returns lightweight
// references ({kind, id}); the server resolves them to bytes + enforces the
// matter-scope rule at send time. For compose, the recipient can map to several
// matters, so a matter selector is shown; reply passes a single matter.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

export interface PickedAttachment {
  kind: 'draft' | 'upload'
  id: string // document_version id
  label: string
}

interface UploadedDocItem {
  documentVersionId: string
  originalFilename: string
  sizeBytes: number
}
interface DraftItem {
  documentVersionId: string
  documentKind: string
  versionNumber: number
}

function humanizeKind(kind: string): string {
  return (kind || 'document').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function fmtBytes(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentPicker({
  matterId,
  matterOptions,
  value,
  onChange,
  onMatterChange,
}: {
  /** The matter whose documents are listed (the attachment scope). */
  matterId: string | null
  /** Compose: the recipient's matters (a selector appears when >1). Reply omits it. */
  matterOptions?: Array<{ matterEntityId: string; matterNumber: string }>
  value: PickedAttachment[]
  onChange: (next: PickedAttachment[]) => void
  onMatterChange?: (matterId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<{ uploads: UploadedDocItem[]; drafts: DraftItem[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !matterId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    callAttorneyMcp<{ uploads: UploadedDocItem[]; drafts: DraftItem[] }>({
      toolName: 'legal.mail.attachable_documents',
      input: { matterEntityId: matterId },
    })
      .then((r) => {
        if (!cancelled) setDocs(r)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, matterId])

  const has = (kind: PickedAttachment['kind'], id: string) =>
    value.some((r) => r.kind === kind && r.id === id)
  function toggle(item: PickedAttachment) {
    onChange(
      has(item.kind, item.id)
        ? value.filter((r) => !(r.kind === item.kind && r.id === item.id))
        : [...value, item],
    )
  }

  return (
    <div className="mail-attach">
      <div className="mail-attach-bar">
        <button type="button" className="mail-attach-btn" onClick={() => setOpen((o) => !o)}>
          📎 Attach{value.length ? ` (${value.length})` : ''}
        </button>
        {value.map((r) => (
          <span key={r.kind + r.id} className="mail-attach-chip">
            {r.label}
            <button type="button" aria-label={`Remove ${r.label}`} onClick={() => toggle(r)}>
              ×
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="mail-attach-pop">
          {matterOptions && matterOptions.length > 1 && (
            <label className="mail-attach-matter">
              <span>Matter</span>
              <select value={matterId ?? ''} onChange={(e) => onMatterChange?.(e.target.value)}>
                {matterOptions.map((m) => (
                  <option key={m.matterEntityId} value={m.matterEntityId}>
                    {m.matterNumber}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!matterId ? (
            <p className="text-muted text-sm">Pick a matter to list its documents.</p>
          ) : loading ? (
            <p className="text-muted text-sm">
              <span className="spinner" /> Loading documents…
            </p>
          ) : error ? (
            <p className="alert alert-error">{error}</p>
          ) : docs && docs.uploads.length + docs.drafts.length === 0 ? (
            <p className="text-muted text-sm">No documents on this matter yet.</p>
          ) : (
            docs && (
              <div className="mail-attach-list">
                {docs.drafts.map((d) => {
                  const label = `${humanizeKind(d.documentKind)} (draft v${d.versionNumber})`
                  return (
                    <label key={`d${d.documentVersionId}`} className="mail-attach-item">
                      <input
                        type="checkbox"
                        checked={has('draft', d.documentVersionId)}
                        onChange={() => toggle({ kind: 'draft', id: d.documentVersionId, label })}
                      />
                      <span>
                        {humanizeKind(d.documentKind)}{' '}
                        <span className="badge info">draft v{d.versionNumber}</span>{' '}
                        <span className="text-muted">→ PDF</span>
                      </span>
                    </label>
                  )
                })}
                {docs.uploads.map((u) => (
                  <label key={`u${u.documentVersionId}`} className="mail-attach-item">
                    <input
                      type="checkbox"
                      checked={has('upload', u.documentVersionId)}
                      onChange={() =>
                        toggle({ kind: 'upload', id: u.documentVersionId, label: u.originalFilename })
                      }
                    />
                    <span>
                      {u.originalFilename}{' '}
                      <span className="text-muted">{fmtBytes(u.sizeBytes)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
