'use client'

// Legal Instruments left rail (attorney-console redesign — binding comp in
// docs/design/legal-instruments). A dark, collapsible rail:
//   - 72px collapsed / 256px expanded, pinned state persisted in localStorage.
//   - An absolutely-positioned overlay sitting over a flow "spacer" so a
//     hover-expand floats over content instead of shoving it.
//   - Primary nav ported from the old AttorneyTopNav NAV array, KEEPING the
//     MODULE_AREAS gating so disabled feature-modules hide their items.
//   - A bottom user block whose popover carries the same sign-out logic the old
//     top nav used.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PRODUCT_TAGLINE, PRODUCT_STAGE } from '@/lib/brand'
import { fetchSession, clearDevSession, type DemoSession } from '@/lib/auth'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  LayoutGridIcon,
  BriefcaseIcon,
  Building2Icon,
  CheckCircleIcon,
  HelpCircleIcon,
  CalendarIcon,
  MailIcon,
  LayersIcon,
  FileTextIcon,
  SettingsIcon,
  ListIcon,
  CopyIcon,
  MessageCircleIcon,
  SignatureIcon,
  Share2Icon,
  UsersIcon,
  DollarSignIcon,
  SparklesIcon,
  ChevronDownIcon,
  LogOutIcon,
} from '@/components/icons'

type IconCmp = (props: { size?: number }) => React.JSX.Element

type NavLeaf = { kind: 'leaf'; href: string; label: string; exact?: boolean; Icon: IconCmp }
// A sub-item: `href` is both the MODULE_AREAS gating key and the real routed
// page (WP-G split Settings into actual sub-routes — no more query-param
// section anchors).
type NavSub = { href: string; label: string; Icon: IconCmp }
type NavGroup = { kind: 'group'; key: string; label: string; Icon: IconCmp; children: NavSub[] }
type NavNode = NavLeaf | NavGroup

const isGroup = (n: NavNode): n is NavGroup => n.kind === 'group'

// Nav order and routes ported from the old AttorneyTopNav NAV. Dashboard is
// relabelled "Home"; Libraries' "Questionnaires" is relabelled "Intake Forms"
// (route unchanged); Settings becomes an expandable group of section anchors.
const NAV: NavNode[] = [
  { kind: 'leaf', href: '/attorney', label: 'Home', exact: true, Icon: LayoutGridIcon },
  { kind: 'leaf', href: '/attorney/matters', label: 'Matters', Icon: BriefcaseIcon },
  { kind: 'leaf', href: '/attorney/crm', label: 'CRM', Icon: Building2Icon },
  { kind: 'leaf', href: '/attorney/review', label: 'Review', Icon: CheckCircleIcon },
  { kind: 'leaf', href: '/attorney/esign', label: 'eSign', Icon: SignatureIcon },
  { kind: 'leaf', href: '/attorney/requests', label: 'Requests', Icon: HelpCircleIcon },
  { kind: 'leaf', href: '/attorney/calendar', label: 'Calendar', Icon: CalendarIcon },
  { kind: 'leaf', href: '/attorney/mail', label: 'Mail', Icon: MailIcon },
  {
    kind: 'group',
    key: 'Libraries',
    label: 'Libraries',
    Icon: LayersIcon,
    children: [
      { href: '/attorney/services', label: 'Services', Icon: ListIcon },
      { href: '/attorney/templates', label: 'Templates', Icon: CopyIcon },
      { href: '/attorney/questionnaires', label: 'Intake Forms', Icon: HelpCircleIcon },
      { href: '/attorney/questions', label: 'Questions', Icon: MessageCircleIcon },
    ],
  },
  { kind: 'leaf', href: '/attorney/billing', label: 'Billing', Icon: FileTextIcon },
  {
    kind: 'group',
    key: 'Settings',
    label: 'Settings',
    Icon: SettingsIcon,
    children: [
      { href: '/attorney/settings/integrations', label: 'Integrations', Icon: Share2Icon },
      { href: '/attorney/settings/firm', label: 'Firm details', Icon: Building2Icon },
      {
        href: '/attorney/settings/invoice-template',
        label: 'Invoice template',
        Icon: FileTextIcon,
      },
      { href: '/attorney/settings/signature', label: 'Email signature', Icon: MailIcon },
      { href: '/attorney/settings/booking', label: 'Booking rules', Icon: CalendarIcon },
      { href: '/attorney/settings/users', label: 'Users & roles', Icon: UsersIcon },
      { href: '/attorney/settings/payments', label: 'Payments', Icon: DollarSignIcon },
      { href: '/attorney/settings/ai-usage', label: 'AI usage', Icon: SparklesIcon },
    ],
  },
]

