// The rich template editor stores its content as markdown with {{tokens}}.
// markdownToHtml / htmlToMarkdown bridge that stored format and TipTap's HTML.
// These tests pin the round-trip contract the editor rests on: formatting
// survives, and merge syntax (plain tokens, {{>includes}}, {{type:key}} e-sign
// tags, literal underscores) is preserved verbatim — never escaped or mangled.

import { describe, it, expect } from 'vitest'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'

const roundTrip = (md: string) => htmlToMarkdown(markdownToHtml(md))

describe('template body round-trip', () => {
  it('promotes bare {{tokens}} to editable chip spans', () => {
    const html = markdownToHtml('Dear {{client_name}}, welcome.')
    expect(html).toContain('<span data-variable="client_name">{{client_name}}</span>')
  })

  it('does NOT chipify {{>includes}} or {{type:key}} e-sign tags', () => {
    const html = markdownToHtml('Body {{>nda_clause}} sign {{sign:client}}.')
    expect(html).not.toContain('data-variable="nda')
    expect(html).not.toContain('data-variable="sign')
  })

  it('collapses chip spans back to {{token}}', () => {
    const md = htmlToMarkdown(
      '<p>Dear <span data-variable="client_name">{{client_name}}</span>.</p>',
    )
    expect(md).toContain('{{client_name}}')
  })

  it('preserves merge syntax verbatim (no backslash escaping)', () => {
    const md = roundTrip(
      'Matter {{matter_number}}.\n\n{{>nda_clause}}\n\nSign: {{sign:co_signer}} fee {{fee_amount}}.',
    )
    expect(md).toContain('{{matter_number}}')
    expect(md).toContain('{{fee_amount}}')
    expect(md).toContain('{{>nda_clause}}') // include key NOT broken to {{>nda\_clause}}
    expect(md).toContain('{{sign:co_signer}}') // e-sign key underscore intact
  })

  it('keeps literal underscores/asterisks in prose unescaped', () => {
    const md = roundTrip('File form_1099 and section 5 * 2.')
    expect(md).toContain('form_1099')
    expect(md).not.toContain('form\\_1099')
  })

  it('preserves structural formatting (headings, bold, lists)', () => {
    const md = roundTrip('# Title\n\nWe **represent** you on:\n\n- Item one\n- Item two\n')
    expect(md).toMatch(/^#\s*Title/m)
    expect(md).toMatch(/\*\*represent\*\*/)
    expect(md).toMatch(/[-*]\s+Item one/)
  })

  it('is idempotent — a second round-trip does not drift', () => {
    const once = roundTrip('# Doc\n\nDear {{client_name}},\n\n- {{matter_number}}\n- form_1099\n')
    const twice = roundTrip(once)
    expect(twice.trim()).toBe(once.trim())
  })

  it('handles empty bodies without throwing', () => {
    expect(roundTrip('')).toBe('')
    expect(markdownToHtml('')).toBe('')
  })

  // The DOCX/HTML import route runs mammoth.convertToHtml then htmlToMarkdown, so
  // an imported Word document keeps its structure instead of flattening to text.
  it('converts mammoth-style structured HTML to markdown (import path)', () => {
    const docxHtml =
      '<h1>Operating Agreement</h1>' +
      '<p>This agreement is <strong>made</strong> by <em>the parties</em> for form_1099.</p>' +
      '<ul><li>Member A</li><li>Member B</li></ul>'
    const md = htmlToMarkdown(docxHtml)
    expect(md).toMatch(/^#\s*Operating Agreement/m)
    expect(md).toMatch(/\*\*made\*\*/)
    expect(md).toMatch(/_the parties_|\*the parties\*/)
    expect(md).toMatch(/[-*]\s+Member A/)
    expect(md).toContain('form_1099') // no spurious escaping
  })
})
