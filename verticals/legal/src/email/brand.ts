// Branded email design tokens for Pacheco Law Firm transactional mail.
//
// These mirror the app's brand scale (apps/legal-demo/app/globals.css —
// "authority navy + trust gold") so emails read as the same product as the
// redesigned UI. Email clients can't use CSS variables or external stylesheets,
// so the values are duplicated here as literals and inlined at render time.
//
// This is a self-contained DESIGN KIT (pure presentation). It deliberately does
// NOT import from, or write to, the live notification engine — see README.md for
// the conflict-free rationale and the wiring handoff.

export const COLORS = {
  navy900: '#0b1b3a',
  navy700: '#14306b',
  navy: '#1e3a8a',
  navy100: '#e5ebf7',
  navy50: '#f2f5fc',
  gold: '#b45309', // burnt-sienna "trust gold" — matches --gold in globals.css
  gold400: '#d08a3e',
  gold100: '#fbefdd',
  fg: '#0f172a',
  muted: '#475569',
  border: '#e2e8f0',
  bg: '#f5f8fc',
  surface: '#ffffff',
  ok: '#15803d',
  okSoft: '#dcfce7',
} as const

// Email-safe font stacks. Serif (Georgia) carries the "authority" voice in the
// firm name + headings; the sans stack covers body copy. Both render natively in
// every major client (no web fonts — they're unreliable in Outlook/Gmail).
export const FONTS = {
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const

export const FIRM = {
  name: 'Pacheco Law Firm, PLLC',
  shortName: 'Pacheco Law',
  attorney: 'Juan Carlos Pacheco',
  addressLine: '418 Patton Avenue, Suite 210',
  cityLine: 'Asheville, North Carolina 28801',
  // The product wordmark the redesign is moving to (Contract / branding canary).
  // Kept here so the email footer matches whatever the app header shows.
  product: 'Legal Instruments',
} as const

// Minimal HTML escape for interpolated, possibly-untrusted variable values
// (client names, matter subjects, etc.). URLs passed to href are the caller's
// responsibility — they come from our own link builders, never user input.
export function esc(value: unknown): string {
  const sStr = value == null ? '' : String(value)
  return sStr
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Coalesce empty/nullish to a fallback (mirrors the existing renderer's `s()`).
export function val(v: unknown, fallback = ''): string {
  return v == null || v === '' ? fallback : String(v)
}
