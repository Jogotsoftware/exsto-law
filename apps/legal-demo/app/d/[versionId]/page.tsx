'use client'

import { use, useEffect, useState } from 'react'
import { callClientMcp } from '@/lib/mcpClient'
import { callClientPortalMcp } from '@/lib/mcpClientPortal'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
import { formatDate } from '@/lib/datetime'
import { renderDocumentHtml } from '@/lib/documentHtml'

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

function humanizeKind(k: string): string {
  return k.replace(/_/g, ' ')
}

export default function PublicDraftPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params)
  const [draft, setDraft] = useState<DraftPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // PORTAL-1 (WP2): the bare public capability URL is closed. Three doors, in
    // order: the emailed link's signed ?t= token (public), the client portal
    // session, then the attorney session (internal preview links).
    const token = new URLSearchParams(window.location.search).get('t')
    const req = { toolName: 'legal.draft.get_shared' as const }
    const attempt = async (): Promise<{ draft: DraftPayload | null }> => {
      if (token) {
        return callClientMcp<{ draft: DraftPayload | null }>({
          ...req,
          input: { documentVersionId: versionId, token },
        })
      }
      try {
        return await callClientPortalMcp<{ draft: DraftPayload | null }>({
          ...req,
          input: { documentVersionId: versionId },
        })
      } catch {
        return callAttorneyMcp<{ draft: DraftPayload | null }>({
          ...req,
          input: { documentVersionId: versionId },
        })
      }
    }
    attempt()
      .then((r) => {
        if (!r.draft) setError('This draft is no longer available.')
        else setDraft(r.draft)
      })
      .catch(() =>
        setError(
          'This document needs a valid link or a signed-in portal session. Open it from your email link, or sign in to your client portal.',
        ),
      )
  }, [versionId])

  if (error) {
    return (
      <div className="public-draft">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }
  if (!draft) {
    return (
      <div className="public-draft">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )
  }

  const title = humanizeKind(draft.documentKind)
  const filename = `${title.replace(/\s+/g, '-').toLowerCase()}-${draft.matterNumber}`

  return (
    <div className="public-draft">
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>{title}</h1>
          <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
            Matter {draft.matterNumber} · v{draft.versionNumber} · generated{' '}
            {formatDate(draft.recordedAt)}
          </div>
        </div>
        <div className="public-draft-actions">
          <button onClick={() => downloadAsPdf(draft.bodyMarkdown, filename)}>Download PDF</button>
          <button onClick={() => downloadAsWord(draft.bodyMarkdown, filename)}>
            Download Word
          </button>
        </div>
      </div>
      {/* Same page treatment as the attorney review screen, so the client sees
          exactly the document that was approved (same renderer + .doc-paper page). */}
      <div className="doc-canvas">
        <article
          className="doc-rendered doc-paper"
          dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
        />
      </div>
    </div>
  )
}
