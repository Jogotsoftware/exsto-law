'use client'

import { useEffect, useState } from 'react'
import { formatDateTime } from '@/lib/datetime'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface AuditEntry {
  id: string
  platformActorId: string
  operation: string
  targetTenantId: string | null
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  recordedAt: string
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callAdminMcp<{ entries: AuditEntry[] }>({
      toolName: 'admin.audit.control_plane',
      input: { limit: 200 },
    })
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <main style={{ maxWidth: 1040 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-1)' }}>Control-Plane Audit</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Every cross-tenant control-plane operation: who did what, against which tenant.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!entries && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}
      {entries && entries.length === 0 && <p style={{ color: 'var(--muted)' }}>No entries yet.</p>}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Operation</th>
                <th>Target Tenant</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.recordedAt)}</td>
                  <td style={{ fontWeight: 600 }}>{e.operation}</td>
                  <td style={{ fontSize: 'var(--text-xs)' }}>{e.targetTenantId ?? '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>
                    {JSON.stringify({ ...e.payload, ...(e.result ?? {}) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
