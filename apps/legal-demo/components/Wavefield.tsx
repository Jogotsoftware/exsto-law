// FIRM-LANDING-3 / COMP-RESTYLE-1 — the decorative wavefield behind the public
// front-door surfaces (firm landing, attorney sign-in, booking funnel).
// Deterministic stand-in for the approved comps' precomputed fields: ~40
// layered polylines drifting toward the lower right, amplitude and spacing
// growing with depth, opacity rising to a mid-field peak then fading out.
// Rows are module-level: computed once per variant, shared by every consumer.
//
// The three comps share one geometry but differ in color mix and intensity:
//   landing — blue-dominant, every 6th row gold, strongest strokes (the firm
//             front door's field). Blues take the caller's brand gradient.
//   signin  — gold-dominant, every 6th row blue, ~1/3 the landing intensity
//             (the sign-in card floats on a much quieter field).
//   intake  — ALL gold at roughly half intensity: the funnel's field is
//             tenant-neutral by design (gold is the fixed product accent), so
//             every firm's funnel shares it regardless of brand color.

// Fixed gold accent pair (matches the comps' pl-gold gradient).
const GOLD = '#E6C983'
const GOLD_DEEP = '#B98F3D'

export type WavefieldVariant = 'landing' | 'signin' | 'intake'

interface WaveRow {
  d: string
  gold: boolean
  width: number
  opacity: number
}

interface VariantProfile {
  // Opacity curve: start → peak (at row `peakRow`) → end, matching each comp's
  // measured stroke-opacity ramp.
  start: number
  peak: number
  end: number
  peakRow: number
  // Which rows are gold. 'all' = the intake comp's tenant-neutral field.
  gold: (i: number) => boolean
}

const PROFILES: Record<WavefieldVariant, VariantProfile> = {
  landing: { start: 0.16, peak: 0.35, end: 0.05, peakRow: 17, gold: (i) => i % 6 === 3 },
  signin: { start: 0.055, peak: 0.121, end: 0.018, peakRow: 17, gold: (i) => i % 6 !== 3 },
  intake: { start: 0.095, peak: 0.19, end: 0.04, peakRow: 18, gold: () => true },
}

function buildWaveRows(variant: WavefieldVariant): WaveRow[] {
  const p = PROFILES[variant]
  const rows: WaveRow[] = []
  const N = 40
  const xs: number[] = []
  for (let x = -40; x <= 1480; x += 24) xs.push(x)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const baseY = 118 + i * 12 + t * t * 230
    const amp = 26 + 205 * t
    const lam = 265 + 130 * t
    const pts = xs.map((x) => {
      const y =
        baseY +
        amp * Math.sin((x - 430 - 300 * t) / lam) +
        amp * 0.35 * Math.sin((x + 220 * t) / (lam * 0.53) + 1.7)
      return `${x} ${y.toFixed(1)}`
    })
    const opacity =
      i <= p.peakRow
        ? p.start + (p.peak - p.start) * (i / p.peakRow)
        : p.peak - (p.peak - p.end) * ((i - p.peakRow) / (N - 1 - p.peakRow))
    rows.push({
      d: `M${pts.join(' L')}`,
      gold: p.gold(i),
      width: 0.8 + i * 0.042,
      opacity: Number(opacity.toFixed(3)),
    })
  }
  return rows
}

const ROW_CACHE = new Map<WavefieldVariant, WaveRow[]>()
function rowsFor(variant: WavefieldVariant): WaveRow[] {
  let rows = ROW_CACHE.get(variant)
  if (!rows) {
    rows = buildWaveRows(variant)
    ROW_CACHE.set(variant, rows)
  }
  return rows
}

// The gradient ids are per-instance (suffixed) so two wavefields on one page
// (or a route transition overlap) can't cross-reference each other's defs.
export function Wavefield({
  brand,
  brandDeep,
  className,
  idSuffix = 'a',
  variant = 'landing',
}: {
  brand: string
  brandDeep: string
  className: string
  idSuffix?: string
  variant?: WavefieldVariant
}): React.JSX.Element {
  const brandId = `fl-w-brand-${idSuffix}`
  const goldId = `fl-w-gold-${idSuffix}`
  return (
    <svg
      className={className}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id={brandId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand} />
          <stop offset="1" stopColor={brandDeep} />
        </linearGradient>
        <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        {rowsFor(variant).map((r, i) => (
          <path
            key={i}
            d={r.d}
            stroke={r.gold ? `url(#${goldId})` : `url(#${brandId})`}
            strokeWidth={r.width}
            strokeOpacity={r.opacity}
          />
        ))}
      </g>
    </svg>
  )
}
