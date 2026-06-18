'use client'

// Client portal — "Documents to sign": the signed-in client's pending signature
// requests (delivered/opened). Authenticated via the portal session cookie.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callClientPortalMcp } from '@/lib/mcpClientPortal'

interface Pending {
  requestId: string
  envelopeId: string
  documentTitle: string | null
  status: string
}

export default function PortalSignList() {
  const [sigs, setSigs] = useState<Pending[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ signatures: Pending[] }>({ toolName: 'legal.esign.portal.list' })
      .then((r) => setSigs(r.signatures))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error)
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  if (!sigs)
    return (
      <div className="page">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )

  return (
    <div className="page">
      <h1>Documents to sign</h1>
      {sigs.length === 0 ? (
        <div className="alert">You have no documents awaiting your signature.</div>
      ) : (
        <ul className="card-list" style={{ marginTop: 'var(--space-3)' }}>
          {sigs.map((s) => (
            <li
              key={s.requestId}
              className="card row"
              style={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{s.documentTitle ?? 'Document'}</div>
                <div className="text-sm text-muted">Status: {s.status}</div>
              </div>
              <Link href={`/portal/sign/${s.requestId}`}>
                <button className="primary">Review &amp; sign →</button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
