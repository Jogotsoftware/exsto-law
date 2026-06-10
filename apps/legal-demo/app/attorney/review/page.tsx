'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface PendingDraft {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
}

export default function ReviewQueue() {
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ drafts: PendingDraft[] }>({ toolName: 'legal.draft.list_pending' })
      .then((res) => setDrafts(res.drafts))
      .catch((err) => setError(err.message))
  }, [])

  return (
    <main>
      <h1>Review queue</h1>
      {error && <pre>{error}</pre>}
      {drafts === null && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {drafts && drafts.length === 0 && (
        <section>
          <p>No drafts pending review.</p>
        </section>
      )}
      {drafts && drafts.length > 0 && (
        <section style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Matter</th>
                <th>Document kind</th>
                <th>Version</th>
                <th>Generated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.documentVersionId}>
                  <td>{d.matterNumber}</td>
                  <td>{d.documentKind}</td>
                  <td>v{d.versionNumber}</td>
                  <td>{new Date(d.recordedAt).toLocaleString()}</td>
                  <td>
                    <Link href={`/attorney/review/${d.documentVersionId}`}>Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
