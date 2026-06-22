// renderDocumentHtml is the security boundary for every produced/signed document
// (share page, attorney review, e-sign prepare/sign, PDF/Word export). These
// tests pin the allowlist: the editor's typographic styling (font / size /
// alignment / signature line) survives, and everything dangerous is stripped.
// See verticals/legal/docs/RICH_TEMPLATE_FORMATTING.md.

import { describe, it, expect } from 'vitest'
import { renderDocumentHtml } from '@/lib/documentHtml'

describe('renderDocumentHtml — markdown rendering', () => {
  it('renders basic markdown structure', () => {
    const html = renderDocumentHtml('# Title\n\nHello **world**.')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>world</strong>')
  })

  it('passes merge tokens and the e-sign anchor through verbatim', () => {
    // The e-sign anchor {{type:key}} MUST survive the render byte-for-byte — the
    // signing field matcher finds it in the produced document. Plain tokens (shown
    // pre-merge in previews) survive too. ({{>include}} is resolved server-side
    // before display; its `>` would be HTML-encoded to &gt;, which is correct.)
    const html = renderDocumentHtml('Dear {{client_name}}, please sign {{sign:client}} below.')
    expect(html).toContain('{{client_name}}')
    expect(html).toContain('{{sign:client}}')
  })
})

describe('renderDocumentHtml — allowlisted styling survives', () => {
  it('keeps per-run font-family and font-size on a span', () => {
    const html = renderDocumentHtml(
      'A <span style="font-family:\'Times New Roman\', serif; font-size:14pt">clause</span> here.',
    )
    expect(html).toContain('font-family')
    expect(html).toContain("Times New Roman")
    expect(html).toContain('font-size:14pt')
    expect(html).toContain('clause')
  })

  it('keeps paragraph text-align', () => {
    const html = renderDocumentHtml('<p style="text-align:center">Centered title</p>')
    expect(html).toContain('text-align:center')
  })

  it('keeps a signature-line block', () => {
    const html = renderDocumentHtml('<div class="sig-line"><span class="sig-line-label">Signature</span></div>')
    expect(html).toContain('class="sig-line"')
    expect(html).toContain('Signature')
  })

  it('keeps underline / strike text-decoration', () => {
    const html = renderDocumentHtml('<span style="text-decoration:underline">x</span>')
    expect(html).toContain('text-decoration:underline')
  })
})

describe('renderDocumentHtml — dangerous content is stripped', () => {
  it('strips <script> entirely (tag and contents)', () => {
    const html = renderDocumentHtml('Hi<script>alert(1)</script> there')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).toContain('Hi')
    expect(html).toContain('there')
  })

  it('strips event-handler attributes', () => {
    const html = renderDocumentHtml('<span onmouseover="steal()" style="font-size:12pt">x</span>')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('steal()')
    expect(html).toContain('font-size:12pt')
  })

  it('drops javascript: hrefs but keeps safe links', () => {
    const evil = renderDocumentHtml('[click](javascript:alert(1))')
    expect(evil).not.toContain('javascript:')
    const safe = renderDocumentHtml('[site](https://example.com)')
    expect(safe).toContain('href="https://example.com"')
  })

  it('strips <iframe>, <img>, <style> and inline <style> tags', () => {
    const html = renderDocumentHtml(
      '<iframe src="evil"></iframe><img src=x onerror=alert(1)><style>*{}</style>text',
    )
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('onerror')
    expect(html).toContain('text')
  })

  it('rejects url()/expression() injection in font-family', () => {
    const html = renderDocumentHtml(
      '<span style="font-family:url(javascript:alert(1))">x</span>',
    )
    expect(html).not.toContain('url(')
    expect(html).not.toContain('javascript')
  })

  it('drops non-allowlisted style properties (e.g. position)', () => {
    const html = renderDocumentHtml('<span style="position:fixed; font-size:12pt">x</span>')
    expect(html).not.toContain('position')
    expect(html).toContain('font-size:12pt')
  })
})
