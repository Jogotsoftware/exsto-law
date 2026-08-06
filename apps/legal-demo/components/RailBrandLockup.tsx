'use client'

// RAIL-FOLLOWUPS-1 — the brand lockup, and the rail's pin control, living in
// the TOP BAR. Shared by the attorney console and the client portal so the two
// are identical by construction rather than by copy-paste.
//
// What it does
// ------------
// Collapsed, the bar's left edge shows the twinkle-stars mark alone, centered
// over the rail's 58px icon column below it. As the rail expands, the twinkle
// SLIDES right along the bar — transform only, no layout thrash — into the
// exact spot it occupies at the tail of the "Legal Instruments" wordmark, while
// a stars-less wordmark fades in beneath it. The mark never swaps out, so the
// two states read as one lockup assembling itself. Clicking it pins/unpins the
// rail, and hovering it counts as hovering the rail (the mark sits directly
// above the icon column, so treating them as one hover zone is what a user
// expects).
//
// The geometry is derived, not eyeballed. In the wordmark asset (viewBox
// 0 0 360 64) the stars live in a `<g transform="translate(302 10) scale(0.9)">`.
// Rendering the wordmark at LOCKUP_H px gives scale s = LOCKUP_H / 64, so the
// mark's "home" box is left 302s, top 10s, width 31.5*0.9*s, height 27.5*0.9*s
// — exactly where public/brand/wordmark-white-gold-nostars.svg has a hole. The
// collapsed transform in globals.css (.li-rail-mark) is the inverse of that,
// landing the mark 26px wide over the icon column. Change LOCKUP_H here and the
// CSS constants must be recomputed with it; the comment there carries the
// arithmetic.
//
// One colourway only: the bar is navy, or the firm's brand color, and
// `.li-topbar`/`.li-cp-top` have always assumed that surface is dark (both set
// white text unconditionally). So the lockup is the white/gold pairing —
// white wordmark, gold stars. The RAIL below adapts light/dark; the bar does
// not, and this follows the bar.
import { useRailShell } from '@/components/RailShellState'

// Wordmark render height, px. See the geometry note above before changing it.
const LOCKUP_H = 30

// The stars, in the wordmark's own local coordinates (the `<g>`'s space), so
// the mark is pixel-identical to the one the asset carries.
const STAR_BIG =
  'M19 3 C19.7 10 24 14.3 31 15 C24 15.7 19.7 20 19 27 C18.3 20 14 15.7 7 15 C14 14.3 18.3 10 19 3 Z'
const STAR_SMALL =
  'M6.5 0.5 C6.8 3.9 9.1 6.2 12.5 6.5 C9.1 6.8 6.8 9.1 6.5 12.5 C6.2 9.1 3.9 6.8 0.5 6.5 C3.9 6.2 6.2 3.9 6.5 0.5 Z'

const BIG_STOPS: ReadonlyArray<readonly [string, string]> = [
  ['0', '#6E5222'],
  ['0.22', '#9C7430'],
  ['0.45', '#C9992F'],
  ['0.62', '#EEC85C'],
  ['0.78', '#F3DD96'],
  ['1', '#9C7430'],
]
const SMALL_STOPS: ReadonlyArray<readonly [string, string]> = [
  ['0', '#6E5222'],
  ['0.35', '#C9992F'],
  ['0.6', '#EEC85C'],
  ['1', '#9C7430'],
]

export function RailBrandLockup({
  idPrefix,
  pinLabel,
  unpinLabel,
}: {
  /** Keeps the SVG gradient ids unique per mount — colliding ids are a nasty bug class. */
  idPrefix: string
  pinLabel: string
  unpinLabel: string
}): React.JSX.Element {
  const { expanded, pinned, togglePin, onRailEnter, onRailLeave } = useRailShell()
  const big = `${idPrefix}-gem-1`
  const small = `${idPrefix}-gem-2`
  const label = pinned ? unpinLabel : pinLabel
  return (
    <div
      className={`li-brandlock${expanded ? ' is-open' : ''}`}
      onMouseEnter={onRailEnter}
      onMouseLeave={onRailLeave}
    >
      <button
        type="button"
        className={`li-brandlock-btn${pinned ? ' is-pinned' : ''}`}
        onClick={togglePin}
        aria-pressed={pinned}
        aria-label={label}
        title={label}
      >
        <span className="li-brandlock-inner" style={{ height: LOCKUP_H }}>
          <img
            className="li-brandlock-word"
            src="/brand/wordmark-white-gold-nostars.svg"
            alt=""
            aria-hidden="true"
          />
          <svg
            className="li-brandlock-mark li-gemstar"
            viewBox="0 0 31.5 27.5"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={big} x1="7" y1="3" x2="31" y2="27" gradientUnits="userSpaceOnUse">
                {BIG_STOPS.map(([o, c]) => (
                  <stop key={o} offset={o} stopColor={c} />
                ))}
              </linearGradient>
              <linearGradient
                id={small}
                x1="0.5"
                y1="0.5"
                x2="12.5"
                y2="12.5"
                gradientUnits="userSpaceOnUse"
              >
                {SMALL_STOPS.map(([o, c]) => (
                  <stop key={o} offset={o} stopColor={c} />
                ))}
              </linearGradient>
            </defs>
            <path d={STAR_BIG} fill={`url(#${big})`} />
            <path d={STAR_SMALL} fill={`url(#${small})`} style={{ animationDelay: '.4s' }} />
          </svg>
        </span>
      </button>
    </div>
  )
}
