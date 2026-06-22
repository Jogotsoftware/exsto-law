'use client'

// A compact "Actions ▾" button that drops a mini menu of row/entity actions —
// the pattern beta feedback asked for on the matter header (and, next, on every
// calendar event). It consolidates what used to be a row of header buttons into
// one menu so the header stays uncluttered. Reuses the nav dropdown's look
// (.att-pop / .att-menu-link) and its close-on-outside-click / Escape behaviour.
import { useEffect, useRef, useState } from 'react'
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
  const ref = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape (mirrors AttorneyTopNav).
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="att-pop-anchor" ref={ref}>
      <button
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
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {triggerContent ?? (
          <>
            {label}
            <ChevronDownIcon size={15} />
          </>
        )}
      </button>
      {open && (
        <div className={`att-pop att-menu-pop ${align === 'left' ? 'align-left' : ''}`} role="menu">
          {items.map((item) => {
            const body = (
              <>
                {item.icon && <span className="att-menu-ico">{item.icon}</span>}
                <span>{item.label}</span>
              </>
            )
            if (item.href && !item.disabled) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  role="menuitem"
                  className="att-menu-link"
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
                className="att-menu-link"
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
        </div>
      )}
    </div>
  )
}
