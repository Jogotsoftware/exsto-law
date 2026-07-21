// ESIGN-UNIFY-1 (ES-1) — the branded signing emails (design §9.4). The three
// esign builders are TENANT-branded: identity comes exclusively from the
// notification variables (attorney_name/firm_name threaded from
// getTenantSettings) — never from the hardcoded FIRM constant. These tests pin
// the §9.4 shape (sender line, gold CTA "Open your document", personal
// message) and the anti-hardcoding rule (no Pacheco when the variables don't
// say so). Copy assertions also pin the deliverability de-fingerprint: no
// "review and sign electronically" / "secure link" phrasing.
import { describe, expect, it } from 'vitest'
import { buildEmail, listTemplateRefs } from '../../verticals/legal/src/email/templates.js'
import { renderNotificationTemplate } from '../../verticals/legal/src/api/notificationTemplates.js'

const BASE_VARS = {
  signer_name: 'Ana López',
  document_title: 'Commercial Lease Agreement',
  envelope_subject: 'Commercial Lease Agreement',
  attorney_name: 'Juan Carlos Pacheco',
  firm_name: 'Pacheco Law Firm, PLLC',
  envelope_message: 'Please review section 4 before signing.',
  sign_url: 'https://firm.example/sign/tok123',
  portal_url: 'https://firm.example/portal/sign/req123',
  copy_url: 'https://firm.example/sign/tok456',
}

describe('esign builders are registered', () => {
  it('all three refs build', () => {
    const refs = listTemplateRefs()
    expect(refs).toContain('esign-sign-request')
    expect(refs).toContain('esign-sign-request-portal')
    expect(refs).toContain('esign-copy-delivered')
  })
})

describe('esign-sign-request (§9.4 shape)', () => {
  it('sender identity "<Attorney> via <Firm>", gold CTA "Open your document", message included', () => {
    const built = buildEmail('esign-sign-request', BASE_VARS)!
    expect(built.subject).toBe('Commercial Lease Agreement')
    expect(built.html).toContain('Juan Carlos Pacheco via Pacheco Law Firm, PLLC')
    expect(built.html).toContain('has a document ready for your signature')
    expect(built.html).toMatch(/Open your document\s*<\/a>/) // the ONE CTA label
    expect(built.html).toContain('https://firm.example/sign/tok123')
    expect(built.html).toContain('Please review section 4 before signing.')
    // De-fingerprint: no phishing-classic phrasing in the rendered copy.
    expect(built.html).not.toContain('review and sign electronically')
    expect(built.html).not.toContain('secure link')
    // Plaintext part always ships (multipart/alternative house rule).
    expect(built.text).toContain('Open your document: https://firm.example/sign/tok123')
    expect(built.text).toContain('Please review section 4 before signing.')
  })

  it('NEVER hardcodes a firm: unknown identity degrades to neutral copy', () => {
    const { attorney_name: _a, firm_name: _f, ...anon } = BASE_VARS
    const built = buildEmail('esign-sign-request', anon)!
    expect(built.html).not.toContain('Pacheco')
    expect(built.text).not.toContain('Pacheco')
    expect(built.html).toContain('Your attorney has a document ready for your signature')
  })

  it('omits the message block when no personal message was written', () => {
    const built = buildEmail('esign-sign-request', { ...BASE_VARS, envelope_message: '' })!
    expect(built.html).not.toContain('Message from')
    expect(built.text).not.toContain('Message from')
  })
})

describe('esign-sign-request-portal', () => {
  it('routes the CTA to the portal URL with portal copy', () => {
    const built = buildEmail('esign-sign-request-portal', BASE_VARS)!
    expect(built.html).toContain('https://firm.example/portal/sign/req123')
    expect(built.html).toContain('client portal')
    expect(built.html).toMatch(/Open your document\s*<\/a>/)
  })
})

describe('esign-copy-delivered', () => {
  it('executed-copy framing with a view CTA', () => {
    const built = buildEmail('esign-copy-delivered', BASE_VARS)!
    expect(built.subject).toBe('Executed copy: Commercial Lease Agreement')
    expect(built.html).toContain('executed copy of a signed document')
    expect(built.html).toMatch(/View your copy\s*<\/a>/)
    expect(built.html).toContain('https://firm.example/sign/tok456')
  })
})

describe('plaintext notification templates (subject source for deliverNotification)', () => {
  it('esign-sign-request subject = envelope subject; body identity from variables', () => {
    const r = renderNotificationTemplate('esign-sign-request', BASE_VARS)
    expect(r.subject).toBe('Commercial Lease Agreement')
    expect(r.bodyText).toContain('Juan Carlos Pacheco has a document ready for your signature')
    expect(r.bodyText).toContain('Open your document: https://firm.example/sign/tok123')
    // De-fingerprint: no phishing-classic phrasing in the plaintext part either.
    expect(r.bodyText).not.toContain('secure link')
    expect(r.bodyText).not.toContain('electronic')
  })

  it('degrades to neutral copy — no hardcoded firm — when identity vars are absent', () => {
    const { attorney_name: _a, firm_name: _f, ...anon } = BASE_VARS
    for (const ref of ['esign-sign-request', 'esign-sign-request-portal', 'esign-copy-delivered']) {
      const r = renderNotificationTemplate(ref, anon)
      expect(r.subject + r.bodyText).not.toContain('Pacheco')
    }
  })

  it('esign-copy-delivered carries the copy link', () => {
    const r = renderNotificationTemplate('esign-copy-delivered', BASE_VARS)
    expect(r.subject).toBe('Executed copy: Commercial Lease Agreement')
    expect(r.bodyText).toContain('https://firm.example/sign/tok456')
  })
})
