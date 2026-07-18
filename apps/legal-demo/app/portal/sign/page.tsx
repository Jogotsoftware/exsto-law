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
      <div className="li-cp-shell">
        <div className="li-cp-main">
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    )
  if (!sigs)
    return (
      <div className="li-cp-shell">
        <div className="li-cp-main">
          <div className="loading-block" role="status">
            <span className="spinner" /> Loading…
          </div>
        </div>
      </div>
    )

  return (
    <div className="li-cp-shell">
      <div className="li-cp-main">
        <h1 className="li-cp-h1">Documents to sign</h1>
        {sigs.length === 0 ? (
          <section className="li-cp-card li-cp-list">
            <div className="li-cp-empty-row">You have no documents awaiting your signature.</div>
          </section>
        ) : (
          <section className="li-cp-card li-cp-list">
            {sigs.map((s) => (
              <div key={s.requestId} className="li-cp-sig-row">
                <span className="li-cp-sig-icon" aria-hidden>
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </span>
                <div className="li-cp-sig-main">
                  <span className="li-cp-sig-title">{s.documentTitle ?? 'Document'}</span>
                  <span className="li-cp-sig-meta">Status: {s.status}</span>
                </div>
                <Link className="li-cp-btn li-cp-btn--sm" href={`/portal/sign/${s.requestId}`}>
                  Review &amp; sign →
                </Link>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
