'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAdminMcp } from '@/lib/mcpAdmin'

interface TenantSummary {
  id: string
  name: string
  status: string
  reserved: boolean
}
interface TenantModuleState {
  moduleKey: string
  displayName: string
  description: string | null
  uiAreas: string[]
  enabled: boolean
}

export default function AdminModulesPage() {
  const [tenants, setTenants] = useState<TenantSummary[]>([])
  const [tenantId, setTenantId] = useState<string>('')
  const [modules, setModules] = useState<TenantModuleState[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    callAdminMcp<{ tenants: TenantSummary[] }>({ toolName: 'admin.tenant.list' })
      .then((r) => setTenants(r.tenants))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const loadModules = useCallback(async (tid: string) => {
    if (!tid) {
      setModules(null)
      return
    }
    setError(null)
    try {
      const r = await callAdminMcp<{ modules: TenantModuleState[] }>({
        toolName: 'admin.module.enablement',
        input: { tenantId: tid },
      })
      setModules(r.modules)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    loadModules(tenantId)
  }, [tenantId, loadModules])

  async function toggle(moduleKey: string, enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      await callAdminMcp({
        toolName: enabled ? 'admin.module.disable' : 'admin.module.enable',
        input: { tenantId, moduleKey },
      })
      await loadModules(tenantId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Modules</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Turn feature bundles on or off for a firm. Disabling hides the feature&apos;s UI but keeps
        its data.
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

      {modules && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border, #e5e7eb)' }}>
              <th style={{ padding: '0.5rem' }}>Module</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.moduleKey} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                <td style={{ padding: '0.5rem' }}>
                  <strong>{m.displayName}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{m.description}</div>
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{ color: m.enabled ? '#16a34a' : '#6b7280', fontWeight: 600 }}>
                    {m.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td style={{ padding: '0.5rem' }}>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => toggle(m.moduleKey, m.enabled)}
                  >
                    {m.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
