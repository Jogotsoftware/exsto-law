'use client'

// CRM Client › Activity tab — the audit timeline across all this client's
// matters. One read (legal.client.activity); the shared PersonActivityFeed
// renders it.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PersonActivityFeed, type PersonActivityHistory } from '@/components/PersonActivityFeed'

export default function ClientActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [history, setHistory] = useState<PersonActivityHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ history: PersonActivityHistory }>({
      toolName: 'legal.client.activity',
      input: { clientEntityId: id },
    })
      .then((r) => {
        if (!cancelled) setHistory(r.history)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) return <div className="alert alert-error">{error}</div>
  return <PersonActivityFeed history={history} loading={history === null} />
}