// Which nav hrefs each feature MODULE gates (mirrors the old AttorneyTopNav map,
// ADR 0046 §5). Used to hide nav for modules an operator has DISABLED for this
// firm. Areas not listed (Home, Mail, Settings) are never module-gated.
const MODULE_AREAS: Record<string, string[]> = {
  matters: ['/attorney/matters', '/attorney/review'],
  calendar: ['/attorney/calendar'],
  billing: ['/attorney/billing'],
  crm: ['/attorney/crm'],
  documents: [
    '/attorney/templates',
    '/attorney/questionnaires',
    '/attorney/questions',
    '/attorney/services',
  ],
  'client-portal': ['/attorney/requests'],
  'e-sign': ['/attorney/esign'],
}

const PIN_STORAGE_KEY = 'exsto.li.railPinned'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function AttorneyRail(): React.JSX.Element {
  const pathname = usePathname()
  const [session, setSession] = useState<DemoSession | null>(null)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [canHover, setCanHover] = useState(true)
  const [isNarrow, setIsNarrow] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [hiddenHrefs, setHiddenHrefs] = useState<Set<string>>(new Set())
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ left: number; bottom: number } | null>(null)
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const userWrapRef = useRef<HTMLDivElement>(null)

  // The attorney console never wears the client theme; the old top nav stripped
  // it on mount, so keep doing that here.
  useEffect(() => {
    document.body.classList.remove('surface-client')
    let cancelled = false
    fetchSession().then((s) => {
      if (!cancelled) setSession(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Restore the pinned state persisted across sessions.
  useEffect(() => {
    try {
      const v = localStorage.getItem(PIN_STORAGE_KEY)
      if (v != null) setPinned(v === '1')
    } catch {
      /* private mode / storage blocked — default to unpinned */
    }
  }, [])

  // Hover-expand is pointer-media-gated; the spacer stays at icon width on
  // narrow viewports. Track both with matchMedia.
  useEffect(() => {
    const hoverMq = window.matchMedia('(hover: hover)')
    const narrowMq = window.matchMedia('(max-width: 859px)')
    const sync = (): void => {
      setCanHover(hoverMq.matches)
      setIsNarrow(narrowMq.matches)
    }
    sync()
    hoverMq.addEventListener('change', sync)
    narrowMq.addEventListener('change', sync)
    return () => {
      hoverMq.removeEventListener('change', sync)
      narrowMq.removeEventListener('change', sync)
    }
  }, [])

  // Hide nav for feature modules an operator has explicitly DISABLED for this
  // firm (opt-out; failure leaves all nav visible).
  useEffect(() => {
    let cancelled = false
    callAttorneyMcp<{ disabledModuleKeys: string[] }>({ toolName: 'legal.module.gating' })
      .then((r) => {
        if (cancelled || !r.disabledModuleKeys?.length) return
        setHiddenHrefs(new Set(r.disabledModuleKeys.flatMap((k) => MODULE_AREAS[k] ?? [])))
      })
      .catch(() => {
        /* leave all nav visible on failure */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Close the account popover on outside click / Escape.
  useEffect(() => {
    if (!userMenuOpen) return
    function onDoc(e: MouseEvent): void {
      if (userWrapRef.current && !userWrapRef.current.contains(e.target as Node))
        setUserMenuOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  // The popover keeps the rail expanded even after the pointer leaves the aside
  // (the popover is a fixed overlay outside the aside box).
  const expanded = pinned || hovered || userMenuOpen
  const railWidth = expanded ? 256 : 72
  const spacerWidth = pinned && !isNarrow ? 256 : 72

  function togglePin(): void {
    setPinned((p) => {
      const next = !p
      try {
        localStorage.setItem(PIN_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage blocked — pin state is best-effort */
      }
      return next
    })
  }

  function toggleUserMenu(): void {
    if (userMenuOpen) {
      setUserMenuOpen(false)
      return
    }
    const r = userBtnRef.current?.getBoundingClientRect()
    if (r) setPopPos({ left: Math.max(12, r.left), bottom: window.innerHeight - r.top + 8 })
    setUserMenuOpen(true)
  }

  function handleSignOut(): void {
    // Clear the dev shim (no-op in prod), then full-navigate to the server
    // logout route so its Set-Cookie response applies. Same logic the old top
    // nav used.
    clearDevSession()
    window.location.href = '/api/auth/logout'
  }

  const leafActive = (leaf: { href: string; exact?: boolean }): boolean =>
    leaf.exact ? pathname === leaf.href : pathname.startsWith(leaf.href)
  const subActive = (sub: NavSub): boolean => pathname.startsWith(sub.href)

  // Drop leaves whose feature module is disabled; drop a group if all children
  // are hidden (settings children share a base href never in MODULE_AREAS).
  const visibleNav: NavNode[] = NAV.flatMap((node): NavNode[] => {
    if (!isGroup(node)) return hiddenHrefs.has(node.href) ? [] : [node]
    const children = node.children.filter((c) => !hiddenHrefs.has(c.href))
    return children.length ? [{ ...node, children }] : []
  })

  return (
    <>
      <div className="li-rail-spacer" style={{ width: spacerWidth }} aria-hidden="true" />
      <aside
        className={`li-rail${expanded ? ' li-rail--expanded' : ''}${
          hovered && !pinned ? ' li-rail--floating' : ''
        }`}
        style={{ width: railWidth }}
        onMouseEnter={() => {
          if (canHover) setHovered(true)
        }}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="li-rail-head">
          <button
            type="button"
            className={`li-rail-pin${pinned ? ' is-pinned' : ''}`}
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          >
            {/* Scales of justice — exact paths from the comp header button. */}
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v18" />
              <path d="M7 21h10" />
              <path d="M4 7h16" />
              <path d="M7 4.5 4 12a3 3 0 0 0 6 0L7 4.5Z" />
              <path d="M17 4.5 14 12a3 3 0 0 0 6 0l-3-7.5Z" />
              <circle cx="12" cy="3" r="1.3" fill="currentColor" />
            </svg>
          </button>
          <div className="li-rail-wordmark li-rail-fade">
            <span className="li-rail-product">{PRODUCT_TAGLINE}</span>
            <span className="li-rail-beta">{PRODUCT_STAGE}</span>
          </div>
        </div>

        <nav className="li-rail-nav" aria-label="Primary">
          {visibleNav.map((node) => {
            if (!isGroup(node)) {
              const active = leafActive(node)
              const { Icon } = node
              return (
                <Link
                  key={node.href}
                  href={node.href}
                  className={`li-rail-item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={node.label}
                >
                  <span className="li-rail-bar" aria-hidden="true" />
                  <span className="li-rail-ico">
                    <Icon size={20} />
                  </span>
                  <span className="li-rail-label li-rail-fade">{node.label}</span>
                </Link>
              )
            }
            const containsActive = node.children.some(subActive)
            const groupOpen = expanded && (openGroups[node.key] ?? containsActive)
            const { Icon } = node
            return (
              <div key={node.key}>
                <button
                  type="button"
                  className={`li-rail-item${containsActive ? ' is-active' : ''}`}
                  aria-expanded={groupOpen}
                  onClick={() =>
                    setOpenGroups((s) => ({
                      ...s,
                      [node.key]: !(s[node.key] ?? containsActive),
                    }))
                  }
                  title={node.label}
                >
                  <span className="li-rail-bar" aria-hidden="true" />
                  <span className="li-rail-ico">
                    <Icon size={20} />
                  </span>
                  <span className="li-rail-label li-rail-fade">{node.label}</span>
                  <span
                    className={`li-rail-chevron li-rail-fade${groupOpen ? ' is-open' : ''}`}
                    aria-hidden="true"
                  >
                    <ChevronDownIcon size={16} />
                  </span>
                </button>
                <div className={`li-rail-sub${groupOpen ? ' is-open' : ''}`}>
                  {node.children.map((sub) => {
                    const active = subActive(sub)
                    const { Icon: SubIcon } = sub
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={`li-rail-subitem${active ? ' is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span className="li-rail-subico">
                          <SubIcon size={16} />
                        </span>
                        {sub.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="li-rail-user" ref={userWrapRef}>
          <button
            type="button"
            className="li-rail-user-btn"
            ref={userBtnRef}
            onClick={toggleUserMenu}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            aria-label="Account menu"
          >
            <span className="li-rail-avatar">{session ? initials(session.displayName) : '·'}</span>
            <span className="li-rail-user-id li-rail-fade">
              <span className="li-rail-user-name">{session?.displayName ?? 'Signing in…'}</span>
              <span className="li-rail-user-role">Attorney</span>
            </span>
          </button>
          {userMenuOpen && (
            <div
              className="li-rail-pop"
              role="menu"
              style={popPos ? { left: popPos.left, bottom: popPos.bottom } : undefined}
            >
              {session && <div className="li-rail-pop-email">{session.email}</div>}
              <button
                type="button"
                className="li-rail-pop-signout"
                role="menuitem"
                onClick={handleSignOut}
              >
                <LogOutIcon size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
