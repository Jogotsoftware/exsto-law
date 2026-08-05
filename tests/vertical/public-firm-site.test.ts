// FIRM-LANDING-2 — the public landing page's PURE composition (no DB):
// 1) toPublicFirmSite maps resolved firm settings to a CLOSED public-safe shape
//    — private settings (rates, assistant instructions, jurisdiction) must
//    never appear, and the key set is pinned so a future spread can't leak.
// 2) toPublicSiteServices offers ONLY bookable services and prefers the
//    client-facing copy exactly like the /book picker's tiles.
// 3) normalizeFirmProfileFieldValue for the new firm_tagline / firm_about
//    fields: trim, clear-on-empty, and loud rejection over the length caps
//    (never silent truncation — the copy renders verbatim on the public page).
import { describe, it, expect } from 'vitest'
import {
  toPublicFirmSite,
  toPublicSiteServices,
  type ServiceDefinition,
  type TenantSettings,
} from '@exsto/legal'
import { normalizeFirmProfileFieldValue } from '../../verticals/legal/src/handlers/firmProfile.js'

const EMPTY_SETTINGS: TenantSettings = {
  firmName: null,
  attorneyName: null,
  firmEmail: null,
  firmPhone: null,
  firmAddress: null,
  firmJurisdiction: null,
  practiceAreas: null,
  assistantInstructions: null,
  portalAssistantInstructions: null,
  headerColor: null,
  tagline: null,
  about: null,
  defaultHourlyRateUsd: null,
  defaultLlcFlatFeeUsd: null,
  updatedAt: null,
}

function settings(overrides: Partial<TenantSettings>): TenantSettings {
  return { ...EMPTY_SETTINGS, ...overrides }
}

function svc(overrides: Partial<ServiceDefinition>): ServiceDefinition {
  return {
    id: 'svc-1',
    serviceKey: 'llc_formation',
    displayName: 'NC LLC Formation (Ch. 57D)',
    description: 'Attorney-facing description',
    clientDisplayName: null,
    clientDescription: null,
    clientCopyI18n: null,
    route: 'manual',
    intakeFormId: 'form-1',
    intakeSchema: { sections: [] },
    documents: [],
    cost: null,
    documentFees: {},
    generationMode: 'template_merge',
    booking: null,
    appointmentRequired: true,
    offerSpanish: false,
    isActive: true,
    bookable: true,
    sortOrder: 0,
    updatedAt: '2026-08-05T00:00:00+00:00',
    ...overrides,
  } as ServiceDefinition
}

describe('toPublicSiteServices — the landing tiles', () => {
  it('offers only bookable services', () => {
    const out = toPublicSiteServices([
      svc({ serviceKey: 'a', bookable: true }),
      svc({ serviceKey: 'b', bookable: false }),
    ])
    expect(out.map((s) => s.serviceKey)).toEqual(['a'])
  })

  it('prefers client-facing copy, falls back to attorney copy (never blank)', () => {
    const [authored] = toPublicSiteServices([
      svc({ clientDisplayName: 'Start an LLC', clientDescription: 'We set it up for you.' }),
    ])
    expect(authored).toEqual({
      serviceKey: 'llc_formation',
      title: 'Start an LLC',
      description: 'We set it up for you.',
    })
    const [fallback] = toPublicSiteServices([svc({})])
    expect(fallback.title).toBe('NC LLC Formation (Ch. 57D)')
    expect(fallback.description).toBe('Attorney-facing description')
  })

  it('whitespace-only client copy falls back too', () => {
    const [s] = toPublicSiteServices([svc({ clientDisplayName: '   ', clientDescription: ' ' })])
    expect(s.title).toBe('NC LLC Formation (Ch. 57D)')
    expect(s.description).toBe('Attorney-facing description')
  })

  it('never exposes intake schema / cost / lifecycle internals', () => {
    const [s] = toPublicSiteServices([svc({})])
    expect(Object.keys(s).sort()).toEqual(['description', 'serviceKey', 'title'])
  })
})

