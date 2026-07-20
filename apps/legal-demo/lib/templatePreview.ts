// Live-preview merge for the template editor. Takes the editor's markdown body
// (with {{tokens}}) and renders the *finished* document the way the client will
// actually see it — reusing renderDocumentHtml, the same sanitizing renderer the
// review and shared-link pages use, so the preview is faithful (and shows the
// editor's per-run font / size / alignment styling).
//
// Token handling:
//   {{plain_token}}   → a curated/heuristic SAMPLE value (so boilerplate reads
//                       naturally) or, if we can't sample it, a highlighted
//                       "filled from intake" placeholder.
//   {{>clause_key}}   → a highlighted "included clause" placeholder (the real
//                       include is resolved server-side at draft time).
//   {{type:signer}}   → a highlighted e-signature placeholder.
//
// Previews against SAMPLE data. buildPreview takes an optional values map so a
// real matter's answers can drive it later.

import type { TemplateVariables, TemplateVariableSpec } from '@exsto/legal'
import { renderDocumentHtml } from './documentHtml'

// Any {{ ... }} run. We classify the inner text ourselves so includes/e-sign
// tags/plain tokens are handled in one pass.
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g
const PLAIN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// Private-use sentinels — absent from real content and untouched by the document
// renderer (marked + sanitize pass these Unicode chars through as plain text).
// They mark placeholders through the render, then we swap them for styled spans
// (added AFTER sanitize, so the trusted preview chrome is never stripped). None
// survive to output.
const S0 = String.fromCharCode(0xe000)
const S1 = String.fromCharCode(0xe001)
const MARKER_RE = new RegExp(`${S0}([A-Z]+)${S0}([\\s\\S]+?)${S1}`, 'g')

function humanize(token: string): string {
  const s = token.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : token
}

function todayLong(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Curated samples for the standard merge fields the palette offers.
const CURATED: Record<string, string> = {
  client_name: 'Jordan Avery',
  client_email: 'jordan.avery@example.com',
  client_address: '1200 Peachtree St NE, Atlanta, GA 30309',
  matter_number: 'M-2026-0142',
  firm_name: 'Smith & Associates PLLC',
  attorney_name: 'Alex Smith',
}

// A readable sample for a token, or null if we have nothing sensible. We only
// sample what we're confident about — the curated standard fields plus clearly
// typed _date / email tokens. Everything else renders as a highlighted, humanized
// field label inline (e.g. "Member name"), which reads naturally in context and
// honestly flags a data-driven field WITHOUT inventing a confidently-wrong value.
function sampleFor(token: string): string | null {
  const t = token.toLowerCase()
  if (t in CURATED) return CURATED[t]!
  if (t === 'today' || t === 'effective_date' || /(^|_)date(_|$)/.test(t)) return todayLong()
  if (/(^|_)email(_|$)/.test(t)) return 'jordan.avery@example.com'
  return null
}

// A sample derived from a declared variable type. A default wins (with 'today'
// resolved to the date); otherwise a representative value per type. Free-text
// types return null so they fall through to the name heuristic / a flagged gap.
function typedSample(spec: TemplateVariableSpec): string | null {
  const def = spec.default?.trim()
  if (def) return def.toLowerCase() === 'today' ? todayLong() : def
  switch (spec.type) {
    case 'date':
      return todayLong()
    case 'number':
      return '42'
    case 'currency':
      return '$2,500'
    case 'boolean':
      return 'Yes'
    case 'choice':
      return spec.options && spec.options.length > 0 ? spec.options[0]! : null
    default:
      return null // text / textarea → name heuristic or flagged gap
  }
}

export interface PreviewResult {
  html: string
  // # of {{tokens}} shown as gaps (no sample / no provided value) — i.e. fields
  // that will be filled from the client's intake answers.
  gapCount: number
  // # of {{tokens}} filled (sample or provided value).
  filledCount: number
}

// Build the preview HTML for a template body.
//   values    — overrides the sample source per token (e.g. a real matter's
//               answers). Wins over everything.
//   variables — declared typed metadata per token; drives a type-appropriate
//               sample (currency, date, choice…) when no explicit value is given.
export function buildPreview(
  body: string,
  values?: Record<string, string>,
  variables?: TemplateVariables,
): PreviewResult {
  let gapCount = 0
  let filledCount = 0

  const merged = (body ?? '').replace(TOKEN_RE, (whole, innerRaw: string) => {
    const inner = innerRaw.trim()

    // {{>clause_key}} — composition include.
    if (inner.startsWith('>')) {
      return `${S0}CLAUSE${S0}${humanize(inner.slice(1).trim())}${S1}`
    }
    // {{type:signer}} — e-sign field tag.
    const colon = inner.indexOf(':')
    if (colon > -1) {
      return `${S0}SIGN${S0}${humanize(inner.slice(colon + 1).trim())}${S1}`
    }
    // {{plain_token}} — a field binding. Precedence: explicit value → declared
    // type → name-based heuristic → flagged gap.
    if (PLAIN_RE.test(inner)) {
      const lower = inner.toLowerCase()
      const provided = values?.[lower]
      const spec = variables?.[lower]
      const typed = spec ? typedSample(spec) : null
      const value = provided != null && provided !== '' ? provided : (typed ?? sampleFor(inner))
      if (value != null) {
        filledCount++
        return value
      }
      gapCount++
      return `${S0}FIELD${S0}${humanize(inner)}${S1}`
    }
    // Anything else (malformed) — leave the literal text untouched.
    return whole
  })

  let html = renderDocumentHtml(merged)
  html = html.replace(MARKER_RE, (_m, kind: string, label: string) => {
    switch (kind) {
      case 'FIELD':
        return `<span class="tpl-prev-field" title="Filled from the client's intake answers">${label}</span>`
      case 'CLAUSE':
        return `<span class="tpl-prev-clause" title="An included clause, merged at draft time">⧉ ${label}</span>`
      case 'SIGN':
        return `<span class="tpl-prev-sign" title="E-signature field">✶ ${label} signature</span>`
      default:
        return label
    }
  })

  return { html, gapCount, filledCount }
}
