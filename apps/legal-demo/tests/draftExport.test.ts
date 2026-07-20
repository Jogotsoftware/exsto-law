// renderMarkdown is the markdown renderer for chat messages (assistant turns).
// This test suite ensures numbered lists separated by blank lines render with
// correct start= attributes so each list segment displays its own numbers.

import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/lib/draftExport'

describe('renderMarkdown — ordered list renumbering', () => {
  it('renders two single-item numbered blocks separated by a blank line with the second list carrying start="2"', () => {
    const md = '1. question\n\n2. question'
    const html = renderMarkdown(md)
    // First list should open as plain <ol> (starts at 1)
    expect(html).toContain('<ol>')
    // Second list should open with start="2" (does not open plain <ol> twice)
    expect(html).toContain('<ol start="2">')
    // Both items should be present
    expect(html).toContain('<li>')
  })

  it('renders three single-item numbered blocks with the third carrying start="3"', () => {
    const md = '1. first\n\n2. second\n\n3. third'
    const html = renderMarkdown(md)
    expect(html).toContain('<ol>')
    expect(html).toContain('<ol start="2">')
    expect(html).toContain('<ol start="3">')
  })

  it('renders a contiguous numbered list with no start attribute', () => {
    const md = '1. first\n2. second\n3. third'
    const html = renderMarkdown(md)
    // Should have exactly one <ol> (no blank lines, so list never closes)
    const olCount = (html.match(/<ol[^>]*>/g) || []).length
    expect(olCount).toBe(1)
    // Should not have any start attribute
    expect(html).not.toContain('start=')
    // Should have three items
    const liCount = (html.match(/<li>/g) || []).length
    expect(liCount).toBe(3)
  })

  it('renders a list starting at 1 with no start attribute', () => {
    const md = '1. only item'
    const html = renderMarkdown(md)
    expect(html).toContain('<ol>')
    expect(html).not.toContain('start=')
  })

  it('handles mixed content around numbered lists', () => {
    const md = 'Some text\n\n1. first\n\n2. second\n\nMore text'
    const html = renderMarkdown(md)
    expect(html).toContain('<p>Some text</p>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<ol start="2">')
    expect(html).toContain('<p>More text</p>')
  })

  it('does not affect unordered lists', () => {
    const md = '- item one\n\n- item two'
    const html = renderMarkdown(md)
    // Unordered lists should not have start attributes
    expect(html).not.toContain('start=')
    // Should have two separate ul elements (blank line closes list)
    const ulCount = (html.match(/<ul>/g) || []).length
    expect(ulCount).toBe(2)
  })
})

describe('renderMarkdown — basic functionality preserved', () => {
  it('renders headings', () => {
    const html = renderMarkdown('# Title\n## Subtitle')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Subtitle</h2>')
  })

  it('renders inline formatting', () => {
    const html = renderMarkdown('**bold** and *italic* and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders paragraphs', () => {
    const html = renderMarkdown('First paragraph\n\nSecond paragraph')
    expect(html).toContain('<p>First paragraph</p>')
    expect(html).toContain('<p>Second paragraph</p>')
  })
})

// PO-1 (Brief modal UX polish, product-walk 2026-07-20) — GFM pipe tables were
// previously unhandled by this renderer: `| Item | Status |` rendered as
// literal text inside the Brief modal's checklist sections. This pins the
// fix — a real <table> — plus the `tdWrap` per-cell hook BriefModal uses to
// wrap known status vocabulary in color-coded chips (lib/briefChips.ts).
describe('renderMarkdown — GFM pipe tables', () => {
  it('renders a header + separator + rows as a real table, not literal pipe text', () => {
    const md = '| Item | Status |\n| --- | --- |\n| Engagement letter | Pending |'
    const html = renderMarkdown(md)
    expect(html).not.toContain('| Item | Status |')
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<th>Item</th>')
    expect(html).toContain('<th>Status</th>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<td>Engagement letter</td>')
    expect(html).toContain('<td>Pending</td>')
  })

  it('wraps the rendered table in a scrollable container', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const html = renderMarkdown(md)
    expect(html).toContain('<div class="li-md-table-wrap"><table>')
  })

  it('renders multiple consecutive data rows', () => {
    const md = ['| Item | Status |', '| --- | --- |', '| A | Complete |', '| B | Unknown |'].join(
      '\n',
    )
    const html = renderMarkdown(md)
    const rowCount = (html.match(/<tr>/g) || []).length
    // 1 header row + 2 data rows
    expect(rowCount).toBe(3)
  })

  it('applies inline formatting inside cells', () => {
    const md = '| Item | Note |\n| --- | --- |\n| **Deed** | see `exhibit A` |'
    const html = renderMarkdown(md)
    expect(html).toContain('<strong>Deed</strong>')
    expect(html).toContain('<code>exhibit A</code>')
  })

  it('honors GFM alignment markers', () => {
    const md = '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |'
    const html = renderMarkdown(md)
    expect(html).toContain('<th style="text-align:left">L</th>')
    expect(html).toContain('<th style="text-align:center">C</th>')
    expect(html).toContain('<th style="text-align:right">R</th>')
  })

  it('does not treat a bare --- line (no pipes) as a table — stays <hr/>', () => {
    const html = renderMarkdown('above\n\n---\n\nbelow')
    expect(html).toContain('<hr/>')
    expect(html).not.toContain('<table>')
  })

  it('table ends at the first blank or non-pipe line', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.'
    const html = renderMarkdown(md)
    expect(html).toContain('<p>After the table.</p>')
    const rowCount = (html.match(/<tr>/g) || []).length
    expect(rowCount).toBe(2) // header + one data row, paragraph is not swallowed
  })

  it('applies the tdWrap hook to data cells only, not headers', () => {
    const md = '| Item | Status |\n| --- | --- |\n| Deed | Pending |'
    const html = renderMarkdown(md, {
      tdWrap: (text, html) => (text === 'Pending' ? `<mark>${html}</mark>` : html),
    })
    expect(html).toContain('<td><mark>Pending</mark></td>')
    expect(html).toContain('<th>Status</th>')
  })
})