describe('toPublicFirmSite — public-safe closed shape', () => {
  it('exposes exactly the public fields, nothing private', () => {
    const site = toPublicFirmSite({
      slug: 'pacheco',
      resolvedFirmName: 'Pacheco Law',
      settings: settings({
        firmName: 'Pacheco Law Firm',
        attorneyName: 'J. Pacheco',
        firmPhone: '+1 919 555 0100',
        firmEmail: 'hello@pacheco.law',
        firmAddress: '100 Main St\nRaleigh, NC',
        headerColor: '#1b2a4a',
        tagline: 'Business law, handled properly.',
        about: 'We are a small firm.',
        // Private values that must NOT surface:
        firmJurisdiction: 'NC',
        practiceAreas: ['business law'],
        assistantInstructions: ['always CC my paralegal'],
        portalAssistantInstructions: ['office closes at 5pm'],
        defaultHourlyRateUsd: 350,
        defaultLlcFlatFeeUsd: 1500,
      }),
      services: [svc({})],
    })
    // The CLOSED key set — a new private field can never leak by omission.
    expect(Object.keys(site).sort()).toEqual([
      'about',
      'attorneyName',
      'contact',
      'firmName',
      'headerColor',
      'services',
      'slug',
      'tagline',
    ])
    expect(Object.keys(site.contact).sort()).toEqual(['address', 'email', 'phone'])
    expect(site.firmName).toBe('Pacheco Law Firm')
    expect(site.tagline).toBe('Business law, handled properly.')
    expect(site.about).toBe('We are a small firm.')
    expect(site.headerColor).toBe('#1b2a4a')
    expect(site.contact).toEqual({
      phone: '+1 919 555 0100',
      email: 'hello@pacheco.law',
      address: '100 Main St\nRaleigh, NC',
    })
    const json = JSON.stringify(site)
    expect(json).not.toContain('350')
    expect(json).not.toContain('paralegal')
    expect(json).not.toContain('5pm')
    expect(json).not.toContain('"NC"')
  })

  it('falls back to the slug resolver firm name when the profile has none', () => {
    const site = toPublicFirmSite({
      slug: 'pacheco',
      resolvedFirmName: 'Pacheco Law',
      settings: settings({}),
      services: [],
    })
    expect(site.firmName).toBe('Pacheco Law')
    expect(site.tagline).toBeNull()
    expect(site.about).toBeNull()
    expect(site.contact).toEqual({ phone: null, email: null, address: null })
    expect(site.services).toEqual([])
  })
})

describe('normalizeFirmProfileFieldValue — firm_tagline / firm_about', () => {
  it('trims and passes ordinary copy through', () => {
    expect(normalizeFirmProfileFieldValue('firm_tagline', '  Handled properly.  ')).toBe(
      'Handled properly.',
    )
    expect(normalizeFirmProfileFieldValue('firm_about', ' We are a small firm. ')).toBe(
      'We are a small firm.',
    )
  })

  it("empty/null/non-string clears to '' (readers report null)", () => {
    expect(normalizeFirmProfileFieldValue('firm_tagline', '')).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_tagline', null)).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_about', undefined)).toBe('')
    expect(normalizeFirmProfileFieldValue('firm_about', 42)).toBe('')
  })

  it('rejects over-cap copy loudly instead of silently truncating', () => {
    expect(() => normalizeFirmProfileFieldValue('firm_tagline', 'x'.repeat(161))).toThrow(
      /firm_tagline.*160/,
    )
    expect(() => normalizeFirmProfileFieldValue('firm_about', 'x'.repeat(4001))).toThrow(
      /firm_about.*4000/,
    )
    // At the cap is fine.
    expect(normalizeFirmProfileFieldValue('firm_tagline', 'x'.repeat(160))).toBe('x'.repeat(160))
  })
})
