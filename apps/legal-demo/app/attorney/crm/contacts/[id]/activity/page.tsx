'use client'

// CRM Contact › Activity tab — the audit timeline across all this contact's
// matters. One read (legal.contact.activity); rendered by PersonActivityFeed.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PersonActivityFeed, type PersonActivityHistory } from '@/components/PersonActivityFeed'

export default function ContactActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [history, setHistory] = useState<PersonActivityHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ history: PersonActivityHistory }>({
      toolName: 'legal.contact.activity',
      input: { contactEntityId: id },
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
