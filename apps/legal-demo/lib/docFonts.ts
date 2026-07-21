// EDITOR-FIX-1 (item 7) — the document base-font vocabulary for the tracked-
// changes editor toolbar (founder decision 2026-07-19 #1: font family + size are
// a REAL per-document setting, persisted on the version, reloaded with the
// document, and flowed into the PDF export). A small, closed set of logical
// families, each with a web CSS stack (editor + reader). The persisted value is
// the NAME; the vertical's draftPdf.ts maps the SAME name to a react-pdf built-in
// (Helvetica / Times-Roman / Courier), so a rename is a two-file change — keep
// this list and PDF_FONT_MAP (draftPdf.ts) in sync. Sizes are points.
export interface DocFontOption {
  name: string
  css: string
}

export const DOC_FONT_OPTIONS: DocFontOption[] = [
  { name: 'Public Sans', css: "'Public Sans', system-ui, -apple-system, sans-serif" },
  { name: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { name: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { name: 'Courier', css: "'Courier New', Courier, monospace" },
]

export const DOC_FONT_SIZES = [10, 11, 12, 14, 16]

export const DEFAULT_DOC_FONT_FAMILY = 'Public Sans'
export const DEFAULT_DOC_FONT_SIZE = 12

// The CSS stack for a family name — the first option (Public Sans) is the fallback.
export function docFontCss(name: string | null | undefined): string {
  return DOC_FONT_OPTIONS.find((f) => f.name === name)?.css ?? DOC_FONT_OPTIONS[0]!.css
}

// Coerce a stored/loaded family to a known one (defaults when null/unknown), so a
// stray metadata value never breaks the select or the render.
export function normalizeDocFontFamily(name: string | null | undefined): string {
  return DOC_FONT_OPTIONS.find((f) => f.name === name)?.name ?? DEFAULT_DOC_FONT_FAMILY
}

export function normalizeDocFontSize(size: number | null | undefined): number {
  return typeof size === 'number' && DOC_FONT_SIZES.includes(size) ? size : DEFAULT_DOC_FONT_SIZE
}
