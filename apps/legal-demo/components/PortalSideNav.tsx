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
//
// RAIL-FOLLOWUPS-1: the port now extends to the SKIN and the STATE as well.
// The rail carries `li-rail--glass` (no surface at all when collapsed — bare
// icons over the page, gold active icon; a tinted panel when expanded, the firm
// brand color when set and the platform page color otherwise) and reads its
// open/pin state from RailShellState, the same context the attorney console
// uses. The head lockup and the pin button are gone from here: they live in the
// portal's header band now (RailBrandLockup), exactly as on the attorney side.
import { useState } from 'react'
import { useRailShell } from '@/components/RailShellState'
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
  return (
    (parts[0][0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')
  ).toUpperCase()
}

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
  const { expanded, pinned, onRailEnter, onRailLeave, spacerWidth, railWidth } = useRailShell()
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  return (
    <>
      <div className="li-rail-spacer" style={{ width: spacerWidth }} aria-hidden="true" />
      <aside
        className={`li-rail li-rail--glass${expanded ? ' li-rail--expanded' : ''}${
          expanded && !pinned ? ' li-rail--floating' : ''
        }`}
        style={{ width: railWidth }}
        onMouseEnter={onRailEnter}
        onMouseLeave={onRailLeave}
      >
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
                <a href="/api/client/auth/logout" className="li-rail-pop-signout" role="menuitem">
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
