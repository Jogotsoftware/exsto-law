'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { UnifiedAssistantChat } from '@/components/UnifiedAssistantChat'
import { MessageCircleIcon, XIcon } from '@/components/icons'

const INTRO_GLOBAL = 'How can I serve you, Counselor?'
const INTRO_MATTER = 'How can I serve you, Counselor? Grounded in the matter you’re viewing.'
const INTRO_CONTACT = 'How can I serve you, Counselor? Grounded in the client you’re viewing.'

// The attorney's preferred panel size, remembered across sessions (beta ask:
// "resizable, larger default"). Per-browser UI state, so localStorage.
const PANEL_SIZE_KEY = 'exsto.assistant.panelSize'
// Floor the resize near the default size (≈440×660) — the attorney can grow the
// panel but never shrink it much below where it starts (beta ask).
const MIN_W = 420
const MIN_H = 600

// Derive the assistant's context from the page you're on, so the one global chat
// follows you: open it on a matter and it's grounded in that matter; on a contact,
// that contact; anywhere else it's the general app-help / feedback chat. Client
// (CRM company) scope isn't a chat scope server-side yet, so those pages get the
// general chat for now.
function scopeForPath(pathname: string): {
  matterEntityId?: string
  contactEntityId?: string
} {
  const m = pathname.match(/^\/attorney\/matters\/([^/]+)/)
  if (m && m[1] && m[1] !== 'new') return { matterEntityId: m[1] }
  const c = pathname.match(/^\/attorney\/crm\/contacts\/([^/]+)/)
  if (c && c[1]) return { contactEntityId: c[1] }
  return {}
}

// Floating assistant FAB, mounted once in the attorney layout. It hosts the unified
// assistant chat and now picks up the CURRENT PAGE's context when opened: a matter
// or a client/contact, else global app-help + beta feedback. (Replaces the
// separate per-matter embedded chat — the one assistant follows the attorney.)
export function FeedbackChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Snapshot the scope when the panel opens, so an in-progress chat doesn't reset
  // mid-conversation if the attorney navigates while it's open.
  const [scope, setScope] = useState<{ matterEntityId?: string; contactEntityId?: string }>({})
  // A prompt another surface primed the chat with (via the exsto:assistant:prime
  // window event) + a nonce so re-priming the same text re-seeds the composer. The
  // attorney still presses Send — priming never auto-submits.
  const [primed, setPrimed] = useState<{ text: string; nonce: number } | null>(null)
  const inputFocusRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Custom panel size (px). null ⇒ use the CSS default. Stays null on the server
  // and first client render so SSR markup matches; a persisted size is applied in
  // an effect after mount (no hydration mismatch).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (open) inputFocusRef.current?.querySelector('textarea')?.focus()
  }, [open])

  // Open the assistant with a primed prompt when another surface dispatches
  // exsto:assistant:prime (e.g. the service Workflow tab's "Build with AI" button).
  // The chat opens grounded in the CURRENT page, with the composer pre-written; the
  // attorney reviews and presses Send. A nonce makes re-priming re-seed the composer.
  useEffect(() => {
    function onPrime(e: Event) {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail
      const text = typeof detail?.prompt === 'string' ? detail.prompt : ''
      setScope(scopeForPath(pathname))
      setPrimed({ text, nonce: Date.now() })
      setOpen(true)
    }
    window.addEventListener('exsto:assistant:prime', onPrime as EventListener)
    return () => window.removeEventListener('exsto:assistant:prime', onPrime as EventListener)
  }, [pathname])

  // Restore the remembered size once, client-side.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PANEL_SIZE_KEY)
      if (!raw) return
      const v = JSON.parse(raw) as { w?: unknown; h?: unknown }
      if (typeof v.w === 'number' && typeof v.h === 'number') setSize({ w: v.w, h: v.h })
    } catch {
      // ignore — falls back to the CSS default
    }
  }, [])

  function openChat() {
    setScope(scopeForPath(pathname))
    // A manual open is a fresh chat — drop any stale primed prompt so it doesn't
    // re-seed the composer.
    setPrimed(null)
    setOpen(true)
  }

  // Drag the top-left corner to resize. The panel is anchored bottom-right, so
  // growing width/height expands it up and to the left — toward the handle. We
  // listen on window (not pointer-capture) so a fast drag never drops the grab.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = e.clientX
    const startY = e.clientY
    const startW = rect.width
    const startH = rect.height
    const maxW = window.innerWidth - 24
    const maxH = window.innerHeight - 24
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(maxW, Math.max(MIN_W, startW + (startX - ev.clientX)))
      const h = Math.min(maxH, Math.max(MIN_H, startH + (startY - ev.clientY)))
      setSize({ w, h })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setSize((cur) => {
        if (cur) {
          try {
            window.localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(cur))
          } catch {
            // ignore — remembering the size is a nicety
          }
        }
        return cur
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!open) {
    return (
      <button
        type="button"
        className="feedback-fab"
        onClick={openChat}
        aria-label="Open assistant"
        title="Assistant"
      >
        <MessageCircleIcon size={24} />
      </button>
    )
  }

  const scoped = Boolean(scope.matterEntityId || scope.contactEntityId)
  const intro = scope.matterEntityId
    ? INTRO_MATTER
    : scope.contactEntityId
      ? INTRO_CONTACT
      : INTRO_GLOBAL

  return (
    <div
      ref={panelRef}
      className="feedback-panel"
      role="dialog"
      aria-label="Assistant"
      style={size ? { width: `${size.w}px`, height: `${size.h}px` } : undefined}
    >
      <div
        className="feedback-panel-resize"
        onPointerDown={startResize}
        role="separator"
        aria-label="Resize chat (drag the top-left corner)"
        title="Drag to resize"
      />
      <div className="feedback-panel-head">
        <div className="feedback-panel-title">Assistant</div>
        <button
          type="button"
          className="feedback-panel-close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>
      <div className="feedback-panel-body" ref={inputFocusRef}>
        {/* Keyed by scope so opening on a different page starts a fresh, correctly
            grounded chat (and loads that matter/contact's thread). */}
        <UnifiedAssistantChat
          key={`${scope.matterEntityId ?? scope.contactEntityId ?? 'global'}${
            primed ? `:primed:${primed.nonce}` : ''
          }`}
          matterEntityId={scope.matterEntityId}
          contactEntityId={scope.contactEntityId}
          loadThread={scoped}
          intro={intro}
          placeholder="Ask a question or share feedback…"
          initialInput={primed?.text}
        />
      </div>
    </div>
  )
}
