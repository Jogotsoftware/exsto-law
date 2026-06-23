'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface TenantSummary {
  id: string
  name: string
  status: string
  reserved: boolean
}
interface ServiceDiff {
  kindName: string
  displayName: string
  status: 'new' | 'changed' | 'identical'
  sourceVersion: number
  targetVersion: number | null
}

const STATUS_COLOR: Record<string, string> = {
  new: '#16a34a',
  changed: '#d97706',
  identical: '#6b7280',
}

export default function AdminSandboxPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([])
  const [targetId, setTargetId] = useState('')
  const [diff, setDiff] = useState<ServiceDiff[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    callAdminMcp<{ tenants: TenantSummary[] }>({ toolName: 'admin.tenant.list' })
      .then((r) => setTenants(r.tenants))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const runDiff = useCallback(async (tid: string) => {
    setDiff(null)
    setSelected(new Set())
    setMsg(null)
    if (!tid) return
    setError(null)
    try {
      const r = await callAdminMcp<{ diff: ServiceDiff[] }>({
        toolName: 'admin.promote.diff',
        input: { sourceTenantId: undefined, targetTenantId: tid },
      })
      setDiff(r.diff)
      // Pre-select everything that differs.
      setSelected(new Set(r.diff.filter((d) => d.status !== 'identical').map((d) => d.kindName)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    runDiff(targetId)
  }, [targetId, runDiff])

  function toggle(kindName: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(kindName)) next.delete(kindName)
      else next.add(kindName)
      return next
    })
  }

  async function promote() {
    if (!targetId || selected.size === 0) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await callAdminMcp({
        toolName: 'admin.promote.run',
        input: { targetTenantIds: [targetId], kindNames: [...selected] },
      })
      setMsg(`Promoted ${selected.size} service(s).`)
      await runDiff(targetId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Sandbox</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Build and test anything in the sandbox workspace, then promote services to production
        tenants.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <section
        style={{
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Build</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Enter the sandbox workspace (the full firm app, all modules enabled) to build and test.
        </p>
        <form action="/admin/api/sandbox/enter" method="POST" style={{ margin: 0 }}>
          <button className="primary" type="submit">
            Enter sandbox workspace →
          </button>
        </form>
      </section>

      <section
        style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '1rem' }}
      >
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Promote services</h2>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Target tenant
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ display: 'block', minWidth: 320, marginTop: 4 }}
          >
            <option value="">Select a production firm…</option>
            {tenants
              .filter((t) => !t.reserved)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
          </select>
        </label>

        {diff && diff.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No services in the sandbox to promote yet.</p>
        )}
        {diff && diff.length > 0 && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border, #e5e7eb)' }}>
                  <th style={{ padding: '0.5rem' }}>Promote</th>
                  <th style={{ padding: '0.5rem' }}>Service</th>
                  <th style={{ padding: '0.5rem' }}>Change</th>
                  <th style={{ padding: '0.5rem' }}>Versions</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.kindName} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(d.kindName)}
                        disabled={d.status === 'identical'}
                        onChange={() => toggle(d.kindName)}
                      />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <strong>{d.displayName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{d.kindName}</div>
                    </td>
                    <td
                      style={{ padding: '0.5rem', fontWeight: 600, color: STATUS_COLOR[d.status] }}
                    >
                      {d.status}
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>
                      sandbox v{d.sourceVersion} → target{' '}
                      {d.targetVersion === null ? '—' : `v${d.targetVersion}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="primary" disabled={busy || selected.size === 0} onClick={promote}>
              {busy ? 'Promoting…' : `Promote ${selected.size} selected →`}
            </button>
          </>
        )}
      </section>
    </main>
  )
}
