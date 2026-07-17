'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { UnifiedAssistantChat } from '@/components/UnifiedAssistantChat'

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

// The comp's FAB icon (WP-L): a navy chat-bubble outline with the gemstar cluster
// twinkling through its open corner. The gradient is the shared GemSparkle cycle
// (per-instance id — SVG ids are document-global).
function AssistantFabIcon(): React.ReactElement {
  const gradientId = `li-uac-fabgem-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shineId = `li-uac-fabshine-${gradientId}`
  // Three separate star paths so each twinkles on its own beat (li-gemstar).
  const starA = 'M16.4 0.8 17.85 3.75 20.8 5.2 17.85 6.65 16.4 9.6 14.95 6.65 12 5.2 14.95 3.75Z'
  const starB =
    'M11.6 8.3 12.42 9.98 14.1 10.8 12.42 11.63 11.6 13.3 10.78 11.63 9.1 10.8 10.78 9.98Z'
  const starC =
    'M14.7 11.8 15.23 12.87 16.3 13.4 15.23 13.93 14.7 15 14.17 13.93 13.1 13.4 14.17 12.87Z'
  return (
    <svg className="li-gemstar" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0">
            <animate
              attributeName="stop-color"
              values="#F3A6E4;#B79BF7;#7FB8FF;#54E6DE;#93EFB9;#F1EE9E;#F3A6E4"
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset=".5">
            <animate
              attributeName="stop-color"
              values="#7FB8FF;#54E6DE;#93EFB9;#F1EE9E;#F3A6E4;#B79BF7;#7FB8FF"
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="1">
            <animate
              attributeName="stop-color"
              values="#93EFB9;#F1EE9E;#F3A6E4;#B79BF7;#7FB8FF;#54E6DE;#93EFB9"
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <animateTransform
            attributeName="gradientTransform"
            type="rotate"
            values="0 12 12;360 12 12"
            dur="22s"
            repeatCount="indefinite"
          />
        </linearGradient>
        {/* The comp FAB's white shine sweeping across the cluster. */}
        <linearGradient id={shineId} x1="2" y1="4" x2="12" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="0.58" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="-18 0;18 0;-18 0"
            dur="4.5s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <path
        d="M6 3H13.2M19 9.3V15A3 3 0 0 1 16 18H15V21L11.5 18H6A3 3 0 0 1 3 15V6A3 3 0 0 1 6 3"
        fill="none"
        stroke="#1E2E4E"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={starA} fill={`url(#${gradientId})`} />
      <path d={starB} fill={`url(#${gradientId})`} style={{ animationDelay: '.4s' }} />
      <path d={starC} fill={`url(#${gradientId})`} style={{ animationDelay: '.9s' }} />
      <path d={starA} fill={`url(#${shineId})`} />
      <path d={starB} fill={`url(#${shineId})`} />
      <path d={starC} fill={`url(#${shineId})`} />
    </svg>
  )
}

// Floating assistant FAB, mounted once in the attorney layout. It hosts the unified
// assistant chat and picks up the CURRENT PAGE's context when opened: a matter
// or a client/contact, else global app-help + beta feedback. WP-L: the FAB and the
// panel chrome (navy header, resizable corner) follow the Legal Instruments comp;
// the header itself lives inside UnifiedAssistantChat (it needs the model state).
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
        className="li-uac-fab"
        onClick={openChat}
        aria-label="Ask the Legal Assistant"
        title="Ask the Legal Assistant"
      >
        <AssistantFabIcon />
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
      className="li-uac-panel"
      role="dialog"
      aria-label="Legal Assistant"
      style={size ? { width: `${size.w}px`, height: `${size.h}px` } : undefined}
    >
      <div
        className="li-uac-resize"
        onPointerDown={startResize}
        role="separator"
        aria-label="Resize chat (drag the top-left corner)"
        title="Drag to resize"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 10V4h6" />
          <path d="M4 4l7 7" />
        </svg>
      </div>
      <div className="li-uac-panel-body" ref={inputFocusRef}>
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
          placeholder="Something else..? Tell me how I can help"
          initialInput={primed?.text}
          onClose={() => setOpen(false)}
        />
      </div>
    </div>
  )
}
