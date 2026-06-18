'use client'

// Attorney signing-status view: the envelope's overall state plus each signer's
// progress (pending → delivered → opened → signed/declined) in signing order.
import { use, useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface SignerStatus {
  requestId: string
  name: string | null
  email: string | null
  title: string | null
  order: number
  channel: string | null
  status: string
  signedAt: string | null
}
interface EnvelopeStatus {
  envelopeId: string
  status: string | null
  subject: string | null
  signers: SignerStatus[]
}

const STEP = ['pending', 'delivered', 'opened', 'signed']
function badge(status: string): string {
  if (status === 'signed') return 'badge ok'
  if (status === 'declined') return 'badge danger'
  if (status === 'opened') return 'badge warn'
  if (status === 'delivered') return 'badge'
  return 'badge muted'
}

export default function SignStatusPage({ params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = use(params)
  const [env, setEnv] = useState<EnvelopeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    callAttorneyMcp<EnvelopeStatus>({ toolName: 'legal.esign.status', input: { envelopeId } })
      .then(setEnv)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [envelopeId])

  useEffect(() => {
    load()
  }, [load])

  if (error)
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  if (!env)
    return (
      <div className="page">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </div>
    )

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Signing status</h1>
        <button onClick={load}>Refresh</button>
      </div>
      <div className="text-sm text-muted">{env.subject}</div>
      <div style={{ margin: 'var(--space-2) 0' }}>
        Envelope: <span className={badge(env.status ?? 'pending')}>{env.status ?? 'pending'}</span>
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
