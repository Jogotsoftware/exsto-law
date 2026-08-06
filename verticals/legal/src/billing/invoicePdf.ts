import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
// createElement bound to react-pdf's own React — MUST match the reconciler's
// React or every server-side render fails with React error #31. See the module.
import { h } from '../render/reactPdfElement.js'
import type { InvoiceDetail } from '../queries/billing.js'

// Real, branded invoice PDF (Phase 3) via @react-pdf/renderer — free/MIT, pure-JS,
// no headless browser. The LAYOUT is a fixed professional invoice; the firm
// customizes the BRANDING + content through InvoiceTemplateConfig (saved on
// firm_settings). One renderer feeds the on-screen view, the download, the email
// attachment, and the Settings preview, so they never drift. JSX is intentionally
// avoided (the vertical builds with plain tsc, no jsx) — createElement throughout.

export interface InvoiceTemplateColumns {
  matter: boolean
  quantity: boolean
  rate: boolean
}

export interface InvoiceTemplateConfig {
  firmName: string
  firmAddress: string
  firmPhone: string
  // A small logo as a data URL (data:image/png;base64,…) or null for none.
  logoDataUrl: string | null
  // FIRM-BRANDING-1 — 'light' when the logo is reversed artwork (white/light
  // ink drawn for a dark website header). Roughly half of firm logos are, and
  // one of those printed straight onto a white invoice is INVISIBLE. When the
  // tone says light, the logo prints inside a filled letterhead block in the
  // firm's accent color instead. 'dark'/null print bare on the page.
  logoTone: 'light' | 'dark' | null
  accentColor: string
  columns: InvoiceTemplateColumns
  headerNote: string
  paymentInstructions: string
}

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplateConfig = {
  // FIRM-BRANDING-1 — no firm-name default. This used to read 'Pacheco Law',
  // which would print the demo firm's name on a SECOND firm's invoices the
  // moment their profile had a gap (the FIRM_DEFAULTS hazard, #282-285). The
  // name now comes from Settings → Firm Details; unknown renders as nothing.
  firmName: '',
  firmAddress: '',
  firmPhone: '',
  logoDataUrl: null,
  logoTone: null,
  // The product navy, used only when the firm has set no brand color.
  accentColor: '#1a3a6b',
  columns: { matter: true, quantity: true, rate: true },
  headerNote: '',
  paymentInstructions: 'Payment due within 30 days. Thank you for your business.',
}

// Merge a stored (possibly partial) config over the defaults so a render never
// hits an undefined field, whatever shape was saved.
export function resolveInvoiceTemplate(
  cfg: Partial<InvoiceTemplateConfig> | null | undefined,
): InvoiceTemplateConfig {
  const d = DEFAULT_INVOICE_TEMPLATE
  return {
    firmName: cfg?.firmName?.trim() || d.firmName,
    firmAddress: cfg?.firmAddress ?? d.firmAddress,
    firmPhone: cfg?.firmPhone ?? d.firmPhone,
    logoDataUrl: cfg?.logoDataUrl ?? d.logoDataUrl,
    logoTone: cfg?.logoTone === 'light' || cfg?.logoTone === 'dark' ? cfg.logoTone : d.logoTone,
    accentColor: cfg?.accentColor?.trim() || d.accentColor,
    columns: { ...d.columns, ...(cfg?.columns ?? {}) },
    headerNote: cfg?.headerNote ?? d.headerNote,
    paymentInstructions: cfg?.paymentInstructions ?? d.paymentInstructions,
  }
}

function money(amount: string | null, currency: string): string {
  if (amount === null || amount === undefined) return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return String(amount)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
  } catch {
    return `${currency} ${amount}`
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US')
}

function kindLabel(kind: string): string {
  if (kind === 'time') return 'Time'
  if (kind === 'expense') return 'Expense'
  if (kind === 'service_fee') return 'Service fee'
  if (kind === 'document_fee') return 'Document fee'
  return kind.replace(/_/g, ' ')
}

