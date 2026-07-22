'use client'

// CRM Client › Documents tab — every document across all this client's matters
// (generated drafts + uploaded files). One read (legal.client.documents_all);
// the shared PersonDocumentsList renders it. Chrome (back, header, tabs) is the
// detail layout.
import { use, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PersonDocumentsList, type PersonDocumentItem } from '@/components/PersonDocumentsList'

export default function ClientDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [documents, setDocuments] = useState<PersonDocumentItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ documents: PersonDocumentItem[] }>({
      toolName: 'legal.client.documents_all',
      input: { clientEntityId: id },
    })
      .then((r) => {
        if (!cancelled) setDocuments(r.documents)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (error) return <div className="alert alert-error">{error}</div>
  return <PersonDocumentsList documents={documents} loading={documents === null} />
}
