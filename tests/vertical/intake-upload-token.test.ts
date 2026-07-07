// Security unit tests for the PUBLIC intake-upload staging token (no DB needed).
// The HMAC token is the ONLY handle the browser holds on a staged Storage object
// and the ONLY thing submitBooking trusts to bind that object to a matter, so
// forge / tamper / expiry / tenant-binding / prefix-confinement / domain-
// separation must all hold. Also pins that 'file_upload' is an authorable
// questionnaire field type (the config-as-data seam the /book renderer reads).
import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  signStagedUploadToken,
  verifyStagedUploadToken,
  signBookingManageToken,
  validateIntakeSchema,
  renderNotificationTemplate,
  KNOWN_FIELD_TYPES,
  INTAKE_STAGING_SEGMENT,
} from '@exsto/legal'

const SECRET = 'test-secret-at-least-16-chars-long'
const TENANT = 'tenant-1'
const payload = {
  tenantId: TENANT,
  objectKey: `${TENANT}/${INTAKE_STAGING_SEGMENT}/uuid-1-contract.pdf`,
  originalFilename: 'contract.pdf',
  contentType: 'application/pdf',
  sizeBytes: 12345,
  sha256Hex: 'ab'.repeat(32),
}

describe('stagedUploadToken — public intake-upload security', () => {
  beforeAll(() => {
    process.env.OAUTH_STATE_SECRET = SECRET
    delete process.env.ESIGN_SIGNING_SECRET // exercise the OAUTH_STATE_SECRET fallback
  })

  it('round-trips a valid token', () => {
    const out = verifyStagedUploadToken(signStagedUploadToken(payload), TENANT)
    expect(out.objectKey).toBe(payload.objectKey)
    expect(out.originalFilename).toBe('contract.pdf')
    expect(out.sizeBytes).toBe(12345)
  })

  it('rejects a tampered payload (attacker lacks the secret)', () => {
    const sig = signStagedUploadToken(payload).split('.')[1]
    const forged = Buffer.from(
      JSON.stringify({
        ...payload,
        objectKey: `${TENANT}/${INTAKE_STAGING_SEGMENT}/uuid-EVIL.pdf`,
        exp: Date.now() + 1e6,
      }),
    ).toString('base64url')
    expect(() => verifyStagedUploadToken(`${forged}.${sig}`, TENANT)).toThrow()
  })

  it('rejects a tampered signature', () => {
    const p = signStagedUploadToken(payload).split('.')[0]
    expect(() => verifyStagedUploadToken(`${p}.AAAAtampered`, TENANT)).toThrow()
  })

  it('rejects an expired token (valid MAC, past exp)', () => {
    const tok = signStagedUploadToken(payload, 1000, Date.now() - 10_000)
    expect(() => verifyStagedUploadToken(tok, TENANT)).toThrow(/expired/i)
  })

  it("rejects a token minted for ANOTHER tenant (can't cross tenants)", () => {
    const other = signStagedUploadToken({
      ...payload,
      tenantId: 'tenant-2',
      objectKey: `tenant-2/${INTAKE_STAGING_SEGMENT}/uuid-2-x.pdf`,
    })
    expect(() => verifyStagedUploadToken(other, TENANT)).toThrow()
  })

  it('rejects an object key OUTSIDE the staging prefix (validly signed) — a token can never name an arbitrary Storage object', () => {
    // e.g. another matter's real document key, signed by a confused deputy.
    const outside = signStagedUploadToken({
      ...payload,
      objectKey: `${TENANT}/some-matter-id/uuid-3-secret.pdf`,
    })
    expect(() => verifyStagedUploadToken(outside, TENANT)).toThrow()
  })

  it('is domain-separated from the booking-manage token (same secret, different MAC domain)', () => {
    // Hand-craft a staged-upload-shaped payload signed with the MANAGE domain:
    // it must not verify as an upload token.
    const full = { ...payload, exp: Date.now() + 1e6 }
    const b64 = Buffer.from(JSON.stringify(full)).toString('base64url')
    const manageMac = createHmac('sha256', SECRET)
      .update(`booking-manage.${b64}`)
      .digest('base64url')
    expect(() => verifyStagedUploadToken(`${b64}.${manageMac}`, TENANT)).toThrow()
    // And a real manage token isn't accepted either.
    const manageTok = signBookingManageToken({ matterEntityId: 'm1', tenantId: TENANT })
    expect(() => verifyStagedUploadToken(manageTok, TENANT)).toThrow()
  })

  it('fails closed when no signing secret is configured', () => {
    const saved = process.env.OAUTH_STATE_SECRET
    delete process.env.OAUTH_STATE_SECRET
    try {
      expect(() => signStagedUploadToken(payload)).toThrow(/SECRET/)
    } finally {
      process.env.OAUTH_STATE_SECRET = saved
    }
  })
})

describe('file_upload questionnaire field type', () => {
  it('is a known, authorable field type', () => {
    expect(KNOWN_FIELD_TYPES).toContain('file_upload')
  })

  it('passes intake-schema validation without an options list', () => {
    const doc = validateIntakeSchema({
      sections: [
        {
          id: 's1',
          title: 'Documents',
          fields: [
            {
              id: 'review_docs',
              label: 'Documents to review',
              type: 'file_upload',
              required: true,
            },
          ],
        },
      ],
    })
    expect(doc.sections[0].fields[0].type).toBe('file_upload')
  })
})

describe('attorney-manual-matter email — intake document count', () => {
  it('surfaces the count when documents were uploaded, and omits the line when none were', () => {
    const withDocs = renderNotificationTemplate('attorney-manual-matter', {
      client_full_name: 'Ada',
      document_count: 3,
    })
    expect(withDocs.bodyText).toContain('Documents uploaded at intake: 3')
    const without = renderNotificationTemplate('attorney-manual-matter', {
      client_full_name: 'Ada',
    })
    expect(without.bodyText).not.toContain('Documents uploaded at intake')
  })
})
