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

// FIRM-BRANDING-1 — a firm uploads ONE logo file, and roughly half of real firm
// logos are "reversed" artwork: white/light ink drawn for a dark website header.
// That file is invisible on a white invoice; a dark-ink file is equally
// invisible on the navy console bar. Nothing about a data URL says which it is,
// so the uploader MEASURES it once — average luminance over the non-transparent
// pixels — and the answer is stored as a firm fact (firm_logo_tone, migration
// 0203) that both the browser and the server-side invoice renderer read.
//
// Returns 'light' when the ink is light (needs a dark backdrop), 'dark'
// otherwise. Resolves to null if the image can't be measured — callers treat
// that as "unknown" and render the logo bare, which is the pre-0203 behaviour.
export async function measureLogoTone(dataUrl: string): Promise<'light' | 'dark' | null> {
  if (typeof window === 'undefined') return null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('logo could not be decoded'))
      el.src = dataUrl
    })
    // Downsample hard: tone is a whole-image average, not a detail question.
    const w = Math.min(64, img.naturalWidth || 64)
    const h = Math.min(64, img.naturalHeight || 64)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    let sum = 0
    let counted = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0
      // Ignore transparent and near-transparent pixels: on a logo with a
      // transparent background they ARE the background, and counting them
      // would make every mark read as "dark".
      if (alpha < 128) continue
      // Rec. 601 luma — close enough, and cheap.
      sum += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
      counted++
    }
    if (counted === 0) return null
    return sum / counted > 140 ? 'light' : 'dark'
  } catch {
    return null
  }
}

// Relative luminance (0..1) of an #rrggbb, Rec. 601. Used to decide whether a
// color is dark enough to sit behind light artwork.
export function hexLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0
  const ch = (i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255
  return 0.299 * ch(1) + 0.587 * ch(3) + 0.114 * ch(5)
}

// FIRM-BRANDING-1 — the fill for a plate that sits BEHIND light (reversed)
// artwork. A firm's brand color can itself be pale (the pilot firm's legacy
// invoice accent is #8ac6f4), and white artwork on pale blue is as unreadable
// as white on white — so a light brand color is darkened until it can carry
// light ink. A brand color that is already dark is used as-is, so the plate
// still reads as the firm's color.
export function plateHex(hex: string | null | undefined): string {
  if (!isHexColor(hex)) return '#14213d'
  let out = hex
  for (let i = 0; i < 6 && hexLuminance(out) > 0.32; i++) out = darkenHex(out, 0.25)
  return out
}

// The CSS var a light surface sets so a reversed logo's plate takes the FIRM's
// color rather than the product navy. Paired with .li-logo-chip-dark, which
// reads var(--li-logo-plate, #14213d).
export function logoPlateVars(hex: string | null | undefined): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return { ['--li-logo-plate' as string]: plateHex(hex) }
}
