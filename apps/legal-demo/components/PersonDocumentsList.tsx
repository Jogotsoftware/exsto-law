'use client'

// Documents tab body for a CRM client or contact: every document across all
// their matters (generated drafts + uploaded files), each tagged with its
// matter. Fetched by the caller via legal.client.documents_all /
// legal.contact.documents (both return the same PersonDocumentItem shape). Read
// surface only — actions (review, download) live on the matter itself, so each
// row links through to the owning matter's Documents tab.
import Link from 'next/link'
import { formatDateTime } from '@/lib/datetime'
import { FileTextIcon, UploadIcon } from '@/components/icons'

export interface PersonDocumentItem {
  documentVersionId: string
  documentEntityId: string
  source: 'generated' | 'uploaded'
  title: string
  documentKind: string
  contentType: string
  sizeBytes: number
  status: string
  versionNumber: number | null
  matterEntityId: string
  matterNumber: string
  recordedAt: string
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

function fileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PersonDocumentsList({
  documents,
  loading,
}: {
  documents: PersonDocumentItem[] | null
  loading: boolean
}) {
  if (loading || documents === null) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading documents…
      </div>
    )
  }
  if (documents.length === 0) {
    return (
      <div className="li-mat-card">
        <div className="li-crm-panel-empty">
          No documents yet. Documents appear here once a matter drafts or receives a file.
        </div>
      </div>
    )
  }
  return (
    <div className="li-mat-card">
      <div className="li-mat-doclist">
        {documents.map((d) => (
          <Link
            key={`${d.source}:${d.documentVersionId}`}
            href={`/attorney/matters/${d.matterEntityId}/documents`}
            className="li-mat-docrow"
          >
            <span className="li-mat-docrow-icon">
              {d.source === 'uploaded' ? <UploadIcon size={16} /> : <FileTextIcon size={16} />}
            </span>
            <span className="li-mat-docrow-title">
              {d.title}
              <span className="li-crm-doc-matter">{d.matterNumber}</span>
            </span>
            <span className="li-mat-docrow-tag">
              {d.source === 'generated'
                ? `${humanizeStatus(d.status)}${d.versionNumber ? ` · v${d.versionNumber}` : ''}`
                : (fileSize(d.sizeBytes) ?? 'file')}
            </span>
            <span className="li-mat-docrow-date">{formatDateTime(d.recordedAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
