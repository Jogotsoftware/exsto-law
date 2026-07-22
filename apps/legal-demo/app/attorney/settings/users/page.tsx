'use client'

// Settings → Users & roles (WP-G, split into two tabs 2026-07-21). Firm users
// (actors with roles) and Portal users (client contacts with portal accounts)
// are different populations with different controls, so they get separate tabs
// — the old single list rendered portal actors as noise rows with meaningless
// role dropdowns. Same legal.user.* MCP tools (admin-gated server-side via
// requireAdmin); the portal tab adds legal.user.portal_list /
// set_portal_user_type and the login-only delete route.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Tabs } from '@/components/Tabs'
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
interface PortalUser {
  contactEntityId: string
  fullName: string
  email: string
  companyName: string | null
  userType: 'standard' | 'self_serve'
  portalStatus: string
  provisionedAt: string
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
  const [portalUsers, setPortalUsers] = useState<PortalUser[] | null>(null)
  const [tab, setTab] = useState<'firm' | 'portal'>('firm')
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
        setPortalUsers([])
        return
      }
      const [firm, portal] = await Promise.all([
        callAttorneyMcp<{ users: FirmUser[]; roles: FirmRole[] }>({
          toolName: 'legal.user.list',
        }),
        callAttorneyMcp<{ users: PortalUser[] }>({ toolName: 'legal.user.portal_list' }),
      ])
      setUsers(firm.users)
      setRoles(firm.roles)
      setPortalUsers(portal.users)
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

  async function deleteFirmUser(actorId: string): Promise<void> {
    if (
      !confirm(
        'Remove this user? They lose access and disappear from this list. Their history is preserved; re-inviting the same email restores them.',
      )
    )
      return
    setBusyId(actorId)
    setError(null)
    try {
      await callAttorneyMcp({ toolName: 'legal.user.delete', input: { actorId } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function changePortalType(
    contactEntityId: string,
    portalUserType: 'standard' | 'self_serve',
  ): Promise<void> {
    setBusyId(contactEntityId)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.user.set_portal_user_type',
        input: { contactEntityId, portalUserType },
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function deletePortalUser(contactEntityId: string): Promise<void> {
    if (
      !confirm(
        'Remove this client’s portal login? They stay in your CRM; they can no longer sign in. Re-invite them from their contact page to restore access.',
      )
    )
      return
    setBusyId(contactEntityId)
    setError(null)
    try {
      const res = await fetch(
        `/api/attorney/contacts/${encodeURIComponent(contactEntityId)}/delete-portal-login`,
        { method: 'POST' },
      )
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Could not remove the portal login.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const activeFirm = users?.filter((u) => u.status === 'active').length ?? 0

  return (
    <>
      <SettingsHeader
        title="Users & Roles"
        actions={
          me?.isAdmin && tab === 'firm' ? (
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
            <Tabs
              ariaLabel="User type"
              tabs={[
                { key: 'firm', label: 'Firm users', badge: users?.length ?? 0 },
                { key: 'portal', label: 'Portal users', badge: portalUsers?.length ?? 0 },
              ]}
              active={tab}
              onSelect={(k) => setTab(k as 'firm' | 'portal')}
            />
            <span className="li-set-toolbar-count">
              {tab === 'firm' ? (users ? `${activeFirm} active` : ' ') : ' '}
            </span>
          </div>

          {tab === 'firm' && users === null && <SettingsLoading />}
          {tab === 'portal' && portalUsers === null && <SettingsLoading />}

          {tab === 'firm' &&
            users &&
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
                    {manageable && (
                      <button
                        className="li-set-btn li-set-btn-danger li-set-btn-sm"
                        disabled={busyId === u.actorId}
                        onClick={() => deleteFirmUser(u.actorId)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

          {tab === 'portal' && portalUsers && portalUsers.length === 0 && (
            <div className="li-set-user-row">
              <div className="li-set-user-main">
                <div className="li-set-user-email">
                  No portal users yet. Invite a client from their CRM contact page.
                </div>
              </div>
            </div>
          )}

          {tab === 'portal' &&
            portalUsers &&
            portalUsers.map((p) => (
              <div
                key={p.contactEntityId}
                className="li-set-user-row"
                style={{ opacity: p.portalStatus === 'active' ? 1 : 0.55 }}
              >
                <span className="li-set-user-avatar">{initials(p.fullName)}</span>
                <div className="li-set-user-main">
                  <div className="li-set-user-name">{p.fullName}</div>
                  <div className="li-set-user-email">
                    {p.email || '—'}
                    {p.companyName ? ` · ${p.companyName}` : ''}
                  </div>
                </div>
                <div className="li-set-user-controls">
                  <select
                    className="li-set-select"
                    value={p.userType}
                    disabled={busyId === p.contactEntityId || p.portalStatus !== 'active'}
                    onChange={(e) =>
                      changePortalType(
                        p.contactEntityId,
                        e.target.value as 'standard' | 'self_serve',
                      )
                    }
                  >
                    <option value="self_serve">Self Serve (full access)</option>
                    <option value="standard">Standard (no AI)</option>
                  </select>
                  <span
                    className={`li-set-role-pill${p.portalStatus !== 'active' ? ' is-inactive' : ''}`}
                  >
                    {p.portalStatus === 'active' ? 'active' : 'login removed'}
                  </span>
                  {p.portalStatus === 'active' && (
                    <button
                      className="li-set-btn li-set-btn-danger li-set-btn-sm"
                      disabled={busyId === p.contactEntityId}
                      onClick={() => deletePortalUser(p.contactEntityId)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
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
          <h2>Invite User</h2>
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
