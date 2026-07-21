// ESIGN-UNIFY-1 ES-2 — send-time data auto-fill (§5.3): resolution order
// (signer's own recipient row → bound contact → allow-listed matter facts),
// honest nulls for anything unresolvable, and the FIRM_DEFAULTS-never POISON
// test — a merge blob carrying firm-identity values must never surface one
// onto a placement (the same forgery doctrine as tenantSettings' empty-not-
// guessed degrade).
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MATTER_KEYS,
  resolvePlacementData,
} from '../../verticals/legal/src/esign/placementData.js'
import type { FieldPlacement } from '../../verticals/legal/src/esign/placements.js'

function p(id: string, type: FieldPlacement['type'], signerKey = 's1'): FieldPlacement {
  return {
    id,
    type,
    signerKey,
    required: false,
    source: 'placed',
    rect: { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
  }
}

const RECIPIENTS = [
  { signerKey: 's1', name: 'Maria Alvarez', email: 'maria@client.test', title: 'Managing Member' },
  { signerKey: 's2', name: 'Sam Chen', email: 'sam@client.test', title: null },
]

describe('resolvePlacementData — resolution order (§5.3)', () => {
  it("name/email/title come from the placement's OWN signer row first", () => {
    const out = resolvePlacementData(
      [p('p0', 'name', 's1'), p('p1', 'email', 's2'), p('p2', 'title', 's1')],
      {
        recipients: RECIPIENTS,
        contact: { email: 'contact@firm-crm.test', phone: null, address: null },
      },
    )
    // s1's name field fills with THEIR name, not the bound contact's anything.
    expect(out.p0).toBe('Maria Alvarez')
    // s2's email is their own row, not the contact entity's.
    expect(out.p1).toBe('sam@client.test')
    expect(out.p2).toBe('Managing Member')
  })

  it('email falls back to the bound contact when the signer row has none', () => {
    const out = resolvePlacementData([p('p0', 'email', 's3')], {
      recipients: [{ signerKey: 's3', name: 'X', email: null, title: null }],
      contact: { email: 'contact@client.test' },
    })
    expect(out.p0).toBe('contact@client.test')
  })

  it('phone/address resolve from the bound contact entity', () => {
    const out = resolvePlacementData([p('p0', 'phone'), p('p1', 'address')], {
      recipients: RECIPIENTS,
      contact: { phone: '+1 555 0100', address: '1 Main St, Raleigh NC' },
    })
    expect(out.p0).toBe('+1 555 0100')
    expect(out.p1).toBe('1 Main St, Raleigh NC')
  })

  it('company prefers the contact company, then the matter company_name', () => {
    const viaContact = resolvePlacementData([p('p0', 'company')], {
      recipients: RECIPIENTS,
      contact: { company: 'Alvarez Holdings LLC' },
      matter: { company_name: 'From Matter LLC' },
    })
    expect(viaContact.p0).toBe('Alvarez Holdings LLC')
    const viaMatter = resolvePlacementData([p('p0', 'company')], {
      recipients: RECIPIENTS,
      contact: null,
      matter: { company_name: 'From Matter LLC' },
    })
    expect(viaMatter.p0).toBe('From Matter LLC')
  })

  it('unresolvable fields degrade to null (signer-fillable), never invented', () => {
    const out = resolvePlacementData(
      [p('p0', 'phone'), p('p1', 'company'), p('p2', 'title', 's2')],
      { recipients: RECIPIENTS, contact: null, matter: null },
    )
    expect(out.p0).toBeNull()
    expect(out.p1).toBeNull()
    expect(out.p2).toBeNull() // s2 has no title
  })

  it('sign/initial/text/check/date always resolve null (signer-completed / auto)', () => {
    const out = resolvePlacementData(
      [p('p0', 'sign'), p('p1', 'initial'), p('p2', 'text'), p('p3', 'check'), p('p4', 'date')],
      { recipients: RECIPIENTS, contact: { email: 'x@y.z' } },
    )
    expect(Object.values(out).every((v) => v === null)).toBe(true)
  })
})

describe('FIRM_DEFAULTS must NEVER reach placement data — poison test', () => {
  // A buildMergeData blob ALWAYS carries firm identity when tenant settings
  // resolve. Poison every firm-identity slot with sentinel values: if any one
  // of them ever surfaces on a placement, the allow-list fence is broken.
  const POISONED_MERGE_BLOB: Record<string, unknown> = {
    company_name: 'Real Client Co LLC',
    firm_name: 'POISON_FIRM_NAME',
    attorney_name: 'POISON_ATTORNEY',
    attorney_email: 'poison@firm.test',
    firm_email: 'poison-inbox@firm.test',
    firm_phone: 'POISON_PHONE',
    firm_address: 'POISON_ADDRESS',
    client_name: 'POISON_CLIENT_VIA_MERGE',
    primary_client_name: 'POISON_PRIMARY',
  }

  it('only allow-listed matter keys can surface; every poison stays buried', () => {
    const all: FieldPlacement[] = [
      p('p0', 'name'),
      p('p1', 'email', 's3'), // s3 has no email row → would need a fallback
      p('p2', 'company'),
      p('p3', 'phone'),
      p('p4', 'address'),
      p('p5', 'title', 's3'),
      p('p6', 'text'),
    ]
    const out = resolvePlacementData(all, {
      recipients: [...RECIPIENTS, { signerKey: 's3', name: null, email: null, title: null }],
      contact: null,
      matter: POISONED_MERGE_BLOB,
    })
    const values = Object.values(out).filter((v): v is string => v != null)
    for (const v of values) {
      expect(v).not.toContain('POISON')
      expect(v).not.toContain('poison')
    }
    // company IS allow-listed — the real client fact flows...
    expect(out.p2).toBe('Real Client Co LLC')
    // ...but nothing else from the blob does: phone/address/name/email/title
    // have no contact/recipient source here, so they are null, NOT merged.
    expect(out.p3).toBeNull()
    expect(out.p4).toBeNull()
    expect(out.p1).toBeNull()
    expect(out.p5).toBeNull()
  })

  it('the allow-list is exactly company_name (widen deliberately, with a test)', () => {
    expect(ALLOWED_MATTER_KEYS).toEqual(['company_name'])
  })
})
