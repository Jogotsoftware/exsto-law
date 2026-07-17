'use client'

// Settings → Users & roles (WP-G). Split out of the old settings monolith —
// same legal.user.* MCP tools (admin-gated server-side via requireAdmin),
// restyled to the comp's avatar-row list with a header-level "Invite user"
// action. Keeps the app's richer per-row role SELECT + Deactivate button
// (the comp shows a bare kebab menu) — no capability dropped, just presented
// inline instead of behind a hidden menu.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function UsersRolesPage(): React.ReactElement {
  const [me, setMe] = useState<WhoAmI | null>(null)
  const [users, setUsers] = useState<FirmUser[] | null>(null)
  const [roles, setRoles] = useState<FirmRole[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  async function load(): Promise<void> {
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

  async function changeRole(actorId: string, roleName: string): Promise<void> {
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

  async function deactivate(actorId: string): Promise<void> {
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
    <>
      <SettingsHeader
        title="Users & roles"
        actions={
          me?.isAdmin ? (
            <button className="li-set-btn li-set-btn-primary" onClick={() => setShowInvite(true)}>
              + Invite user
            </button>
          ) : undefined
        }
      />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      {me && !me.isAdmin && (
        <div className="li-set-card li-set-card--medium">
          Only the firm owner (admin) can manage users.
        </div>
      )}

      {me?.isAdmin && (
        <div className="li-set-card li-set-card--medium li-set-card--flush">
          <div className="li-set-toolbar">
            <span className="li-set-toolbar-count">
              {users ? `${users.filter((u) => u.status === 'active').length} active` : ' '}
            </span>
          </div>

          {users === null && <SettingsLoading />}

          {users &&
            users.map((u) => {
              const isSelf = u.actorId === me.actorId
              // You can only manage someone strictly below your own rank — the
              // same rule the operation core enforces server-side.
              const manageable = !isSelf && u.rank < me.rank
              return (
                <div
                  key={u.actorId}
                  className="li-set-user-row"
                  style={{ opacity: u.status === 'active' ? 1 : 0.55 }}
                >
                  <span className="li-set-user-avatar">{initials(u.displayName)}</span>
                  <div className="li-set-user-main">
                    <div className="li-set-user-name">
                      {u.displayName}
                      {isSelf && (
                        <span className="li-set-hint" style={{ margin: 0 }}>
                          &nbsp;(you)
                        </span>
                      )}
                    </div>
                    <div className="li-set-user-email">{u.email ?? '—'}</div>
                  </div>
                  <div className="li-set-user-controls">
                    <select
                      className="li-set-select"
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
                    <span
                      className={`li-set-role-pill${u.status !== 'active' ? ' is-inactive' : ''}`}
                    >
                      {u.status}
                    </span>
                    {u.status === 'active' && manageable && (
                      <button
                        className="li-set-btn li-set-btn-danger li-set-btn-sm"
                        disabled={busyId === u.actorId}
                        onClick={() => deactivate(u.actorId)}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
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
    </>
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
}): React.ReactElement {
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

  async function save(): Promise<void> {
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
    <div className="li-modal-backdrop" onClick={onClose}>
      <div className="li-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="li-modal-head">
          <h2>Invite user</h2>
          <button onClick={onClose} aria-label="Close" className="li-modal-close">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="li-modal-body">
          <p className="li-modal-muted">
            The email is the user’s sign-in identity (they sign in with that Google account).
          </p>
          <label className="li-modal-field">
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
          <label className="li-modal-field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Paralegal"
            />
          </label>
          <label className="li-modal-field">
            <span>Role</span>
            <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
              {grantable.map((r) => (
                <option key={r.roleName} value={r.roleName}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="li-modal-alert">{error}</div>}
        </div>
        <div className="li-modal-foot">
          <button className="li-modal-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="li-set-btn li-set-btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Adding…' : 'Add user'}
          </button>
        </div>
      </div>
    </div>
  )
}
