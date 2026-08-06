// FIRM-LANDING-3 — the comp's scales-of-justice crest as a bare, size- and
// color-parameterized SVG. One source of truth for everywhere the "attorney
// logo" renders: the landing's white tile (FirmLandingPage) and the per-tenant
// link-share image (/og). Inline styles only — the /og consumer renders this
// through Satori (next/og ImageResponse), which supports SVG elements but no
// CSS classes.
export function FirmMarkGlyph({ brand, size }: { brand: string; size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="10 26 492 470"
      fill={brand}
      stroke="none"
      style={{ transform: 'scaleY(0.9)' }}
    >
      <path d="M256 26 C268 44 268 66 256 80 C244 66 244 44 256 26 Z" />
      <rect x="247" y="80" width="18" height="11" rx="3" />
      <circle cx="256" cy="126" r="9" />
      <path d="M243 150 h26 l-5 -24 h-16 z" />
      <path d="M247 150 L265 150 L269 420 L243 420 Z" />
      <ellipse cx="256" cy="292" rx="15" ry="6" />
      <ellipse cx="256" cy="356" rx="13" ry="5" />
      <path d="M236 418 h40 v14 h-40 z" />
      <ellipse cx="256" cy="446" rx="40" ry="10" />
      <path d="M212 452 h88 v13 q0 6 -8 6 h-72 q-8 0 -8 -6 z" />
      <ellipse cx="256" cy="486" rx="72" ry="15" />
      <g transform="rotate(-5 256 150)">
        <path
          d="M128 150 Q256 128 384 150"
          fill="none"
          stroke={brand}
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M128 150 c-17 -1 -24 -15 -12 -23 9 -6 19 1 15 11"
          fill="none"
          stroke={brand}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M384 150 c17 -1 24 -15 12 -23 -9 -6 -19 1 -15 11"
          fill="none"
          stroke={brand}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <circle cx="128" cy="150" r="9" />
        <circle cx="384" cy="150" r="9" />
      </g>
      <path d="M128 152 L82 286 M128 152 L174 286" fill="none" stroke={brand} strokeWidth="4" />
      <path d="M384 152 L338 286 M384 152 L430 286" fill="none" stroke={brand} strokeWidth="4" />
      <path d="M66 284 Q128 296 190 284 Q172 338 128 342 Q84 338 66 284 Z" />
      <path d="M322 284 Q384 296 446 284 Q428 338 384 342 Q340 338 322 284 Z" />
    </svg>
  )
}
