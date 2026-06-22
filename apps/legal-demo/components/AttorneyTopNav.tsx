'use client'

// Top navigation bar (replaces the left sidebar + separate header). Layout:
//   left   — menu button that drops down the nav tabs, next to the brand crest
//   center — global search (matters, clients, contacts)
//   right  — notifications bell + user menu (sign out)
// All three dropdowns share one `open` state so only one is ever visible, and a
// single document listener closes whichever is open on an outside click / Escape.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FIRM_NAME, PRODUCT_TAGLINE, PRODUCT_STAGE } from '@/lib/brand'
import { fetchSession, clearDevSession, type DemoSession } from '@/lib/auth'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SearchBar } from '@/components/SearchBar'
import {
  Building2Icon,
  CalendarIcon,
  CheckCircleIcon,
  CopyIcon,
  FileTextIcon,
  HelpCircleIcon,
  LayersIcon,
  LayoutGridIcon,
  MailIcon,
  ScaleIcon,
  SettingsIcon,
  BriefcaseIcon,
  MenuIcon,
  BellIcon,
  LogOutIcon,
} from '@/components/icons'

const NAV: Array<{
  href: string
  label: string
  exact?: boolean
  Icon: (props: { size?: number }) => React.JSX.Element
}> = [
  { href: '/attorney', label: 'Dashboard', exact: true, Icon: LayoutGridIcon },
  { href: '/attorney/matters', label: 'Matters', Icon: BriefcaseIcon },
  { href: '/attorney/crm', label: 'CRM', Icon: Building2Icon },
  { href: '/attorney/review', label: 'Review', Icon: CheckCircleIcon },
  { href: '/attorney/calendar', label: 'Calendar', Icon: CalendarIcon },
  { href: '/attorney/mail', label: 'Mail', Icon: MailIcon },
  { href: '/attorney/services', label: 'Services', Icon: LayersIcon },
  { href: '/attorney/templates', label: 'Templates', Icon: CopyIcon },
  { href: '/attorney/questionnaires', label: 'Questionnaires', Icon: HelpCircleIcon },
  { href: '/attorney/billing', label: 'Billing', Icon: FileTextIcon },
  { href: '/attorney/settings', label: 'Settings', Icon: SettingsIcon },
]

type OpenMenu = null | 'nav' | 'notif' | 'user'

