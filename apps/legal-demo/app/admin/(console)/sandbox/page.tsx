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
interface TemplateDiff {
  key: string
  name: string
  category: 'document' | 'email'
  status: 'new' | 'changed' | 'identical'
}

const STATUS_COLOR: Record<string, string> = {
  new: 'var(--ok)',
  changed: 'var(--warn)',
  identical: 'var(--muted)',
}

export default function AdminSandboxPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([])
  const [targetId, setTargetId] = useState('')
  const [diff, setDiff] = useState<ServiceDiff[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tplDiff, setTplDiff] = useState<TemplateDiff[] | null>(null)
  const [tplSelected, setTplSelected] = useState<Set<string>>(new Set())
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
    setTplDiff(null)
    setTplSelected(new Set())
    setMsg(null)
    if (!tid) return
    setError(null)
    try {
      const [svc, tpl] = await Promise.all([
        callAdminMcp<{ diff: ServiceDiff[] }>({
          toolName: 'admin.promote.diff',
          input: { sourceTenantId: undefined, targetTenantId: tid },
        }),
        callAdminMcp<{ diff: TemplateDiff[] }>({
          toolName: 'admin.promote.templates.diff',
          input: { sourceTenantId: undefined, targetTenantId: tid },
        }),
      ])
      setDiff(svc.diff)
      setSelected(new Set(svc.diff.filter((d) => d.status !== 'identical').map((d) => d.kindName)))
      setTplDiff(tpl.diff)
      setTplSelected(new Set(tpl.diff.filter((d) => d.status !== 'identical').map((d) => d.key)))
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

  function toggleTpl(key: string) {
    setTplSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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

  async function promoteTpls() {
    if (!targetId || tplSelected.size === 0) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await callAdminMcp({
        toolName: 'admin.promote.templates.run',
        input: { targetTenantIds: [targetId], keys: [...tplSelected] },
      })
      setMsg(`Promoted ${tplSelected.size} template(s).`)
      await runDiff(targetId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-1)' }}>Sandbox</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Build and test anything in the sandbox workspace, then promote services to production
        tenants.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <section style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Build</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Enter the sandbox workspace (the full firm app, all modules enabled) to build and test.
        </p>
        <form action="/admin/api/sandbox/enter" method="POST" style={{ margin: 0 }}>
          <button className="primary" type="submit">
            Enter sandbox workspace →
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Promote services</h2>
        <label style={{ display: 'block', marginBottom: 'var(--space-4)' }}>
          Target tenant
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            style={{ display: 'block', minWidth: 320, marginTop: 'var(--space-1)' }}
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
            <div className="table-wrap" style={{ marginBottom: 'var(--space-4)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Promote</th>
                    <th>Service</th>
                    <th>Change</th>
                    <th>Versions</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => (
                    <tr key={d.kindName}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(d.kindName)}
                          disabled={d.status === 'identical'}
                          onChange={() => toggle(d.kindName)}
                        />
                      </td>
                      <td>
                        <strong>{d.displayName}</strong>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                          {d.kindName}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600, color: STATUS_COLOR[d.status] }}>{d.status}</td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>
                        sandbox v{d.sourceVersion} → target{' '}
                        {d.targetVersion === null ? '—' : `v${d.targetVersion}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="primary" disabled={busy || selected.size === 0} onClick={promote}>
              {busy ? 'Promoting…' : `Promote ${selected.size} selected →`}
            </button>
          </>
        )}
      </section>

      <section style={{ marginTop: 'var(--space-5)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Promote document &amp; email templates</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          The firm&apos;s reusable template library (select a target firm above).
        </p>
        {!targetId && (
          <p style={{ color: 'var(--muted)' }}>Select a target tenant to see templates.</p>
        )}
        {tplDiff && tplDiff.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No templates in the sandbox to promote yet.</p>
        )}
        {tplDiff && tplDiff.length > 0 && (
          <>
            <div className="table-wrap" style={{ marginBottom: 'var(--space-4)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Promote</th>
                    <th>Template</th>
                    <th>Category</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {tplDiff.map((d) => (
                    <tr key={d.key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={tplSelected.has(d.key)}
                          disabled={d.status === 'identical'}
                          onChange={() => toggleTpl(d.key)}
                        />
                      </td>
                      <td>
                        <strong>{d.name}</strong>
                      </td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>{d.category}</td>
                      <td style={{ fontWeight: 600, color: STATUS_COLOR[d.status] }}>{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="primary"
              disabled={busy || tplSelected.size === 0}
              onClick={promoteTpls}
            >
              {busy ? 'Promoting…' : `Promote ${tplSelected.size} selected →`}
            </button>
          </>
        )}
      </section>
    </main>
  )
}
