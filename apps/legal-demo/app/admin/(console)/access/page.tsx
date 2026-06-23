'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface TenantSummary {
  id: string
  name: string
  status: string
  reserved: boolean
}
interface FirmUser {
  actorId: string
  email: string | null
  displayName: string
  status: string
  role: string | null
  rank: number
}
interface FirmRole {
  roleName: string
  displayName: string
  rank: number
}

export default function AdminAccessPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([])
  const [tenantId, setTenantId] = useState('')
  const [users, setUsers] = useState<FirmUser[]>([])
  const [roles, setRoles] = useState<FirmRole[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // invite form
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roleName, setRoleName] = useState('')

  useEffect(() => {
    callAdminMcp<{ tenants: TenantSummary[] }>({ toolName: 'admin.tenant.list' })
      .then((r) => setTenants(r.tenants))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const load = useCallback(async (tid: string) => {
    setLoaded(false)
    setUsers([])
    setRoles([])
    if (!tid) return
    setError(null)
    try {
      const r = await callAdminMcp<{ users: FirmUser[]; roles: FirmRole[] }>({
        toolName: 'admin.access.users',
        input: { tenantId: tid },
      })
      setUsers(r.users)
      setRoles(r.roles)
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    load(tenantId)
  }, [tenantId, load])

  async function act<T>(fn: () => Promise<T>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load(tenantId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    await act(async () => {
      await callAdminMcp({
        toolName: 'admin.access.invite',
        input: {
          tenantId,
          email,
          displayName: displayName || undefined,
          roleName: roleName || undefined,
        },
      })
      setEmail('')
      setDisplayName('')
      setRoleName('')
    })
  }

  return (
    <main style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Access</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Manage a firm&apos;s users and roles. Changes run as audited firm actions.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Tenant
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          style={{ display: 'block', minWidth: 320, marginTop: 4 }}
        >
          <option value="">Select a firm…</option>
          {tenants
            .filter((t) => !t.reserved)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status})
              </option>
            ))}
        </select>
      </label>

      {loaded && (
        <>
          <section
            style={{
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 8,
              padding: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Invite a user</h2>
            <form onSubmit={invite} style={{ display: 'grid', gap: '0.6rem', maxWidth: 460 }}>
              <input
                required
                type="email"
                placeholder="email@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                placeholder="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                <option value="">Role…</option>
                {roles.map((r) => (
                  <option key={r.roleName} value={r.roleName}>
                    {r.displayName}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                type="submit"
                disabled={busy}
                style={{ justifySelf: 'start' }}
              >
                Invite
              </button>
            </form>
          </section>

          <h2 style={{ fontSize: '1.1rem' }}>Users</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border, #e5e7eb)' }}>
                <th style={{ padding: '0.5rem' }}>User</th>
                <th style={{ padding: '0.5rem' }}>Role</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.actorId} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <strong>{u.displayName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <select
                      value={roles.find((r) => r.displayName === u.role)?.roleName ?? ''}
                      disabled={busy}
                      onChange={(e) =>
                        act(() =>
                          callAdminMcp({
                            toolName: 'admin.access.assign_role',
                            input: { tenantId, actorId: u.actorId, roleName: e.target.value },
                          }),
                        )
                      }
                    >
                      <option value="">{u.role ?? '—'}</option>
                      {roles.map((r) => (
                        <option key={r.roleName} value={r.roleName}>
                          {r.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{u.status}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {u.status === 'active' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            callAdminMcp({
                              toolName: 'admin.access.deactivate',
                              input: { tenantId, actorId: u.actorId },
                            }),
                          )
                        }
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}
