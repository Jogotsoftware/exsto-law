'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDate } from '@/lib/datetime'
import { callAdminMcp } from '@/lib/mcpAdmin'
import { validatePublicSlug } from '@exsto/legal/slug'

interface TenantSummary {
  id: string
  name: string
  status: string
  createdAt: string
  reserved: boolean
  publicSlug: string | null
}

const STATUS_BADGE: Record<string, string> = {
  active: 'ok',
  suspended: 'warn',
  archived: 'info',
}

// The base domain firms hang off of. Display-only here (the server never trusts it);
// mirrors TENANT_BASE_DOMAIN, which isn't exposed to the client bundle.
const BASE_DOMAIN = 'instruments.legal'

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create form
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerDisplayName, setOwnerDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [createMsg, setCreateMsg] = useState<string | null>(null)

  // Per-row subdomain editor (one row at a time keeps the table stateless otherwise)
  const [editingSlugFor, setEditingSlugFor] = useState<string | null>(null)
  const [slugDraft, setSlugDraft] = useState('')

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

  // Client-side validation is a convenience only — the control-plane wrapper and the
  // SQL function both re-validate.
  const slugCheck = slug.trim() ? validatePublicSlug(slug) : null

  async function createTenant(e: React.FormEvent) {
    e.preventDefault()
    if (slugCheck && !slugCheck.ok) return
    setBusy(true)
    setCreateMsg(null)
    setError(null)
    try {
      const res = await callAdminMcp<{ tenantId: string }>({
        toolName: 'admin.tenant.bootstrap',
        input: {
          name,
          ownerEmail,
          ownerDisplayName: ownerDisplayName || undefined,
          slug: slug.trim() || undefined,
        },
      })
      setCreateMsg(
        `Created tenant ${res.tenantId}. Owner signs in with ${ownerEmail}.` +
          (slug.trim() ? ` Live at https://${slug.trim().toLowerCase()}.${BASE_DOMAIN}` : ''),
      )
      setName('')
      setOwnerEmail('')
      setOwnerDisplayName('')
      setSlug('')
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

  async function saveSlug(tenantId: string) {
    const next = slugDraft.trim()
    if (next) {
      const v = validatePublicSlug(next)
      if (!v.ok) {
        setError(v.error)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await callAdminMcp({
        toolName: 'admin.tenant.set_slug',
        // Omitting slug clears the subdomain (the tool schema is string-or-absent).
        input: next ? { tenantId, slug: next } : { tenantId },
      })
      setEditingSlugFor(null)
      setSlugDraft('')
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

      {error && <div className="alert alert-error">{error}</div>}

      <section style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Create A Tenant</h2>
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
          <label>
            Subdomain (optional)
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-legal"
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {slug.trim()
                ? slugCheck && !slugCheck.ok
                  ? slugCheck.error
                  : `Firm will be live at https://${slug.trim().toLowerCase()}.${BASE_DOMAIN}`
                : `Gives the firm its own site: {subdomain}.${BASE_DOMAIN}`}
            </span>
          </label>
          <button
            className="primary"
            type="submit"
            disabled={busy || Boolean(slugCheck && !slugCheck.ok)}
            style={{ justifySelf: 'start' }}
          >
            {busy ? 'Working…' : 'Bootstrap tenant'}
          </button>
        </form>
      </section>

      <h2 style={{ fontSize: '1.1rem' }}>Registry</h2>
      {!tenants && (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      )}
      {tenants && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Subdomain</th>
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
                        Reserved
                      </span>
                    )}
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{t.id}</div>
                  </td>
                  <td>
                    {editingSlugFor === t.id ? (
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <input
                          value={slugDraft}
                          onChange={(e) => setSlugDraft(e.target.value)}
                          placeholder="acme-legal"
                          style={{ width: 140 }}
                          autoFocus
                        />
                        <button disabled={busy} onClick={() => saveSlug(t.id)}>
                          Save
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditingSlugFor(null)
                            setSlugDraft('')
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : t.publicSlug ? (
                      <div>
                        <a
                          href={`https://${t.publicSlug}.${BASE_DOMAIN}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {t.publicSlug}.{BASE_DOMAIN}
                        </a>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[t.status] ?? 'info'}`}>{t.status}</span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{formatDate(t.createdAt)}</td>
                  <td>
                    {t.reserved ? (
                      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <button
                          disabled={busy}
                          onClick={() => {
                            // Renames break links already shared under the old subdomain —
                            // make the admin acknowledge that before editing an existing slug.
                            if (
                              t.publicSlug &&
                              !window.confirm(
                                `Changing or removing "${t.publicSlug}.${BASE_DOMAIN}" breaks any links already shared under it. Continue?`,
                              )
                            ) {
                              return
                            }
                            setEditingSlugFor(t.id)
                            setSlugDraft(t.publicSlug ?? '')
                          }}
                        >
                          {t.publicSlug ? 'Edit subdomain' : 'Set subdomain'}
                        </button>
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
