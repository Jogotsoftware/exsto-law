'use client'

// PT-1 — client-portal SIDE navigation (founder walk 15.11: "portal ui still
// has the old navigation. needs the new, side navigation … should work the
// same as the actual platform navigation").
//
// This is a PORT of the attorney shell's rail (AttorneyRail.tsx), not a
// lookalike: same interaction model (58px icon rail / 256px expanded,
// hover-expand gated on (hover: hover), pin persisted in localStorage, gold
// active bar, label fade) and the same li-rail-* chrome classes, so the two
// rails can never drift apart visually. Portal differences only:
//   - items are view-switching BUTTONS (the portal is a single-page view
//     machine, not routed pages), supplied by the page via props;
//   - the bottom user block shows the CLIENT (founder 2026-07-21: user +
//     sign-out live here, exactly like the platform rail, not the top bar);
//   - its own pin storage key, so attorney/portal pin states don't collide.
// New CSS lives in the append-only li-cpnav-* family (globals.css tail); the
// shared li-rail-* rules are reused untouched.
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { PortalNavKind } from '@/lib/portalNav'

export interface PortalNavItem {
  kind: PortalNavKind
  label: string
  Icon: (props: { size?: number }) => React.JSX.Element
}

export interface PortalNavUser {
  displayName: string
  email: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''))
    .toUpperCase()
}

const PIN_STORAGE_KEY = 'exsto.li.cpRailPinned'

export function PortalSideNav({
  items,
  active,
  onSelect,
  user,
}: {
  items: PortalNavItem[]
  active: string
  onSelect: (kind: PortalNavKind) => void
  user?: PortalNavUser | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [canHover, setCanHover] = useState(true)
  const [isNarrow, setIsNarrow] = useState(false)

  // Restore the pinned state persisted across sessions (same mechanic as the
  // attorney rail, separate key).
  useEffect(() => {
    try {
      const v = localStorage.getItem(PIN_STORAGE_KEY)
      if (v != null) setPinned(v === '1')
    } catch {
      /* private mode / storage blocked — default to unpinned */
    }
  }, [])

  // Hover-expand is pointer-media-gated; the spacer stays at icon width on
  // narrow viewports. Track both with matchMedia (ported from AttorneyRail).
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

  const expanded = pinned || hovered
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
            title={
              pinned
                ? t('portal.nav.unpin', undefined, 'Unpin sidebar')
                : t('portal.nav.pin', undefined, 'Pin sidebar open')
            }
          >
            {/* Scales of justice — same paths as the attorney rail head. */}
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
            <span className="li-rail-product">
              {t('portal.brand_sub', undefined, 'Client Portal')}
            </span>
          </div>
        </div>

        <nav className="li-rail-nav" aria-label="Portal sections">
          {items.map((item) => {
            const isActive = active === item.kind
            const { Icon } = item
            return (
              <button
                key={item.kind}
                type="button"
                className={`li-rail-item li-cpnav-item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                onClick={() => onSelect(item.kind)}
              >
                <span className="li-rail-bar" aria-hidden="true" />
                <span className="li-rail-ico">
                  <Icon size={20} />
                </span>
                <span className="li-rail-label li-rail-fade">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {user && (
          <div className="li-rail-user">
            <button
              type="button"
              className="li-rail-user-btn"
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={t('portal.nav.account', undefined, 'Account menu')}
            >
              <span className="li-rail-avatar">{initials(user.displayName)}</span>
              <span className="li-rail-user-id li-rail-fade">
                <span className="li-rail-user-name">{user.displayName}</span>
                <span className="li-rail-user-role">
                  {t('portal.nav.client_role', undefined, 'Client')}
                </span>
              </span>
            </button>
            {userMenuOpen && (
              <div className="li-rail-pop" role="menu">
                <div className="li-rail-pop-email">{user.email}</div>
                <a
                  href="/api/client/auth/logout"
                  className="li-rail-pop-signout"
                  role="menuitem"
                >
                  {t('portal.signout', undefined, 'Sign out')}
                </a>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
