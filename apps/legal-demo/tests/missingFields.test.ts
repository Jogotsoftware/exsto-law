// EDITOR-FIX-1 (item 4) — [[MISSING: field]] merge-gap markers render as
// humanized warn chips in the reader (and, via the same helpers, the editor).
// These pin the humanization and the reader HTML transform: the marker text is
// the source of truth, only presentation changes.
import { describe, it, expect } from 'vitest'
import {
  humanizeMissingField,
  missingChipLabel,
  renderMissingChipsHtml,
  missingFieldRegex,
} from '@/lib/missingFields'

describe('missing-field helpers', () => {
  it('humanizes snake_case and dotted field ids', () => {
    expect(humanizeMissingField('dissolution_terms')).toBe('Dissolution terms')
    expect(humanizeMissingField('member.0.name')).toBe('Member 0 name')
    expect(humanizeMissingField('company_name')).toBe('Company name')
  })

  it('builds the chip caption', () => {
    expect(missingChipLabel('dissolution_terms')).toBe('Dissolution terms — not provided at intake')
  })

  it('wraps a literal marker in a warn chip and drops the raw brackets', () => {
    const html = renderMissingChipsHtml('<p>The [[MISSING: dissolution_terms]] apply.</p>')
    expect(html).toContain('class="li-missing-chip"')
    expect(html).toContain('Dissolution terms — not provided at intake')
    expect(html).not.toContain('[[MISSING:')
  })

  it('replaces EVERY marker in the body (fresh regex, no lastIndex desync)', () => {
    const html = renderMissingChipsHtml('[[MISSING: a_one]] and [[MISSING: b_two]]')
    expect(html.match(/li-missing-chip/g)).toHaveLength(2)
    // A fresh regex each call — no shared lastIndex leaking across invocations.
    expect(renderMissingChipsHtml('[[MISSING: c_three]]')).toContain('C three')
  })

  it('leaves ordinary text untouched', () => {
    expect(renderMissingChipsHtml('<p>No gaps here.</p>')).toBe('<p>No gaps here.</p>')
    expect(missingFieldRegex().test('plain text')).toBe(false)
  })
})
