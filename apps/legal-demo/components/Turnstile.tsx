'use client'

// Cloudflare Turnstile widget for the public booking form.
//
// This is the FRONTEND half of the public-write CAPTCHA gate. The server half
// (lib/captcha.ts, /api/client/mcp) is a no-op until TURNSTILE_SECRET is set;
// this widget is correspondingly gated on NEXT_PUBLIC_TURNSTILE_SITE_KEY:
//   - unset (demo/dev default) → the parent should not render this at all and
//     submits with no token; both halves are no-ops, booking works unchanged.
//   - set → load the Turnstile script once, render the widget, and surface the
//     token (or null on expiry/error) to the parent via onToken.
//
// Minimal + dependency-free: a script tag plus the explicit window.turnstile
// render API. No npm package.

import { useEffect, useRef } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SCRIPT_ID = 'cf-turnstile-script'

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  'timeout-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    onloadTurnstileCallback?: () => void
  }
}

// Load the Turnstile script exactly once across the app. Resolves when
// window.turnstile is available (whether we just injected it or it already was).
function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve()
    if (window.turnstile) return resolve()

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (window.turnstile) return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Turnstile script failed to load')),
        {
          once: true,
        },
      )
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Turnstile script failed to load')), {
      once: true,
    })
    document.head.appendChild(script)
  })
}

export interface TurnstileProps {
  siteKey: string
  // Receives the token on success, or null when it expires / errors out so the
  // parent can disable submit and require a fresh solve.
  onToken: (token: string | null) => void
  theme?: 'light' | 'dark' | 'auto'
  // Optional: parent passes a function ref it can call to reset the widget
  // (e.g. after a failed submit). Receives a reset() callback once mounted.
  onReady?: (reset: () => void) => void
}

export function Turnstile({ siteKey, onToken, theme = 'auto', onReady }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  // Keep the latest callbacks in refs so render() (run once) always calls the
  // current handlers without re-rendering the widget on every parent render.
  const onTokenRef = useRef(onToken)
  const onReadyRef = useRef(onReady)
  onTokenRef.current = onToken
  onReadyRef.current = onReady

  useEffect(() => {
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled) return
        const el = containerRef.current
        if (!el || !window.turnstile) return
        // Guard against double-render in React 18 StrictMode dev remounts.
        if (widgetIdRef.current) return

        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })

        onReadyRef.current?.(() => {
          if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current)
            onTokenRef.current(null)
          }
        })
      })
      .catch(() => {
        if (!cancelled) onTokenRef.current(null)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey, theme])

  return <div ref={containerRef} className="cf-turnstile-container" />
}
