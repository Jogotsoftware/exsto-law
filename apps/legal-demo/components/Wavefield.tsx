// FIRM-LANDING-3 — the decorative wavefield behind the public front-door
// surfaces (firm landing, attorney sign-in). Deterministic stand-in for the
// approved comp's precomputed field: ~40 layered polylines drifting toward
// the lower right, amplitude and spacing growing with depth, opacity rising
// to a mid-field peak then fading out. Every 6th row is gold (fixed product
// accent); the rest take the caller's brand gradient. Rows are module-level:
// computed once, shared by every consumer.

// Fixed gold accent pair (matches the comp's pl-gold gradient).
const GOLD = '#E6C983'
const GOLD_DEEP = '#B98F3D'

interface WaveRow {
  d: string
  gold: boolean
  width: number
  opacity: number
}

function buildWaveRows(): WaveRow[] {
  const rows: WaveRow[] = []
  const N = 40
  const peak = 17
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
      i <= peak
        ? 0.16 + (0.35 - 0.16) * (i / peak)
        : 0.35 - (0.35 - 0.05) * ((i - peak) / (N - 1 - peak))
    rows.push({
      d: `M${pts.join(' L')}`,
      gold: i % 6 === 3,
      width: 0.8 + i * 0.042,
      opacity: Number(opacity.toFixed(3)),
    })
  }
  return rows
}

const WAVE_ROWS = buildWaveRows()

// The gradient ids are per-instance (suffixed) so two wavefields on one page
// (or a route transition overlap) can't cross-reference each other's defs.
export function Wavefield({
  brand,
  brandDeep,
  className,
  idSuffix = 'a',
}: {
  brand: string
  brandDeep: string
  className: string
  idSuffix?: string
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
        {WAVE_ROWS.map((r, i) => (
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
