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

  // Rich per-run typography (font / size / alignment / underline / signature line)
  // can't be expressed in markdown, so the bridge KEEPS the editor's allowlisted
  // inline HTML as raw HTML in the body. These pin that it survives the save.
  it('keeps per-run font-family and font-size spans', () => {
    const md = htmlToMarkdown(
      '<p>A <span style="font-family: Georgia, serif">styled</span> ' +
        '<span style="font-size: 14pt">clause</span>.</p>',
    )
    expect(md).toContain('font-family: Georgia, serif')
    expect(md).toContain('font-size: 14pt')
    expect(md).toContain('styled')
    expect(md).toContain('clause')
  })

  it('keeps paragraph / heading alignment', () => {
    const md = htmlToMarkdown(
      '<h1 style="text-align: center">Title</h1><p style="text-align: right">Right.</p>',
    )
    expect(md).toContain('text-align: center')
    expect(md).toContain('text-align: right')
  })

  it('keeps underline', () => {
    const md = htmlToMarkdown('<p>See <u>Exhibit A</u>.</p>')
    expect(md).toContain('<u>Exhibit A</u>')
  })

  // WP-E toolbar strikethrough (TipTap's Strike mark serializes to <s>). Vanilla
  // turndown has no built-in strike rule (only turndown-plugin-gfm does, which
  // is not a dependency here), so this pins the addRule + the marked
  // renderer.del override that keeps the round trip lossless instead of
  // silently dropping the struck text back to plain text.
  it('keeps strikethrough (<s>) as GFM ~~text~~ and back', () => {
    const md = htmlToMarkdown('<p>Void <s>this clause</s> entirely.</p>')
    expect(md).toContain('~~this clause~~')
    const html = markdownToHtml(md)
    expect(html).toContain('<s>this clause</s>')
  })

  it('strikethrough survives an idempotent round-trip', () => {
    const once = roundTrip('Keep this but ~~not this~~ part.')
    const twice = roundTrip(once)
    expect(twice.trim()).toBe(once.trim())
    expect(once).toContain('~~not this~~')
  })

  it('keeps the signature-line block', () => {
    const md = htmlToMarkdown(
      '<div class="sig-line"><span class="sig-line-label">Signature</span></div>',
    )
    expect(md).toContain('class="sig-line"')
    expect(md).toContain('Signature')
  })

  it('round-trips a styled span back into HTML for the editor', () => {
    const html = markdownToHtml(
      htmlToMarkdown('<p>X <span style="font-size: 16pt">big</span>.</p>'),
    )
    expect(html).toContain('font-size: 16pt')
    expect(html).toContain('big')
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

describe('template body round-trip — tables (DOC-TABLES-1)', () => {
  const TABLE_MD = [
    '| Member | Ownership |',
    '| --- | --- |',
    '| Alice Smith | 60% |',
    '| Bob Jones | 40% |',
  ].join('\n')

  it('parses a GFM pipe table to a real <table>', () => {
    const html = markdownToHtml(TABLE_MD)
    expect(html).toContain('<table>')
    expect(html).toContain('Member')
    expect(html).toContain('<td>Alice Smith</td>')
  })

  it('round-trips a pipe table losslessly (structure survives save)', () => {
    const md = roundTrip(TABLE_MD)
    expect(md).toContain('| Member | Ownership |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice Smith | 60% |')
    expect(md).toContain('| Bob Jones | 40% |')
    // …and the saved markdown still parses back to a table.
    expect(markdownToHtml(md)).toContain('<table>')
  })

  it('serializes TipTap cell paragraphs and escapes literal pipes in cells', () => {
    const md = htmlToMarkdown(
      '<table><tbody><tr><th><p>Fee</p></th></tr><tr><td><p>Flat | fixed</p></td></tr></tbody></table>',
    )
    expect(md).toContain('| Fee |')
    expect(md).toContain('| --- |')
    expect(md).toContain('Flat \\| fixed')
  })

  it('emits the separator after the first row even without a header row', () => {
    const md = htmlToMarkdown(
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>',
    )
    expect(md).toContain('| a | b |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| c | d |')
  })

  it('keeps inline marks and merge tokens inside cells', () => {
    const md = roundTrip('| Term | Amount |\n| --- | --- |\n| **Retainer** | {{fee_amount}} |')
    expect(md).toContain('**Retainer**')
    expect(md).toContain('{{fee_amount}}')
  })

  it('keeps empty cells so column counts survive', () => {
    const md = htmlToMarkdown(
      '<table><tbody><tr><td><p>a</p></td><td><p></p></td><td><p>c</p></td></tr></tbody></table>',
    )
    expect(md).toContain('| a |  | c |')
  })

  it('collapses multi-line cell content to <br> (round-trips via breaks mode)', () => {
    const md = htmlToMarkdown(
      '<table><tbody><tr><td><p>line one</p><p>line two</p></td></tr></tbody></table>',
    )
    expect(md).toContain('line one<br>line two')
  })
})
