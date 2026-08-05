// UIWALK-2 (PR-3) — generated legal documents stay brand-neutral, by design
// and by guard. The firm's brand color (firm_header_color → --li-brand vars)
// tints CHROME only: the attorney console, the portal header, the booking
// crest. Documents must never pick it up. Two layers of protection:
//
// 1. A behavior check: the document HTML sanitizer strips color/background
//    styles and <img> tags, so branding physically cannot enter a rendered
//    document body even if a template carries it.
// 2. A source-text guard (same pattern as noHardcodedFirmName.test.ts): the
//    document rendering surfaces never reference the brand color setting or
//    its CSS vars. Fails loudly the moment someone wires branding into a
//    document pipeline.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { renderDocumentHtml } from '../lib/documentHtml'

describe('document sanitizer blocks brand styling in document bodies', () => {
  it('strips color and background from inline styles', () => {
    const html = renderDocumentHtml(
      '<p style="color:#ff0000;background:#00ff00;font-size:14pt">Hello</p>',
    )
    expect(html).not.toMatch(/color\s*:/i)
    expect(html).not.toMatch(/background/i)
    // The allowlisted property survives — the sanitizer is selective, not blunt.
    expect(html).toMatch(/font-size/i)
  })

  it('strips <img> (no logo can be embedded in a document body)', () => {
    const html = renderDocumentHtml(
      '<p>before</p><img src="data:image/png;base64,AAAA" /><p>after</p>',
    )
    expect(html).not.toMatch(/<img/i)
    expect(html).toContain('before')
    expect(html).toContain('after')
  })
})

// The files that render legal-document bodies (screen + PDF). None may read
// the brand color setting or its vars.
const DOCUMENT_SURFACES = [
  '../components/DocumentSheet.tsx',
  '../lib/documentHtml.ts',
  '../lib/draftExport.ts',
  '../../../verticals/legal/src/render/draftPdf.ts',
  '../../../verticals/legal/src/esign/stampPdf.ts',
  '../../../verticals/legal/src/api/templateMerge.ts',
]

describe('document surfaces never reference the firm brand color', () => {
  for (const rel of DOCUMENT_SURFACES) {
    it(`${rel} has no brand-color reference`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(src).not.toMatch(/headerColor|firm_header_color|--li-brand/)
    })
  }
})
