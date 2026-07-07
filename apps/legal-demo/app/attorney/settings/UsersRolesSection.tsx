'use client'

// User management (S9 — WP9.3). The owning attorney (firm.admin) adds firm
// users, assigns roles, and deactivates accounts. Every write goes to the
// operation core via the legal.user.* MCP tools; the admin gate is enforced
// server-side (requireAdmin) — this page only shows/hides for convenience.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { CollapsibleSection } from '@/components/CollapsibleSection'

interface FirmUser {
  actorId: string
  email: string | null
  displayName: string
  status: string
  scopes: string[]
  role: string | null
  rank: number
}
interface FirmRole {
  roleName: string
  displayName: string
  description: string | null
  scopeNames: string[]
  rank: number
}
interface WhoAmI {
  actorId: string
  isAdmin: boolean
  role: string | null
  rank: number
}

export function UsersRolesSection() {
  const [me, setMe] = useState<WhoAmI | null>(null)
  const [users, setUsers] = useState<FirmUser[] | null>(null)
  const [roles, setRoles] = useState<FirmRole[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  async function load() {
    setError(null)
    try {
      const who = await callAttorneyMcp<WhoAmI>({ toolName: 'legal.user.me' })
      setMe(who)
      if (!who.isAdmin) {
        setUsers([])
        return
      }
      const r = await callAttorneyMcp<{ users: FirmUser[]; roles: FirmRole[] }>({
        toolName: 'legal.user.list',
      })
      setUsers(r.users)
      setRoles(r.roles)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function changeRole(actorId: string, roleName: string) {
    setBusyId(actorId)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.user.assign_role', input: { actorId, roleName } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function deactivate(actorId: string) {
    if (!confirm('Deactivate this user? They will lose access immediately.')) return
    setBusyId(actorId)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.user.deactivate', input: { actorId } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <CollapsibleSection title="Users & roles">
      {error && <div className="alert alert-error">{error}</div>}

      {me && !me.isAdmin && (
        <div className="empty-block">Only the firm owner (admin) can manage users.</div>
      )}

      {me?.isAdmin && (
        <section className="section-flush">
          <div
            className="client-search-row"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span className="text-muted text-xs">
              {users ? `${users.filter((u) => u.status === 'active').length} active` : ' '}
            </span>
            <button className="primary" onClick={() => setShowInvite(true)}>
              + Invite user
            </button>
          </div>

          {users === null && (
            <div className="loading-block" role="status">
              <span className="spinner" /> Loading…
            </div>
          )}

          {users && users.length > 0 && (
            <table className="client-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.actorId === me.actorId
                  // You can only manage someone strictly below your own rank — the
                  // same rule the operation core enforces server-side.
                  const manageable = !isSelf && u.rank < me.rank
                  return (
                    <tr key={u.actorId} style={{ opacity: u.status === 'active' ? 1 : 0.5 }}>
                      <td>
                        {u.displayName}
                        {isSelf && <span className="text-xs text-muted"> (you)</span>}
                      </td>
                      <td className="text-muted">{u.email ?? '—'}</td>
                      <td>
                        <select
                          value={roles.find((r) => r.displayName === u.role)?.roleName ?? ''}
                          disabled={busyId === u.actorId || u.status !== 'active' || !manageable}
                          onChange={(e) => changeRole(u.actorId, e.target.value)}
                        >
                          <option value="" disabled>
                            {u.role ?? '(custom / unrestricted)'}
                          </option>
                          {roles
                            .filter((r) => r.rank < me.rank)
                            .map((r) => (
                              <option key={r.roleName} value={r.roleName}>
                                {r.displayName}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <span className={`badge ${u.status === 'active' ? 'ok' : ''}`}>
                          {u.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {u.status === 'active' && manageable && (
                          <button
                            className="danger outline"
                            disabled={busyId === u.actorId}
                            onClick={() => deactivate(u.actorId)}
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {showInvite && (
        <InviteModal
          roles={roles}
          maxRank={me?.rank ?? 0}
          onClose={() => setShowInvite(false)}
          onDone={() => {
            setShowInvite(false)
            void load()
          }}
        />
      )}
    </CollapsibleSection>
  )
}

function InviteModal({
  roles,
  maxRank,
  onClose,
  onDone,
}: {
  roles: FirmRole[]
  maxRank: number
  onClose: () => void
  onDone: () => void
}) {
  // You can only grant roles below your own rank.
  const grantable = roles.filter((r) => r.rank < maxRank)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roleName, setRoleName] = useState(
    grantable.find((r) => r.roleName === 'firm.paralegal')?.roleName ??
      grantable[0]?.roleName ??
      '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!email.trim()) {
      setError('Enter the user’s email (their sign-in identity).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.user.invite',
        input: { email: email.trim(), displayName: displayName.trim(), roleName },
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Invite user</h2>
          <button onClick={onClose} aria-label="Close" className="modal-close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="text-muted">
            The email is the user’s sign-in identity (they sign in with that Google account).
          </p>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@firm.com"
              autoFocus
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Paralegal"
            />
          </label>
          <label>
            <span>Role</span>
            <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
              {grantable.map((r) => (
                <option key={r.roleName} value={r.roleName}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="alert alert-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Adding…' : 'Add user'}
          </button>
        </div>
      </div>
    </div>
  )
}
