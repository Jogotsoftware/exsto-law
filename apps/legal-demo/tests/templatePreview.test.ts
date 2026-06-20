// The live-preview pane merges the template body with sample (or provided) values
// and renders it via the real document renderer. These tests pin that behavior:
// confident fields fill, everything else is flagged inline, includes/e-sign tags
// become placeholders, no sentinels leak, and a provided values map wins.

import { describe, it, expect } from 'vitest'
import { buildPreview } from '@/lib/templatePreview'

const BODY = [
  '# Engagement Letter',
  '',
  'Dear {{client_name}},',
  '',
  'This confirms matter {{matter_number}} as of {{effective_date}}.',
  '',
  'Your company {{company_name}} will provide {{business_description}}.',
  '',
  '{{>fee_clause}}',
  '',
  'Signed: {{sign:client}}',
  '',
].join('\n')

describe('template preview', () => {
  it('renders structural markdown (headings)', () => {
    expect(buildPreview(BODY).html).toContain('<h1>Engagement Letter</h1>')
  })

  it('fills curated standard fields with sample values', () => {
    const html = buildPreview(BODY).html
    expect(html).toContain('Jordan Avery') // client_name
    expect(html).toContain('M-2026-0142') // matter_number
  })

  it('fills clearly-typed _date tokens with a date', () => {
    expect(buildPreview('As of {{effective_date}}.').html).toMatch(
      /January|February|March|April|May|June|July|August|September|October|November|December/,
    )
  })

  it('flags unknown fields inline as highlighted humanized labels (no fake values)', () => {
    const html = buildPreview(BODY).html
    expect(html).toContain('tpl-prev-field')
    expect(html).toContain('Company name')
    expect(html).toContain('Business description')
  })

  it('renders {{>includes}} as a clause placeholder (no doubled word)', () => {
    const html = buildPreview(BODY).html
    expect(html).toContain('tpl-prev-clause')
    expect(html).toContain('Fee clause')
    expect(html).not.toContain('clause clause')
  })

  it('renders {{type:signer}} as an e-signature placeholder', () => {
    const html = buildPreview(BODY).html
    expect(html).toContain('tpl-prev-sign')
    expect(html).toContain('Client signature')
  })

  it('leaks no private-use sentinels into output', () => {
    const html = buildPreview(BODY).html
    expect(html).not.toContain(String.fromCharCode(0xe000))
    expect(html).not.toContain(String.fromCharCode(0xe001))
  })

  it('counts filled vs gap fields (excludes includes/e-sign)', () => {
    const { filledCount, gapCount } = buildPreview(BODY)
    expect(filledCount).toBe(3) // client_name, matter_number, effective_date
    expect(gapCount).toBe(2) // company_name, business_description
  })

  it('lets a provided values map override the sample source', () => {
    const html = buildPreview('Hello {{client_name}}.', { client_name: 'Pat Real' }).html
    expect(html).toContain('Pat Real')
    expect(html).not.toContain('Jordan Avery')
  })

  describe('typed variables drive sample values', () => {
    it('fills by declared type (currency / number / boolean)', () => {
      const html = buildPreview(
        'Fee {{retainer}}, count {{seats}}, agree {{consents}}.',
        undefined,
        {
          retainer: { type: 'currency' },
          seats: { type: 'number' },
          consents: { type: 'boolean' },
        },
      ).html
      expect(html).toContain('$2,500')
      expect(html).toContain('42')
      expect(html).toContain('Yes')
      expect(html).not.toContain('tpl-prev-field') // all three resolved, no gaps
    })

    it('uses the first option for a choice type', () => {
      const html = buildPreview('Plan: {{plan_tier}}.', undefined, {
        plan_tier: { type: 'choice', options: ['Standard', 'Premium'] },
      }).html
      expect(html).toContain('Standard')
    })

    it('honors an explicit default (and resolves "today")', () => {
      const a = buildPreview('Term {{term}}.', undefined, {
        term: { type: 'text', default: '24 months' },
      }).html
      expect(a).toContain('24 months')
      const b = buildPreview('As of {{start}}.', undefined, {
        start: { type: 'date', default: 'today' },
      }).html
      expect(b).toMatch(/\b\d{4}\b/) // a year — the date resolved
    })

    it('a text-typed token still falls back to the curated sample', () => {
      const html = buildPreview('Dear {{client_name}}.', undefined, {
        client_name: { type: 'text' },
      }).html
      expect(html).toContain('Jordan Avery')
      expect(html).not.toContain('tpl-prev-field')
    })

    it('an explicit value still wins over a declared type', () => {
      const html = buildPreview(
        'Fee {{retainer}}.',
        { retainer: '$10,000' },
        {
          retainer: { type: 'currency' },
        },
      ).html
      expect(html).toContain('$10,000')
      expect(html).not.toContain('$2,500')
    })
  })
})
