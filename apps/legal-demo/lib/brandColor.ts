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

// BRANDING-SECTION-1 — the companion tone that sits beside the primary brand
// color (the console rail under the top bar, the funnel's deeper blue, the
// landing page's deep ink). It was always DERIVED by darkening the one stored
// color, which keeps a single-color firm coherent but can never produce a real
// brand PAIR (navy + gold, maroon + cream). A stored secondary color now wins
// wherever a companion is needed; unset, the derivation is exactly what it was,
// so no existing firm's chrome moves.
function companion(
  hex: string,
  secondary: string | null | undefined,
  derivedDarken: number,
): string {
  return isHexColor(secondary) ? secondary : darkenHex(hex, derivedDarken)
}

// The CSS custom properties a shell root sets from the firm's brand color.
// Consumed by tail rules in globals.css: var(--li-brand, <product default>).
export function brandVars(
  hex: string | null | undefined,
  secondary?: string | null,
): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return {
    ['--li-brand' as string]: hex,
    ['--li-brand-deep' as string]: companion(hex, secondary, 0.18),
  }
}

// COMP-RESTYLE-1 — the booking funnel's brand vars. Set ONLY when the firm has
// stored a color: unset, the .bk-* fallbacks are the intake comp's exact
// light-blue pair (#7bafd4 / #5a97c4); set, the whole funnel re-tints.
export function bookBrandVars(
  hex: string | null | undefined,
  secondary?: string | null,
): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return {
    ['--bk-brand' as string]: hex,
    ['--bk-brand-deep' as string]: companion(hex, secondary, 0.12),
  }
}

// BRANDING-SECTION-1 — the landing page's brand family (COMP-RESTYLE-1's
// --fl-* set), in one place instead of inline in the component, so the
// secondary-color override lands the same way it does for the console and the
// funnel. `--fl-brand-icon` (the tile/arrow ink) and `--fl-brand-deep` are the
// two companion tones there.
export function landingBrandVars(
  hex: string | null | undefined,
  secondary?: string | null,
): React.CSSProperties | undefined {
  if (!isHexColor(hex)) return undefined
  return {
    ['--fl-brand' as string]: hex,
    ['--fl-brand-deep' as string]: companion(hex, secondary, 0.28),
    ['--fl-brand-icon' as string]: companion(hex, secondary, 0.1),
    // The cream shell's tint stays keyed to the PRIMARY: it is a wash of the
    // page background, not a companion ink, and mixing a contrasting secondary
    // into it muddies the paper.
    ['--fl-bg-tint' as string]: mixHex(hex, '#fdfbf5', 0.13),
  }
}

// FIRM-BRANDING-1 — a firm uploads ONE logo file, and roughly half of real firm
// logos are "reversed" artwork: white/light ink drawn for a dark website header.
// Nothing about a data URL says which it is, so the uploader MEASURES it once —
// average luminance over the non-transparent pixels — and the answer is stored
// as a firm fact (firm_logo_tone, migration 0203).
//
// BRANDING-SECTION-1 — that fact is now ADVISORY ONLY. It used to drive an
// automatic plate/box behind reversed artwork on light surfaces; that backdrop
// is gone (founder call — the product must not decorate a firm's mark). Tone
// now only powers the uploader's hint that a light mark may be hard to see on
// light pages, where the answer is to upload a dark variant and put the light
// one in the header-logo slot.
//
// Returns 'light' when the ink is light, 'dark' otherwise. Resolves to null if
// the image can't be measured — callers treat that as "unknown" and say nothing.
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

// BRANDING-SECTION-1 — `hexLuminance` / `plateHex` / `logoPlateVars` were
// removed here. They existed to compute the fill of an automatic plate behind
// reversed artwork; the product no longer paints anything behind an uploaded
// logo (see measureLogoTone above). A firm that needs its mark to read on both
// a light page and the dark console bar uploads the right variant into each of
// the two logo slots — the product does not invent a backdrop on their behalf.