// FIRM-BRANDING-1 — the fill behind reversed (light-ink) artwork on the invoice.
// A firm's brand color can itself be pale, and white artwork on pale blue is as
// unreadable on paper as on screen — so a light color is darkened until it can
// carry light ink; an already-dark brand color is used as-is. Mirrors
// apps/legal-demo/lib/brandColor.plateHex so screen and paper agree.
function luminance(hex: string): number {
  const ch = (i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255
  return 0.299 * ch(1) + 0.587 * ch(3) + 0.114 * ch(5)
}

function darken(hex: string, amount: number): string {
  const ch = (i: number): string =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`
}

export function logoPlateColor(accent: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return '#14213d'
  let out = accent
  for (let i = 0; i < 6 && luminance(out) > 0.32; i++) out = darken(out, 0.25)
  return out
}

function buildStyles(rawAccent: string) {
  // FIRM-BRANDING-1 — every accent use below either carries WHITE text (the
  // table header) or IS text on white paper (the INVOICE title, the totals).
  // A pale brand color made both unreadable — the pilot firm's legacy invoice
  // accent (#8ac6f4) printed a white-on-baby-blue table header. Darkening a
  // light accent to a legible ink keeps the firm's hue and makes the document
  // readable; an already-dark brand color passes through untouched.
  const accent = logoPlateColor(rawAccent)
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, color: '#1f2937', fontFamily: 'Helvetica' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    firmBlock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // FIRM-BRANDING-1 — a 48x48 square squashed every real firm logo (they are
    // wide wordmarks, not app icons: Pacheco's is 1616x432, i.e. ~12 pt tall in
    // a 48 pt box — an illegible smudge). A wide box with objectFit:'contain'
    // letterboxes tall marks and lets wordmarks read at their natural ratio.
    logo: { width: 150, height: 46, objectFit: 'contain' },
    // Letterhead block for reversed (light-ink) artwork — see logoTone.
    logoPlate: {
      backgroundColor: accent,
      borderRadius: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
    },
    firmName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: accent },
    firmMeta: { fontSize: 9, color: '#6b7280', marginTop: 2 },
    invoiceTitle: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: accent, textAlign: 'right' },
    invoiceMeta: { fontSize: 9, color: '#374151', textAlign: 'right', marginTop: 4 },
    rule: { borderBottomWidth: 1, borderBottomColor: accent, marginTop: 14, marginBottom: 14 },
    billTo: { marginBottom: 12 },
    label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 },
    strong: { fontFamily: 'Helvetica-Bold' },
    note: { marginTop: 6, fontSize: 9, color: '#374151' },
    table: { marginTop: 8 },
    th: {
      flexDirection: 'row',
      backgroundColor: accent,
      color: '#ffffff',
      paddingVertical: 5,
      paddingHorizontal: 6,
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
    },
    tr: {
      flexDirection: 'row',
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderBottomWidth: 0.5,
      borderBottomColor: '#e5e7eb',
    },
    cDesc: { flex: 1 },
    cMatter: { width: 90 },
    cQty: { width: 50, textAlign: 'right' },
    cRate: { width: 70, textAlign: 'right' },
    cAmount: { width: 80, textAlign: 'right' },
    totals: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' },
    totalsBox: { width: 220 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    totalDue: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: accent,
      fontFamily: 'Helvetica-Bold',
      fontSize: 12,
      color: accent,
    },
    footer: {
      position: 'absolute',
      bottom: 30,
      left: 40,
      right: 40,
      fontSize: 8,
      color: '#6b7280',
      borderTopWidth: 0.5,
      borderTopColor: '#e5e7eb',
      paddingTop: 8,
    },
  })
}

// Render the invoice to PDF bytes. `cfg` is the firm's (possibly partial) template;
// it is resolved over defaults so any saved shape renders.
export async function renderInvoicePdf(
  invoice: InvoiceDetail,
  cfg?: Partial<InvoiceTemplateConfig> | null,
): Promise<Buffer> {
  const t = resolveInvoiceTemplate(cfg)
  const s = buildStyles(t.accentColor)
  const cur = invoice.currency || 'USD'
  const cols = t.columns

  const headerCells = [
    h(Text, { key: 'd', style: s.cDesc }, 'Description'),
    cols.matter ? h(Text, { key: 'm', style: s.cMatter }, 'Matter') : null,
    cols.quantity ? h(Text, { key: 'q', style: s.cQty }, 'Qty') : null,
    cols.rate ? h(Text, { key: 'r', style: s.cRate }, 'Rate') : null,
    h(Text, { key: 'a', style: s.cAmount }, 'Amount'),
  ].filter(Boolean)

  const rows = invoice.lines.map((l, i) =>
    h(
      View,
      { key: l.lineEntityId || `line-${i}`, style: s.tr },
      [
        h(Text, { key: 'd', style: s.cDesc }, `${l.description || kindLabel(l.kind)}`),
        cols.matter ? h(Text, { key: 'm', style: s.cMatter }, l.matterNumber || '—') : null,
        cols.quantity ? h(Text, { key: 'q', style: s.cQty }, l.quantity ?? '') : null,
        cols.rate ? h(Text, { key: 'r', style: s.cRate }, money(l.rate, cur)) : null,
        h(Text, { key: 'a', style: s.cAmount }, money(l.amount, cur)),
      ].filter(Boolean),
    ),
  )

  const doc = h(
    Document,
    null,
    h(
      Page,
      { size: 'LETTER', style: s.page },
      // Header: firm (+ logo) on the left, INVOICE block on the right.
      h(View, { style: s.header }, [
        h(
          View,
          { key: 'firm', style: s.firmBlock },
          [
            t.logoDataUrl
              ? t.logoTone === 'light'
                ? h(
                    View,
                    { key: 'logo', style: s.logoPlate },
                    h(Image, { style: s.logo, src: t.logoDataUrl }),
                  )
                : h(Image, { key: 'logo', style: s.logo, src: t.logoDataUrl })
              : null,
            h(
              View,
              { key: 'fb' },
              [
                // FIRM-BRANDING-1 — the logo IS the wordmark when one is set
                // (the same rule the console top bar follows), so the name line
                // stands down rather than printing the firm's name twice. With
                // no logo and no name set, nothing prints — never a placeholder.
                !t.logoDataUrl && t.firmName
                  ? h(Text, { key: 'n', style: s.firmName }, t.firmName)
                  : null,
                t.firmAddress ? h(Text, { key: 'a', style: s.firmMeta }, t.firmAddress) : null,
                t.firmPhone ? h(Text, { key: 'p', style: s.firmMeta }, t.firmPhone) : null,
              ].filter(Boolean),
            ),
          ].filter(Boolean),
        ),
        h(
          View,
          { key: 'inv' },
          [
            h(Text, { key: 't', style: s.invoiceTitle }, 'INVOICE'),
            h(Text, { key: 'num', style: s.invoiceMeta }, invoice.invoiceNumber),
            h(Text, { key: 'iss', style: s.invoiceMeta }, `Issued ${fmtDate(invoice.issuedDate)}`),
            invoice.dueDate
              ? h(Text, { key: 'due', style: s.invoiceMeta }, `Due ${fmtDate(invoice.dueDate)}`)
              : null,
            h(Text, { key: 'st', style: s.invoiceMeta }, `Status: ${invoice.status}`),
          ].filter(Boolean),
        ),
      ]),

      h(View, { style: s.rule }),

      // Bill-to + optional header note.
      h(
        View,
        { style: s.billTo },
        [
          h(Text, { key: 'l', style: s.label }, 'Bill to'),
          h(Text, { key: 'c', style: s.strong }, invoice.clientName || '—'),
          t.headerNote ? h(Text, { key: 'note', style: s.note }, t.headerNote) : null,
        ].filter(Boolean),
      ),

      // Line items.
      h(View, { style: s.table }, [h(View, { key: 'th', style: s.th }, headerCells), ...rows]),

      // Totals.
      h(
        View,
        { style: s.totals },
        h(View, { style: s.totalsBox }, [
          h(View, { key: 'sub', style: s.totalRow }, [
            h(Text, { key: 'l' }, 'Subtotal'),
            h(Text, { key: 'v' }, money(invoice.total, cur)),
          ]),
          h(View, { key: 'due', style: s.totalDue }, [
            h(Text, { key: 'l' }, 'Total due'),
            h(Text, { key: 'v' }, money(invoice.total, cur)),
          ]),
        ]),
      ),

      invoice.notes ? h(Text, { style: s.note }, invoice.notes) : null,

      // Footer / payment instructions.
      h(Text, { style: s.footer }, t.paymentInstructions),
    ),
  )

  return renderToBuffer(doc)
}
