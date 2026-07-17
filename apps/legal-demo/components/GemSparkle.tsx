import { useId, type ReactElement } from 'react'

// The ONE animated AI affordance for the Legal Instruments redesign
// (docs/design/legal-instruments — fidelity spec). A four-point star filled
// with a slowly color-cycling, rotating gradient, twinkling via the global
// `li-gemtw` keyframes. Every AI-related control renders THIS component —
// never a bespoke sparkle — so the affordance reads identically everywhere.
// Reduced-motion users get a static star (global @media rule kills animation).

// SMIL stop-color cycles, offset per stop so the gradient shifts hue across
// the star (values lifted verbatim from the comp).
const CYCLE_A = '#F3A6E4;#B79BF7;#7FB8FF;#54E6DE;#93EFB9;#F1EE9E;#F3A6E4'
const CYCLE_B = '#7FB8FF;#54E6DE;#93EFB9;#F1EE9E;#F3A6E4;#B79BF7;#7FB8FF'
const CYCLE_C = '#93EFB9;#F1EE9E;#F3A6E4;#B79BF7;#7FB8FF;#54E6DE;#93EFB9'

const STAR_MAIN =
  'M12 3.3c.5 4.1 2.3 5.9 6.4 6.4-4.1.5-5.9 2.3-6.4 6.4-.5-4.1-2.3-5.9-6.4-6.4 4.1-.5 5.9-2.3 6.4-6.4z'
const STAR_TOP_RIGHT =
  'M19.4 2c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z'
const STAR_BOTTOM_LEFT =
  'M5 15.4c.18 1.4.82 2.02 2.2 2.2-1.38.18-2.02.82-2.2 2.2-.18-1.4-.82-2.02-2.2-2.2 1.38-.18 2.02-.82 2.2-2.2z'

export type GemSparkleProps = {
  /** Rendered square size in px (comp uses 14–24 depending on context). */
  size?: number
  /** Render the two small companion stars (staggered twinkle) — comp default. */
  secondary?: boolean
  className?: string
  title?: string
}

export function GemSparkle({
  size = 18,
  secondary = true,
  className,
  title,
}: GemSparkleProps): ReactElement {
  // Per-instance gradient id: many sparkles render on one page and SVG ids are
  // document-global — a shared literal id would tie every star to the first
  // instance's gradient (broken once that node unmounts).
  const gradientId = `li-gem-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      className={className ? `li-gemstar ${className}` : 'li-gemstar'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
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
              values={CYCLE_A}
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset=".5">
            <animate
              attributeName="stop-color"
              values={CYCLE_B}
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="1">
            <animate
              attributeName="stop-color"
              values={CYCLE_C}
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
      </defs>
      <path d={STAR_MAIN} fill={`url(#${gradientId})`} />
      {secondary ? (
        <>
          <path d={STAR_TOP_RIGHT} fill={`url(#${gradientId})`} style={{ animationDelay: '.4s' }} />
          <path
            d={STAR_BOTTOM_LEFT}
            fill={`url(#${gradientId})`}
            style={{ animationDelay: '.9s' }}
          />
        </>
      ) : null}
    </svg>
  )
}

// The comp's OTHER gemstar glyph: the sharp diamond three-star cluster used by
// the assistant panel header, FAB, and anywhere the comp shows the star trio.
// Three separate paths (not the comp's single compound path) so each star
// twinkles on its own staggered beat — the "3 star twinkle".
const CLUSTER_MAIN =
  'M14.5 5.4 17.42 11.08 23.1 14 17.42 16.92 14.5 22.6 11.58 16.92 5.9 14 11.58 11.08Z'
const CLUSTER_TOP_LEFT =
  'M6.3 1.6 7.86 4.64 10.9 6.2 7.86 7.76 6.3 10.8 4.74 7.76 1.7 6.2 4.74 4.64Z'
const CLUSTER_BOTTOM_LEFT =
  'M6 16.2 7.02 18.18 9 19.2 7.02 20.22 6 22.2 4.98 20.22 3 19.2 4.98 18.18Z'

export function GemCluster({
  size = 28,
  className,
  title,
}: {
  size?: number
  className?: string
  title?: string
}): ReactElement {
  const gradientId = `li-gem-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      className={className ? `li-gemstar ${className}` : 'li-gemstar'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
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
              values={CYCLE_A}
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset=".5">
            <animate
              attributeName="stop-color"
              values={CYCLE_B}
              dur="15s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="1">
            <animate
              attributeName="stop-color"
              values={CYCLE_C}
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
      </defs>
      <path d={CLUSTER_MAIN} fill={`url(#${gradientId})`} />
      <path d={CLUSTER_TOP_LEFT} fill={`url(#${gradientId})`} style={{ animationDelay: '.4s' }} />
      <path
        d={CLUSTER_BOTTOM_LEFT}
        fill={`url(#${gradientId})`}
        style={{ animationDelay: '.9s' }}
      />
    </svg>
  )
}

/**
 * The universal "AI is working" state: a gold shimmer sweeping across the
 * nearest positioned ancestor. Render it conditionally while an AI operation
 * runs; it is purely decorative (pointer-events: none, aria-hidden).
 */
export function GemShimmer({ className }: { className?: string }): ReactElement {
  return (
    <div
      className={className ? `li-shimmer-overlay ${className}` : 'li-shimmer-overlay'}
      aria-hidden="true"
    />
  )
}
