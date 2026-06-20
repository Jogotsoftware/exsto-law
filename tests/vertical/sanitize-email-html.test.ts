// Beta feedback: "bolding and formatting is not working in the actual
// sent/received emails." The fix renders the email's HTML part in the Mail tab,
// which makes inbound (untrusted) email HTML an XSS surface. sanitizeEmailHtml is
// the single server-side allowlist chokepoint; these tests pin both halves of the
// contract: dangerous markup is stripped, legitimate formatting survives.
import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from '@exsto/legal'

describe('sanitizeEmailHtml', () => {
  it('strips <script> and its contents', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).toContain('<p>hi</p>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
  })

  it('removes inline event handlers', () => {
    const out = sanitizeEmailHtml('<img src="https://x/y.png" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert')
  })

  it('drops javascript: URLs on links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('strips <style> blocks and their contents', () => {
    const out = sanitizeEmailHtml('<style>body{display:none}</style><p>ok</p>')
    expect(out).not.toContain('style')
    expect(out).not.toContain('display:none')
    expect(out).toContain('<p>ok</p>')
  })

  it('strips <iframe>', () => {
    const out = sanitizeEmailHtml('<iframe src="https://evil"></iframe><p>ok</p>')
    expect(out).not.toContain('iframe')
    expect(out).toContain('<p>ok</p>')
  })

  it('preserves bold, italic, and lists', () => {
    const out = sanitizeEmailHtml(
      '<p><strong>bold</strong> and <em>italic</em></p><ul><li>one</li><li>two</li></ul>',
    )
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
  })

  it('keeps http(s) links and forces safe target/rel', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">site</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('keeps mailto links', () => {
    const out = sanitizeEmailHtml('<a href="mailto:a@b.com">mail</a>')
    expect(out).toContain('href="mailto:a@b.com"')
  })

  it('allows a constrained inline style but drops behavioural CSS', () => {
    const out = sanitizeEmailHtml('<p style="color:#ff0000;position:fixed;font-weight:bold">x</p>')
    expect(out).toContain('color:#ff0000')
    expect(out).toContain('font-weight:bold')
    expect(out).not.toContain('position')
  })

  it('returns empty string for empty / whitespace input', () => {
    expect(sanitizeEmailHtml('')).toBe('')
    expect(sanitizeEmailHtml('   ')).toBe('')
    expect(sanitizeEmailHtml(null)).toBe('')
    expect(sanitizeEmailHtml(undefined)).toBe('')
  })
})
