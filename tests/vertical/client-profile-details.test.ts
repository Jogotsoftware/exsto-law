// PORTAL signup part 2 — the client_contact attribute contract the /book funnel's
// "details" step writes. PURE unit tests (no DB, no model): they pin which fields
// persist and how the optional ones are gated, so the intake handler and the
// funnel can never drift on what a sign-up captures.
import { describe, it, expect } from 'vitest'
import { buildClientContactAttrs } from '@exsto/legal'

const address = (formatted: string) => ({
  formatted_address: formatted,
  street: '123 Main St',
  city: 'Raleigh',
  state: 'NC',
  postal_code: '27601',
  country: 'US',
  lat: null,
  lng: null,
})

function kinds(attrs: Array<{ kind: string; value: unknown }>): string[] {
  return attrs.map((a) => a.kind)
}

describe('buildClientContactAttrs', () => {
  it('always writes full_name + email, nothing optional when absent', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada Lovelace',
      client_email: 'ada@example.com',
      client_phone: null,
      client_company_name: null,
    })
    expect(kinds(attrs)).toEqual(['full_name', 'email'])
    expect(attrs.find((a) => a.kind === 'full_name')?.value).toBe('Ada Lovelace')
  })

  it('writes phone, company, mailing address and preferred method when supplied', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada Lovelace',
      client_email: 'ada@example.com',
      client_phone: '+19195551234',
      client_company_name: 'Analytical Engines LLC',
      client_mailing_address: address('123 Main St, Raleigh, NC'),
      client_preferred_contact_method: 'phone',
    })
    expect(kinds(attrs)).toEqual([
      'full_name',
      'email',
      'phone',
      'company_name',
      'mailing_address',
      'preferred_contact_method',
    ])
    expect(attrs.find((a) => a.kind === 'preferred_contact_method')?.value).toBe('phone')
  })

  it('writes a business_address only when it is a real structured address', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada',
      client_email: 'ada@example.com',
      client_phone: null,
      client_company_name: 'Analytical Engines LLC',
      client_business_address: address('500 Market St, Raleigh, NC'),
    })
    expect(kinds(attrs)).toContain('business_address')
  })

  it('drops blank/whitespace optionals — never clears a prior value with emptiness', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada',
      client_email: 'ada@example.com',
      client_phone: '   ',
      client_company_name: '',
      client_preferred_contact_method: '  ',
    })
    expect(kinds(attrs)).toEqual(['full_name', 'email'])
  })

  it('ignores a non-structured or empty address object', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada',
      client_email: 'ada@example.com',
      client_phone: null,
      client_company_name: null,
      client_mailing_address: {}, // no formatted_address
      client_business_address: 'not an object',
    })
    expect(kinds(attrs)).toEqual(['full_name', 'email'])
  })

  it('rejects an out-of-vocabulary preferred contact method', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada',
      client_email: 'ada@example.com',
      client_phone: null,
      client_company_name: null,
      client_preferred_contact_method: 'carrier_pigeon',
    })
    expect(kinds(attrs)).not.toContain('preferred_contact_method')
  })

  it('trims stored string values', () => {
    const attrs = buildClientContactAttrs({
      client_full_name: 'Ada',
      client_email: 'ada@example.com',
      client_phone: ' +19195551234 ',
      client_company_name: ' Engines LLC ',
    })
    expect(attrs.find((a) => a.kind === 'phone')?.value).toBe('+19195551234')
    expect(attrs.find((a) => a.kind === 'company_name')?.value).toBe('Engines LLC')
  })
})
