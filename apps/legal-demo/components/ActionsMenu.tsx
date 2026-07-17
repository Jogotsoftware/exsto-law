'use client'

// A compact "Actions ▾" button that drops a mini menu of row/entity actions —
// the pattern beta feedback asked for on the matter header (and, next, on every
// calendar event). It consolidates what used to be a row of header buttons into
// one menu so the header stays uncluttered. Reuses the nav dropdown's look
// (.att-pop / .att-menu-link) and its close-on-outside-click / Escape behaviour.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ChevronDownIcon } from '@/components/icons'

export interface ActionItem {
  label: string
  icon?: React.ReactNode
  // A link target OR a click handler — not both. A link uses Next navigation; a
  // handler runs an in-page action (compose, schedule, …). The menu closes either way.
  href?: string
  onClick?: () => void
  title?: string
  disabled?: boolean
  // Destructive item (e.g. "Close matter") — rendered in the danger color. The
  // menu is portaled to document.body (outside .li-shell), so the modifier class
  // below uses literal hex, not `var(--li-*)`, which wouldn't inherit there.
  danger?: boolean
}

export function ActionsMenu({
  label = 'Actions',
  items,
  align = 'right',
  triggerContent,
  triggerClassName,
  triggerTitle,
}: {
  label?: string
  items: ActionItem[]
  // Which edge the menu hangs from (default right, for header/right-aligned use).
  align?: 'left' | 'right'
  // Optional COMPACT trigger (e.g. a small edit icon on a calendar event). When
  // set it replaces the default "Actions ▾" pill; clicks are stopped from
  // bubbling so the menu opens without also firing the surrounding element.
  triggerContent?: React.ReactNode
  triggerClassName?: string
  triggerTitle?: string
}) {
  const [open, setOpen] = useState(false)
  // The menu renders in a PORTAL with fixed positioning so it escapes any
  // overflow-clipping ancestor (e.g. a scrollable calendar grid) — the bug where
  // a calendar event's actions got cut off. Position is measured from the trigger
  // and flipped above it when there isn't room below.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const mh = menuRef.current?.offsetHeight ?? 0
    const mw = menuRef.current?.offsetWidth ?? 220
    let top = r.bottom + 4
    if (mh && top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4) // flip up
    let left = align === 'left' ? r.left : r.right - mw
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8))
    setPos({ top, left })
  }, [open, align, items.length])

  // Close on an outside click, Escape, or scroll/resize (positions go stale).
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onScrollResize() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen((o) => {
      if (o) setPos(null)
      return !o
    })
  }

  return (
    <div className="att-pop-anchor">
      <button
        ref={triggerRef}
        type="button"
        className={
          triggerContent
            ? `${triggerClassName ?? ''} ${open ? 'active' : ''}`.trim()
            : `att-actions-btn ${open ? 'active' : ''}`
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerContent ? (triggerTitle ?? 'Actions') : undefined}
        title={triggerTitle}
        onClick={toggle}
      >
        {triggerContent ?? (
          <>
            {label}
            <ChevronDownIcon size={15} />
          </>
        )}
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className="att-pop att-menu-pop att-menu-portal"
            role="menu"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              right: 'auto',
              bottom: 'auto',
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {items.map((item) => {
              const body = (
                <>
                  {item.icon && <span className="att-menu-ico">{item.icon}</span>}
                  <span>{item.label}</span>
                </>
              )
              const linkClass = item.danger ? 'att-menu-link att-menu-link-danger' : 'att-menu-link'
              if (item.href && !item.disabled) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    role="menuitem"
                    className={linkClass}
                    title={item.title}
                    onClick={() => setOpen(false)}
                  >
                    {body}
                  </Link>
                )
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={linkClass}
                  title={item.title}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onClick?.()
                  }}
                >
                  {body}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
