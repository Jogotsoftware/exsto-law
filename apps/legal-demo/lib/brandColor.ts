// UIWALK-2 (PR-3) — firm brand-color helpers. The stored value is a
// server-validated #rrggbb (handlers/firmProfile.ts rejects anything else);
// these helpers only ever run on values of that shape, plus a client-side
// guard for in-flight picker states.

export const HEX_RE = /^#[0-9a-f]{6}$/i

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

// Darken an #rrggbb by `amount` (0..1). Used to derive the rail / portal-header
// shade from the one stored brand color (the product's own pair is
// navy #1b2a4a over rail #14213d — roughly an 18% darken), so a firm sets a
// single color and both chrome layers stay related.
export function darkenHex(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex
  const f = Math.max(0, Math.min(1, amount))
  const channel = (i: number): string =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

// COMP-RESTYLE-1 — channel-wise mix of `hex` into `base` (weight 0..1 of hex).
// Used to derive the cream shell's brand tint from the one stored color, so
// CSS keeps exact comp literals as fallbacks instead of a color-mix() whose
// fallback path would drift from the comp.
export function mixHex(hex: string, base: string, weight: number): string {
  if (!isHexColor(hex) || !isHexColor(base)) return base
  const w = Math.max(0, Math.min(1, weight))
  const channel = (i: number): string =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * w + parseInt(base.slice(i, i + 2), 16) * (1 - w))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

// The CSS custom properties a shell root sets from the firm's brand color.
// Consumed by tail rules in globals.css: var(--li-brand, <product default>).
export function brandVars(hex: string | null | undefined): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return {
    ['--li-brand' as string]: hex,
    ['--li-brand-deep' as string]: darkenHex(hex, 0.18),
  }
}

// COMP-RESTYLE-1 — the booking funnel's brand vars. Set ONLY when the firm has
// stored a color: unset, the .bk-* fallbacks are the intake comp's exact
// light-blue pair (#7bafd4 / #5a97c4); set, the whole funnel re-tints.
export function bookBrandVars(hex: string | null | undefined): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return {
    ['--bk-brand' as string]: hex,
    ['--bk-brand-deep' as string]: darkenHex(hex, 0.12),
  }
}
