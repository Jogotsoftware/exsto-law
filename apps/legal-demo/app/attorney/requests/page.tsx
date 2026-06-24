'use client'

// Client requests inbox. Active (non-terminal) requests clients submitted from the
// portal — each already cost-accepted by the client. The attorney accepts, starts,
// fulfils (which records the accepted amount as a matter fee → next invoice), or
// declines. Reads legal.client_request.list_pending; writes the lifecycle tools.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { PageHead } from '@/components/PageHead'

interface AttorneyRequest {
  requestEntityId: string
  requestType: string
  status: string
  description: string
  amount: string
  currency: string
  priceBasis: string
  createdAt: string
  matterEntityId: string | null
  matterNumber: string | null
  clientName: string
}

const TYPE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  document: 'Document',
  review: 'Attorney review',
}
const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  in_progress: 'In progress',
}

function money(amount: string, currency: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${amount} ${currency}`
  }
}

export default function ClientRequestsPage() {
  const [requests, setRequests] = useState<AttorneyRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ requests: AttorneyRequest[] }>({
        toolName: 'legal.client_request.list_pending',
      })
      setRequests(r.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRequests([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = useCallback(
    async (id: string, tool: string) => {
      if (busyId) return // guard against a concurrent double-click (no double-action)
      setBusyId(id)
      setError(null)
      try {
        await callAttorneyMcp({ toolName: tool, input: { requestEntityId: id } })
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    },
    [load, busyId],
  )

  return (
    <main>
      <PageHead
        title="Client requests"
        description="Requests clients submitted from the portal — each already cost-accepted. Fulfilling one records its amount as a matter fee."
      />

      {error && <div className="alert alert-error">{error}</div>}

      {requests === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : requests.length === 0 ? (
        <p className="text-muted">No open client requests.</p>
      ) : (
        <div className="matter-list">
          {requests.map((r) => {
            const busy = busyId === r.requestEntityId
            return (
              <div
                key={r.requestEntityId}
                className="matter-row"
                style={{ alignItems: 'flex-start' }}
              >
                <div style={{ flex: 1 }}>
                  <div className="matter-row-title">
                    {TYPE_LABEL[r.requestType] ?? r.requestType} · {money(r.amount, r.currency)}
                    <span className="text-sm text-muted">
                      {' '}
                      · {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="matter-row-sub">
                    {r.clientName || 'Client'}
                    {r.matterNumber && r.matterEntityId && (
                      <>
                        {' · '}
                        <Link href={`/attorney/matters/${r.matterEntityId}`}>{r.matterNumber}</Link>
                      </>
                    )}
                    {r.priceBasis && ` · ${r.priceBasis}`}
                  </div>
                  {r.description && (
                    <div className="matter-row-sub" style={{ marginTop: '0.3rem' }}>
                      “{r.description}”
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {r.status === 'requested' && (
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => act(r.requestEntityId, 'legal.client_request.accept')}
                    >
                      Accept
                    </button>
                  )}
                  {(r.status === 'requested' || r.status === 'accepted') && (
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => act(r.requestEntityId, 'legal.client_request.start')}
                    >
                      Start
                    </button>
                  )}
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => act(r.requestEntityId, 'legal.client_request.fulfill')}
                  >
                    Fulfil
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => act(r.requestEntityId, 'legal.client_request.decline')}
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
