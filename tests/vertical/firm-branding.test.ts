// FIRM-BRANDING-1 — the firm owns its logo + brand color; the invoice consumes
// them. These are the PURE pieces of that move: what the write layer will accept
// as a logo, and how the invoice renderer resolves branding it no longer owns.
import { describe, expect, it } from 'vitest'
import { normalizeFirmProfileFieldValue } from '../../verticals/legal/src/handlers/firmProfile.js'
import {
  DEFAULT_INVOICE_TEMPLATE,
  legibleInk,
  resolveInvoiceTemplate,
} from '../../verticals/legal/src/billing/invoicePdf.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('firm_logo write validation', () => {
  it('accepts a raster image data URL', () => {
    expect(normalizeFirmProfileFieldValue('firm_logo', PNG)).toBe(PNG)
    expect(normalizeFirmProfileFieldValue('firm_logo', 'data:image/jpeg;base64,/9j/4AAQ')).toBe(
      'data:image/jpeg;base64,/9j/4AAQ',
    )
  })

  it('clears on empty', () => {
    expect(normalizeFirmProfileFieldValue('firm_logo', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_logo', null)).toBe('')
  })

  it('rejects an SVG data URL — it is executable markup, not a picture', () => {
    expect(() =>
      normalizeFirmProfileFieldValue('firm_logo', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    ).toThrow(/PNG\/JPG/)
  })

  it('rejects a non-data-URL string (it would land in every page src)', () => {
    expect(() => normalizeFirmProfileFieldValue('firm_logo', 'https://evil.test/x.png')).toThrow(
      /PNG\/JPG/,
    )
  })

  it('rejects artwork over the size cap rather than truncating it', () => {
    const huge = `data:image/png;base64,${'A'.repeat(700_001)}`
    expect(() => normalizeFirmProfileFieldValue('firm_logo', huge)).toThrow(/too large/)
  })
})

describe('firm_logo_tone write validation', () => {
  it('accepts only the closed set', () => {
    expect(normalizeFirmProfileFieldValue('firm_logo_tone', 'light')).toBe('light')
    expect(normalizeFirmProfileFieldValue('firm_logo_tone', 'dark')).toBe('dark')
    expect(normalizeFirmProfileFieldValue('firm_logo_tone', '')).toBe('')
  })

  it('rejects anything else — the value drives a style decision', () => {
    expect(() => normalizeFirmProfileFieldValue('firm_logo_tone', 'medium')).toThrow(/light.*dark/)
  })
})

describe('invoice template defaults', () => {
  it('has NO firm-name default — a second firm must never print the pilot firm', () => {
    expect(DEFAULT_INVOICE_TEMPLATE.firmName).toBe('')
    expect(resolveInvoiceTemplate(null).firmName).toBe('')
    expect(resolveInvoiceTemplate({ firmName: '   ' }).firmName).toBe('')
  })

  it('carries the firm-resolved branding through unchanged', () => {
    const t = resolveInvoiceTemplate({
      firmName: 'Second Firm LLP',
      logoDataUrl: PNG,
      logoTone: 'light',
      accentColor: '#5b2333',
    })
    expect(t.firmName).toBe('Second Firm LLP')
    expect(t.logoDataUrl).toBe(PNG)
    expect(t.logoTone).toBe('light')
    expect(t.accentColor).toBe('#5b2333')
  })

  it('treats an unrecognized tone as unknown rather than trusting it', () => {
    expect(resolveInvoiceTemplate({ logoTone: 'chartreuse' as never }).logoTone).toBeNull()
  })
})

describe('legibleInk — legibility of the accent on paper', () => {
  it('darkens a pale brand color until it can carry white text', () => {
    // The pilot firm's legacy invoice accent printed a white-on-baby-blue
    // table header; the ink derived from it must be materially darker.
    const out = legibleInk('#8ac6f4')
    expect(out).not.toBe('#8ac6f4')
    const lum = (hex: string): number =>
      (0.299 * parseInt(hex.slice(1, 3), 16) +
        0.587 * parseInt(hex.slice(3, 5), 16) +
        0.114 * parseInt(hex.slice(5, 7), 16)) /
      255
    expect(lum(out)).toBeLessThanOrEqual(0.32)
  })

  it('leaves an already-dark brand color alone so the firm keeps its hue', () => {
    expect(legibleInk('#5b2333')).toBe('#5b2333')
    expect(legibleInk('#1b2a4a')).toBe('#1b2a4a')
  })

  it('falls back to the product navy for a missing/invalid color', () => {
    expect(legibleInk('')).toBe('#14213d')
    expect(legibleInk('rebeccapurple')).toBe('#14213d')
  })
})

describe('BRANDING-SECTION-1 — secondary color + header logo write validation', () => {
  it('accepts a hex secondary color and lowercases it', () => {
    expect(normalizeFirmProfileFieldValue('firm_secondary_color', '#A6812F')).toBe('#a6812f')
  })

  it('rejects a non-hex secondary color — it lands in an inline style', () => {
    expect(() => normalizeFirmProfileFieldValue('firm_secondary_color', 'gold')).toThrow(
      /hex color/,
    )
  })

  it('clears the secondary color on empty (companion goes back to derived)', () => {
    expect(normalizeFirmProfileFieldValue('firm_secondary_color', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_secondary_color', null)).toBe('')
  })

  it('holds the header logo to the SAME guards as the firm logo', () => {
    expect(normalizeFirmProfileFieldValue('firm_logo_secondary', PNG)).toBe(PNG)
    expect(() =>
      normalizeFirmProfileFieldValue('firm_logo_secondary', 'https://evil.test/x.png'),
    ).toThrow(/PNG\/JPG/)
    expect(() =>
      normalizeFirmProfileFieldValue(
        'firm_logo_secondary',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      ),
    ).toThrow(/PNG\/JPG/)
    expect(() =>
      normalizeFirmProfileFieldValue(
        'firm_logo_secondary',
        `data:image/png;base64,${'A'.repeat(700_001)}`,
      ),
    ).toThrow(/too large/)
  })

  it('holds the header logo tone to the closed set', () => {
    expect(normalizeFirmProfileFieldValue('firm_logo_secondary_tone', 'dark')).toBe('dark')
    expect(() => normalizeFirmProfileFieldValue('firm_logo_secondary_tone', 'medium')).toThrow(
      /light.*dark/,
    )
  })
})

describe('BRANDING-SECTION-1 — the invoice no longer plates reversed artwork', () => {
  it('resolves a light-tone logo without any plate decision left in the config', () => {
    // The renderer prints t.logoDataUrl bare; tone survives only as a measured
    // fact. This guards the removal: nothing downstream may branch on it.
    const t = resolveInvoiceTemplate({ logoDataUrl: PNG, logoTone: 'light' })
    expect(t.logoDataUrl).toBe(PNG)
    expect(t.logoTone).toBe('light')
  })
})
