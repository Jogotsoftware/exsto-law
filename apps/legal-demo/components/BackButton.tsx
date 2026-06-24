'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from '@/components/icons'

// One universal "Back" control for the whole app, replacing the old per-page
// "Back to <specific page>" text links. By default it returns to the actual prior
// page the user came from (browser history) rather than a hard-coded parent, so
// it's correct no matter how they arrived. `fallback` is used when there is no
// usable in-app history (a fresh tab, or the first page after login).
//
// `forceFallback` is for pages reached PRIMARILY via an external link (e.g. the
// invoice/pay page opened from an email): there, browser history may point back
// out of the app (to the mail client / previous site), and `history.length`
// can't tell an in-app entry from a cross-origin one — so "Back" should always
// go to the in-app parent (`fallback`) instead of risking a hop out.
//
// `onBack` is an escape hatch for places where "back" needs custom behaviour
// instead of plain history (e.g. exiting a step-through review session, which must
// clear its sessionStorage and return to the queue rather than step to the prior
// draft). When provided, it fully handles the click and history is not used.
export function BackButton({
  fallback = '/',
  label = 'Back',
  className,
  style,
  onBack,
  forceFallback = false,
}: {
  fallback?: string
  label?: string
  className?: string
  style?: React.CSSProperties
  onBack?: () => void
  forceFallback?: boolean
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      className={className}
      // Styled inline so it needs no global CSS: the base `button` element style
      // already gives the bordered, hover-able "pretty button" look; this just
      // lays out the chevron + label and adds the spacing below. Callers can
      // override (e.g. drop the margin inside a horizontal bar) via `style`.
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        paddingLeft: 'var(--space-2)',
        fontWeight: 600,
        marginBottom: 'var(--space-3)',
        ...style,
      }}
      onClick={() => {
        if (onBack) {
          onBack()
          return
        }
        if (!forceFallback && typeof window !== 'undefined' && window.history.length > 1)
          router.back()
        else router.push(fallback)
      }}
    >
      <ChevronLeftIcon size={16} style={{ flex: 'none', opacity: 0.75 }} />
      <span>{label}</span>
    </button>
  )
}