// One in-app notification (a resolved beta-feedback item) for the nav bell.
type NotifItem = {
  eventId: string
  note: string | null
  // Clean one-line restatement of the feedback (null on legacy events → fall
  // back to the raw excerpt).
  summary: string | null
  excerpt: string
  linkPath: string | null
  category: string
  resolvedAt: string
  unread: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AttorneyTopNav() {
  const pathname = usePathname()
  const [session, setSession] = useState<DemoSession | null>(null)
  const [open, setOpen] = useState<OpenMenu>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const [notifs, setNotifs] = useState<NotifItem[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    // The attorney console never wears the client theme; the old header used to
    // strip it on mount, so keep doing that now that this bar replaces it.
    document.body.classList.remove('surface-client')
    let cancelled = false
    fetchSession().then((s) => {
      if (!cancelled) setSession(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Load the attorney's in-app notifications (resolved beta feedback) for the bell.
  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ items: NotifItem[]; unreadCount: number }>({
      toolName: 'legal.notifications.list',
    })
      .then((r) => {
        if (cancelled) return
        setNotifs(r.items)
        setUnread(r.unreadCount)
      })
      .catch(() => {
        /* leave the bell empty if the load fails */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Close the open dropdown on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const refFor: Record<Exclude<OpenMenu, null>, React.RefObject<HTMLDivElement | null>> = {
      nav: navRef,
      notif: notifRef,
      user: userRef,
    }
    function onDoc(e: MouseEvent) {
      const el = refFor[open as Exclude<OpenMenu, null>].current
      if (el && !el.contains(e.target as Node)) setOpen(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Close the nav dropdown after navigating to a new route.
  useEffect(() => {
    setOpen(null)
  }, [pathname])

  function handleSignOut() {
    // Clear the dev shim (no-op in prod), then full-navigate to the server
    // logout route so its Set-Cookie response applies.
    clearDevSession()
    window.location.href = '/api/auth/logout'
  }

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <header className="att-top">
      <div className="att-top-inner">
        {/* LEFT — menu button + brand */}
        <div className="att-top-left" ref={navRef}>
          <button
            type="button"
            className={`att-icon-btn att-menu-btn ${open === 'nav' ? 'active' : ''}`}
            aria-label="Open navigation"
            aria-expanded={open === 'nav'}
            aria-haspopup="true"
            onClick={() => setOpen(open === 'nav' ? null : 'nav')}
          >
            <MenuIcon size={20} />
          </button>
          <Link href="/attorney" className="att-top-brand">
            <span className="att-top-mark">
              <ScaleIcon size={16} />
            </span>
            <span className="att-top-brand-text">
              <span className="att-top-brand-name">{FIRM_NAME}</span>
              <span className="att-top-brand-sub">
                {PRODUCT_TAGLINE} · {PRODUCT_STAGE}
              </span>
            </span>
          </Link>
          {open === 'nav' && (
            <nav className="att-menu" aria-label="Primary">
              {NAV.map((item) => {
                const active = isActive(item)
                const { Icon } = item
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`att-menu-link ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="att-menu-ico">
                      <Icon size={18} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          )}
        </div>

        {/* CENTER — global search */}
        <div className="att-top-center">
          <SearchBar />
        </div>

        {/* RIGHT — notifications + user */}
        <div className="att-top-right">
          <div className="att-pop-anchor" ref={notifRef}>
            <button
              type="button"
              className={`att-icon-btn ${open === 'notif' ? 'active' : ''}`}
              aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
              aria-expanded={open === 'notif'}
              aria-haspopup="true"
              onClick={() => {
                const opening = open !== 'notif'
                setOpen(opening ? 'notif' : null)
                // Opening the bell marks everything seen: clear the badge now and
                // record the marker (fire-and-forget).
                if (opening && unread > 0) {
                  setUnread(0)
                  void callAttorneyMcp({ toolName: 'legal.notifications.mark_seen' }).catch(
                    () => {},
                  )
                }
              }}
            >
              <BellIcon size={18} />
              {unread > 0 && (
                <span className="att-notif-badge" aria-hidden="true">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {open === 'notif' && (
              <div
                className="att-pop att-notif"
                role="region"
                aria-label="Notifications"
                aria-live="polite"
              >
                <div className="att-pop-head">Notifications</div>
                {notifs.length === 0 ? (
                  <div className="att-notif-empty">
                    <CheckCircleIcon size={22} />
                    <span>You&rsquo;re all caught up.</span>
                  </div>
                ) : (
                  <ul className="att-notif-list">
                    {notifs.map((n) => {
                      const body = (
                        <>
                          <span className="att-notif-row-top">
                            {n.unread && <span className="att-notif-dot" aria-hidden="true" />}
                            <span className="att-notif-title">Feedback resolved</span>
                            <span className="att-notif-cat">{n.category}</span>
                          </span>
                          {/* Headline: the resolver's clean one-liner. Legacy events
                              with no summary fall back to the quoted raw excerpt. */}
                          {n.summary ? (
                            <span className="att-notif-summary">{n.summary}</span>
                          ) : (
                            <span className="att-notif-excerpt">“{n.excerpt}”</span>
                          )}
                          {n.note && <span className="att-notif-note">{n.note}</span>}
                        </>
                      )
                      return (
                        <li
                          key={n.eventId}
                          className={`att-notif-item${n.unread ? ' unread' : ''}`}
                        >
                          {n.linkPath ? (
                            <Link href={n.linkPath} className="att-notif-link">
                              {body}
                            </Link>
                          ) : (
                            <div className="att-notif-link">{body}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="att-pop-anchor" ref={userRef}>
            <button
              type="button"
              className={`att-user-btn ${open === 'user' ? 'active' : ''}`}
              aria-label="Account menu"
              aria-expanded={open === 'user'}
              aria-haspopup="true"
              onClick={() => setOpen(open === 'user' ? null : 'user')}
            >
              <span className="att-avatar">{session ? initials(session.displayName) : '·'}</span>
            </button>
            {open === 'user' && (
              <div className="att-pop att-user-menu" role="menu">
                {session && (
                  <div className="att-user-id">
                    <span className="signed-in-dot" />
                    <strong>{session.displayName}</strong>
                  </div>
                )}
                <button
                  type="button"
                  className="att-menu-link"
                  onClick={handleSignOut}
                  role="menuitem"
                >
                  <span className="att-menu-ico">
                    <LogOutIcon size={18} />
                  </span>
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
