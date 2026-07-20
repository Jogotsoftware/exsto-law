'use client'

// Controlled underline-tab bar (.li-tabs) — the button-based counterpart to
// NavTabs' link-based .nav-tabs. Pure presentation: the caller owns active
// state and receives onSelect, so it composes with any tab-content layout
// (see app/attorney/mail/page.tsx for the WP-I Email / Portal chat usage).
export interface TabSpec {
  key: string
  label: string
  badge?: number
}

export function Tabs({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: TabSpec[]
  active: string
  onSelect: (key: string) => void
  ariaLabel?: string
}) {
  return (
    <div className="li-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`li-tabs-tab ${t.key === active ? 'is-active' : ''}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="li-tabs-count">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
