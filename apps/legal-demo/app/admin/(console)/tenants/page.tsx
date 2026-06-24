'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface TenantSummary {
  id: string
  name: string
  status: string
  createdAt: string
  reserved: boolean
}

const STATUS_BADGE: Record<string, string> = {
  active: 'ok',
  suspended: 'warn',
  archived: 'info',
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create form
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerDisplayName, setOwnerDisplayName] = useState('')
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const { tenants } = await callAdminMcp<{ tenants: TenantSummary[] }>({
        toolName: 'admin.tenant.list',
      })
      setTenants(tenants)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createTenant(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setCreateMsg(null)
    setError(null)
    try {
      const res = await callAdminMcp<{ tenantId: string }>({
        toolName: 'admin.tenant.bootstrap',
        input: { name, ownerEmail, ownerDisplayName: ownerDisplayName || undefined },
      })
      setCreateMsg(`Created tenant ${res.tenantId}. Owner signs in with ${ownerEmail}.`)
      setName('')
      setOwnerEmail('')
      setOwnerDisplayName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(tenantId: string, status: string) {
    setBusy(true)
    setError(null)
    try {
      await callAdminMcp({ toolName: 'admin.tenant.set_status', input: { tenantId, status } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-1)' }}>Tenants</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Every firm on the platform. Bootstrap a new one, or change a firm&apos;s status.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <section style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Create a tenant</h2>
        {createMsg && <div className="alert alert-success">{createMsg}</div>}
        <form
          onSubmit={createTenant}
          style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 480 }}
        >
          <label>
            Firm / tenant name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Legal LLC"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Owner email (their Google sign-in)
            <input
              required
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@acmelegal.com"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Owner display name (optional)
            <input
              value={ownerDisplayName}
              onChange={(e) => setOwnerDisplayName(e.target.value)}
              placeholder="Jane Owner"
              style={{ width: '100%' }}
            />
          </label>
          <button
            className="primary"
            type="submit"
            disabled={busy}
            style={{ justifySelf: 'start' }}
          >
            {busy ? 'Working…' : 'Bootstrap tenant'}
          </button>
        </form>
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Registry</h2>
      {!tenants && (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      )}
      {tenants && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    {t.reserved && (
                      <span className="badge info" style={{ marginLeft: 'var(--space-2)' }}>
                        reserved
                      </span>
                    )}
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{t.id}</div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[t.status] ?? 'info'}`}>{t.status}</span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    {t.reserved ? (
                      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        {t.status !== 'active' && (
                          <button disabled={busy} onClick={() => setStatus(t.id, 'active')}>
                            Activate
                          </button>
                        )}
                        {t.status !== 'suspended' && (
                          <button disabled={busy} onClick={() => setStatus(t.id, 'suspended')}>
                            Suspend
                          </button>
                        )}
                        {t.status !== 'archived' && (
                          <button disabled={busy} onClick={() => setStatus(t.id, 'archived')}>
                            Archive
                          </button>
                        )}
                      </div>
                    )}
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
