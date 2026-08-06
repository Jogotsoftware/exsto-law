'use client'

// Legal Instruments top bar (attorney-console redesign — binding comp in
// docs/design/legal-instruments). A slim navy bar:
//   left        — firm wordmark (EB Garamond).
//   center-right — the expandable global search (reuses SearchBar's logic).
//   right       — a notifications bell + popover with the resolved-feedback
//                 feed and mark-all-read wiring.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PRODUCT_TAGLINE } from '@/lib/brand'
import { RailBrandLockup } from '@/components/RailBrandLockup'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { logoChipClass, useFirmBranding } from '@/lib/firmBranding'
import { parseTimestamp, formatDate } from '@/lib/datetime'
import { SearchBar } from '@/components/SearchBar'
import { BellIcon } from '@/components/icons'

// One in-app notification (a resolved beta-feedback item) for the bell.
type NotifItem = {
  eventId: string
  note: string | null
  summary: string | null
  excerpt: string
  linkPath: string | null
  category: string
  resolvedAt: string
  unread: boolean
}

// Compact "when" label for a notification row (now / 4m / 3h / 2d / Jul 10).
function relativeTime(iso: string | null): string {
  const d = parseTimestamp(iso)
  if (!d) return ''
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return formatDate(iso)
}

export function AttorneyTopBar(): React.JSX.Element {
  const [notifs, setNotifs] = useState<NotifItem[]>([])
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  // FB-C — the resolved TENANT's firm name, never the hardcoded FIRM_NAME
  // literal: this bar renders for every firm's attorneys, not just Pacheco's.
  // Falls back to the product tagline while loading / if a firm has not set a
  // name yet — never a hardcoded firm literal.
  // UIWALK-1: when one is uploaded, the bar shows the firm logo in place of
  // the wordmark. The firm's brand color moved up to AttorneyShell (UIWALK-2)
  // — CSS vars, not inline style.
  // FIRM-BRANDING-1: name + logo come from the shared branding store (one read
  // of legal.firm.get_branding for the whole shell, refreshed in place when
  // Settings → Firm Details saves), not from the invoice-template config the
  // logo used to be buried in.
  const { firmName, logoDataUrl, logoTone } = useFirmBranding()

  // Load the attorney's in-app notifications (resolved beta feedback).
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

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!notifOpen) return
    function onDoc(e: MouseEvent): void {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [notifOpen])

  function markAllRead(): void {
    if (unread === 0) return
    setUnread(0)
    setNotifs((items) => items.map((n) => ({ ...n, unread: false })))
    // Fire-and-forget: the same marker the old top nav recorded.
    void callAttorneyMcp({ toolName: 'legal.notifications.mark_seen' }).catch(() => {})
  }

  return (
    <header className="li-topbar">
      {/* RAIL-FOLLOWUPS-1: the Legal Instruments lockup lives HERE now, at the
          bar's left edge over the rail's icon column — twinkle mark alone while
          the rail is collapsed, sliding into the full wordmark as it opens. It
          is also the rail's pin control. */}
      <RailBrandLockup idPrefix="att" pinLabel="Pin sidebar open" unpinLabel="Unpin sidebar" />
      <div className="li-topbar-firm">
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt={firmName ?? 'Firm logo'}
            className={`li-topbar-logo${logoChipClass(logoTone, 'dark')}`}
          />
        ) : (
          (firmName ?? PRODUCT_TAGLINE)
        )}
      </div>
      <div className="li-topbar-spacer" />

      <SearchBar />

      <div className="li-top-bell-wrap" ref={notifRef}>
        <button
          type="button"
          className="li-top-bell"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
          aria-expanded={notifOpen}
          aria-haspopup="true"
          onClick={() => setNotifOpen((o) => !o)}
        >
          <BellIcon size={19} />
          {unread > 0 && <span className="li-top-bell-dot" aria-hidden="true" />}
        </button>
        {notifOpen && (
          <div className="li-top-notif" role="region" aria-label="Notifications" aria-live="polite">
            <div className="li-top-notif-head">
              <span className="li-top-notif-title">Notifications</span>
              <button
                type="button"
                className="li-top-notif-markall"
                onClick={markAllRead}
                disabled={unread === 0}
              >
                Mark all read
              </button>
            </div>
            {notifs.length === 0 ? (
              <div className="li-top-notif-empty">You&rsquo;re all caught up.</div>
            ) : (
              <ul className="li-top-notif-list">
                {notifs.map((n) => {
                  const detail = (n.summary ?? n.excerpt ?? '').trim()
                  const when = relativeTime(n.resolvedAt)
                  const body = (
                    <>
                      <span
                        className={`li-top-notif-dot${n.unread ? ' is-unread' : ''}`}
                        aria-hidden="true"
                      />
                      <div className="li-top-notif-body">
                        <div className="li-top-notif-rowtitle">Resolved Feedback</div>
                        {detail && <div className="li-top-notif-detail">{detail}</div>}
                      </div>
                      {when && <span className="li-top-notif-when">{when}</span>}
                    </>
                  )
                  return (
                    <li key={n.eventId}>
                      {n.linkPath ? (
                        <Link
                          href={n.linkPath}
                          className="li-top-notif-row"
                          title={detail || undefined}
                          onClick={() => setNotifOpen(false)}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="li-top-notif-row" title={detail || undefined}>
                          {body}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
