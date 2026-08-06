'use client'

// Legal Instruments left rail (attorney-console redesign — binding comp in
// docs/design/legal-instruments). RAIL-WEBSITE-STYLE-1 re-skins it to the
// marketing site's rail (legal-instruments/Sidebar.dc.html): no surface at all
// when collapsed (a bare icon column floating over the page), a cream glass
// panel with navy labels when expanded. The mechanics below are unchanged:
//   - 58px collapsed / 256px expanded (tightened per founder walk), pinned state persisted in localStorage.
//   - An absolutely-positioned overlay sitting over a flow "spacer" so a
//     hover-expand floats over content instead of shoving it.
//   - Primary nav with MODULE_AREAS gating so disabled feature-modules hide
//     their items.
//   - A bottom user block whose popover carries the same sign-out logic the old
//     top nav used.
// The `li-rail--glass` modifier scopes the new skin: PortalSideNav.tsx ports
// these same li-rail-* classes, so the CSS keys off that modifier to leave the
// client portal's dark rail exactly as it was.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PRODUCT_STAGE } from '@/lib/brand'
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
  SignatureIcon,
  Share2Icon,
  UsersIcon,
  DollarSignIcon,
  SparklesIcon,
  WandIcon,
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

// Nav order and routes for the attorney console. Dashboard is
// relabelled "Home"; Libraries' "Questionnaires" is relabelled "Intake Forms"
// (route unchanged); Settings becomes an expandable group of section anchors.
const NAV: NavNode[] = [
  { kind: 'leaf', href: '/attorney', label: 'Home', exact: true, Icon: LayoutGridIcon },
  { kind: 'leaf', href: '/attorney/matters', label: 'Matters', Icon: BriefcaseIcon },
  { kind: 'leaf', href: '/attorney/crm', label: 'CRM', Icon: Building2Icon },
  { kind: 'leaf', href: '/attorney/review', label: 'Tasks', Icon: CheckCircleIcon },
  { kind: 'leaf', href: '/attorney/esign', label: 'eSign', Icon: SignatureIcon },
  // UIWALK-2: Requests is hidden from the nav (founder direction 2026-08-04) —
  // client requests surface in Tasks. The route stays reachable: Task Queue
  // rows (workHref) and the attorney_new_request email deep-link there.
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
      // UIWALK-1: Questions is hidden from the nav for now (founder direction
      // 2026-08-04). The route stays reachable by URL.
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
      { href: '/attorney/settings/firm', label: 'Firm Details', Icon: Building2Icon },
      {
        href: '/attorney/settings/engagement',
        label: 'Engagement Letters',
        Icon: SignatureIcon,
      },
      {
        href: '/attorney/settings/invoice-template',
        label: 'Invoice Template',
        Icon: FileTextIcon,
      },
      { href: '/attorney/settings/signature', label: 'Email Signature', Icon: MailIcon },
      { href: '/attorney/settings/booking', label: 'Booking Rules', Icon: CalendarIcon },
      { href: '/attorney/settings/users', label: 'Users & Roles', Icon: UsersIcon },
      { href: '/attorney/settings/payments', label: 'Payments', Icon: DollarSignIcon },
      { href: '/attorney/settings/ai-usage', label: 'AI Usage', Icon: SparklesIcon },
      { href: '/attorney/settings/assistant', label: 'Assistant', Icon: WandIcon },
      // CONTEXT-SETTINGS-1 — firm-wide AI instructions per capability + the
      // firm/user persistent context files. Sits next to Assistant, which owns
      // the chat/email instruction slots.
      { href: '/attorney/settings/context', label: 'AI Context', Icon: SparklesIcon },
    ],
  },
]

// Which nav hrefs each feature MODULE gates (ADR 0046 §5). Used to hide nav
// for modules an operator has DISABLED for this
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
  // UIWALK-2: inert for nav (Requests is no longer a nav item) — kept to
  // document the module↔route relationship.
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
  const railWidth = expanded ? 256 : 58
  const spacerWidth = pinned && !isNarrow ? 256 : 58

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
        className={`li-rail li-rail--glass${expanded ? ' li-rail--expanded' : ''}${
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
            aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          >
            {/* Collapsed head: the twinkle-stars brand mark (exact paths from
                the marketing rail, Sidebar.dc.html), replacing the old scales
                of justice. Expanded, the full wordmark below takes its place —
                the wordmark asset already ends in the same stars, so the two
                are swapped rather than shown side by side (a separate button
                mark would double the lockup). The button keeps the pin toggle
                either way. */}
            <svg
              className="li-rail-mark li-gemstar"
              width="26"
              height="23"
              viewBox="0 0 30 26"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="liRailGemStar"
                  x1="0"
                  y1="0"
                  x2="30"
                  y2="26"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor="#4E82BE" />
                  <stop offset="0.3" stopColor="#2f5c93" />
                  <stop offset="0.5" stopColor="#A5854A" />
                  <stop offset="0.74" stopColor="#D8B166" />
                  <stop offset="1" stopColor="#F3E3B8" />
                </linearGradient>
              </defs>
              <path
                d="M19 3 C19.6 9.2 23.8 13.4 30 14 C23.8 14.6 19.6 18.8 19 25 C18.4 18.8 14.2 14.6 8 14 C14.2 13.4 18.4 9.2 19 3 Z"
                fill="url(#liRailGemStar)"
              />
              <path
                d="M6.5 0.5 C6.8 3.7 9.3 6.2 12.5 6.5 C9.3 6.8 6.8 9.3 6.5 12.5 C6.2 9.3 3.7 6.8 0.5 6.5 C3.7 6.2 6.2 3.7 6.5 0.5 Z"
                fill="url(#liRailGemStar)"
                style={{ animationDelay: '.4s' }}
              />
            </svg>
            <img className="li-rail-mark-word" src="/brand/wordmark-navy-bluegold.svg" alt="" />
          </button>
          <span className="li-rail-beta li-rail-fade">{PRODUCT_STAGE}</span>
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
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
