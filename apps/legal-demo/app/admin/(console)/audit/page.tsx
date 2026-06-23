'use client'

import { useEffect, useState } from 'react'
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
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Control-plane audit</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Every cross-tenant control-plane operation: who did what, against which tenant.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!entries && !error && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {entries && entries.length === 0 && <p style={{ color: 'var(--muted)' }}>No entries yet.</p>}
      {entries && entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border, #e5e7eb)' }}>
              <th style={{ padding: '0.5rem' }}>When</th>
              <th style={{ padding: '0.5rem' }}>Operation</th>
              <th style={{ padding: '0.5rem' }}>Target tenant</th>
              <th style={{ padding: '0.5rem' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                  {new Date(e.recordedAt).toLocaleString()}
                </td>
                <td style={{ padding: '0.5rem', fontWeight: 600 }}>{e.operation}</td>
                <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                  {e.targetTenantId ?? '—'}
                </td>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {JSON.stringify({ ...e.payload, ...(e.result ?? {}) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
