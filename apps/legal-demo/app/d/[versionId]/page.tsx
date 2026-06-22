'use client'

import { use, useEffect, useState } from 'react'
import { callClientMcp } from '@/lib/mcpClient'
import { downloadAsPdf, downloadAsWord } from '@/lib/draftExport'
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
    callClientMcp<{ draft: DraftPayload | null }>({
      toolName: 'legal.draft.get_shared',
      input: { documentVersionId: versionId },
    })
      .then((r) => {
        if (!r.draft) setError('This draft is no longer available.')
        else setDraft(r.draft)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
        <div className="loading-block">
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
            {new Date(draft.recordedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="public-draft-actions">
          <button onClick={() => downloadAsPdf(draft.bodyMarkdown, filename)}>Download PDF</button>
          <button onClick={() => downloadAsWord(draft.bodyMarkdown, filename)}>
            Download Word
          </button>
        </div>
      </div>
      <div
        className="doc-rendered"
        dangerouslySetInnerHTML={{ __html: renderDocumentHtml(draft.bodyMarkdown) }}
      />
    </div>
  )
}
