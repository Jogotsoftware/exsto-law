'use client'

// The signing-status table — the envelope's overall state plus each signer's
// progress (pending → delivered → opened → signed/declined) in signing order.
// Extracted so it embeds in both the standalone /attorney/sign/status page and the
// signature-task window. Self-fetching; `onLoaded` hands the parent the full status
// (including the executed copy id) so the task window can advance to its review step.
import { useCallback, useEffect, useRef, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

export interface EnvelopeSignerStatus {
  requestId: string
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  signedAt: string | null
}
export interface EnvelopeStatus {
  envelopeId: string
  status: string | null
  subject: string | null
  signers: EnvelopeSignerStatus[]
  documentEntityId: string | null
  executedDocumentVersionId: string | null
}

const STEP = ['pending', 'delivered', 'opened', 'signed']
function badge(status: string): string {
  if (status === 'signed') return 'badge ok'
  if (status === 'declined') return 'badge danger'
  if (status === 'opened') return 'badge warn'
  if (status === 'delivered') return 'badge'
  return 'badge muted'
}

export function EnvelopeStatusView({
  envelopeId,
  onLoaded,
  showRefresh = true,
}: {
  envelopeId: string
  onLoaded?: (env: EnvelopeStatus) => void
  showRefresh?: boolean
}) {
  const [env, setEnv] = useState<EnvelopeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Keep the callback in a ref so an inline parent `onLoaded` doesn't re-key `load`
  // (which would refetch on every render).
  const onLoadedRef = useRef(onLoaded)
  onLoadedRef.current = onLoaded

  const load = useCallback(() => {
    callAttorneyMcp<EnvelopeStatus>({ toolName: 'legal.esign.status', input: { envelopeId } })
      .then((e) => {
        setEnv(e)
        onLoadedRef.current?.(e)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [envelopeId])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <div className="alert alert-error">{error}</div>
  if (!env)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div className="text-sm text-muted">{env.subject}</div>
          <div style={{ margin: 'var(--space-2) 0' }}>
            Envelope:{' '}
            <span className={badge(env.status ?? 'pending')}>{env.status ?? 'pending'}</span>
          </div>
        </div>
        {showRefresh && <button onClick={load}>Refresh</button>}
      </div>

      <table className="table" style={{ marginTop: 'var(--space-2)' }}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Signer</th>
            <th>Title</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Signed</th>
          </tr>
        </thead>
        <tbody>
          {env.signers.map((s) => (
            <tr key={s.requestId}>
              <td>{s.order}</td>
              <td>
                {s.name ?? s.email}
                <div className="text-sm text-muted">{s.email}</div>
              </td>
              <td>{s.title ?? '—'}</td>
              <td>{s.channel === 'portal' ? 'Client portal' : 'Email link'}</td>
              <td>
                <span className={badge(s.status)}>{s.status}</span>
              </td>
              <td>{s.signedAt ? new Date(s.signedAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted" style={{ marginTop: 'var(--space-2)' }}>
        Progress: {STEP.join(' → ')} (or declined). Sequential signers become “delivered” only when
        prior signers finish.
      </p>
    </div>
  )
}
