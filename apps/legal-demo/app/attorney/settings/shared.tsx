// Shared UI atoms for the routed Settings pages (WP-G). Each page under
// app/attorney/settings/<section>/page.tsx owns its own state and MCP calls —
// nothing here talks to the network. This file only carries the comp's
// header treatment and a couple of tiny presentational primitives reused
// across more than one settings page, so each page stays a straight port of
// its old CollapsibleSection body rather than reinventing chrome.
import type { ReactNode } from 'react'

// The comp's settings header: h1 section title + "Firm-wide configuration ·
// Settings" subtitle, with an optional right-aligned action (Users page's
// "+ Invite user" button).
export function SettingsHeader({
  title,
  actions,
}: {
  title: string
  actions?: ReactNode
}): React.ReactElement {
  return (
    <div className="li-set-header">
      <div className="li-set-header-titles">
        <h1>{title}</h1>
        <p>Firm-wide configuration · Settings</p>
      </div>
      {actions && <div className="li-set-header-actions">{actions}</div>}
    </div>
  )
}

export function SettingsLoading(): React.ReactElement {
  return (
    <div className="li-set-loading" role="status">
      <span className="li-set-spin" aria-hidden />
      Loading…
    </div>
  )
}

export function SettingsAlert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warn'
  children: ReactNode
}): React.ReactElement {
  const cls =
    tone === 'error'
      ? 'li-set-alert li-set-alert-error'
      : tone === 'success'
        ? 'li-set-alert li-set-alert-success'
        : tone === 'warn'
          ? 'li-set-alert li-set-alert-warn'
          : 'li-set-alert'
  return <div className={cls}>{children}</div>
}
