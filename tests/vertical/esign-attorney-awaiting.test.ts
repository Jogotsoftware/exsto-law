// ESIGN-ATTORNEY-REVIEW-1 — the Review Queue's "Awaiting your signature"
// section (an attorney can add themselves as a countersigner, #476, and now
// needs to SEE and sign those requests in-app). Tested here against the PURE
// filter/match functions esign.ts's listSignaturesAwaitingAttorney and
// assertAttorneyOwnsRequest delegate to — no DB needed, mirrors
// esign-role-dispatch.test.ts's approach for esign.ts's other pure planners.
import { describe, expect, it } from 'vitest'
import {
  isAwaitingAttorneySignature,
  isAttorneySignerMatch,
  type EnvelopeListSigner,
} from '@exsto/legal'

function signer(
  overrides: Partial<Pick<EnvelopeListSigner, 'email' | 'status'>>,
): Pick<EnvelopeListSigner, 'email' | 'status'> {
  return { email: 'attorney@pachecolaw.test', status: 'delivered', ...overrides }
}

const ATTORNEY_EMAIL = 'attorney@pachecolaw.test'

describe('isAttorneySignerMatch (pure email-match decision)', () => {
  it('matches identical emails', () => {
    expect(isAttorneySignerMatch('attorney@pachecolaw.test', 'attorney@pachecolaw.test')).toBe(true)
  })

  it('matches case-insensitively and trims whitespace', () => {
    expect(isAttorneySignerMatch('  Attorney@PachecoLaw.test ', 'attorney@pachecolaw.test')).toBe(
      true,
    )
  })

  it('rejects a different email', () => {
    expect(isAttorneySignerMatch('client@example.test', ATTORNEY_EMAIL)).toBe(false)
  })

  it('rejects when either side is null/undefined/empty', () => {
    expect(isAttorneySignerMatch(null, ATTORNEY_EMAIL)).toBe(false)
    expect(isAttorneySignerMatch(undefined, ATTORNEY_EMAIL)).toBe(false)
    expect(isAttorneySignerMatch('', ATTORNEY_EMAIL)).toBe(false)
    expect(isAttorneySignerMatch(ATTORNEY_EMAIL, null)).toBe(false)
    expect(isAttorneySignerMatch(ATTORNEY_EMAIL, undefined)).toBe(false)
    expect(isAttorneySignerMatch(null, null)).toBe(false)
  })
})

describe('isAwaitingAttorneySignature (pure envelope+signers → is-awaiting filter)', () => {
  it('includes an active envelope with the attorney delivered as a signer', () => {
    expect(
      isAwaitingAttorneySignature('sent', [signer({ status: 'delivered' })], ATTORNEY_EMAIL),
    ).toBe(true)
  })

  it('includes an active envelope with the attorney having opened (but not signed) it', () => {
    expect(
      isAwaitingAttorneySignature('sent', [signer({ status: 'opened' })], ATTORNEY_EMAIL),
    ).toBe(true)
  })

  it('includes a pending_dispatch envelope the same way as sent', () => {
    expect(
      isAwaitingAttorneySignature(
        'pending_dispatch',
        [signer({ status: 'delivered' })],
        ATTORNEY_EMAIL,
      ),
    ).toBe(true)
  })

  it('excludes a completed envelope, even if a signer row still reads delivered/opened', () => {
    expect(
      isAwaitingAttorneySignature('completed', [signer({ status: 'delivered' })], ATTORNEY_EMAIL),
    ).toBe(false)
  })

  it('excludes a declined envelope', () => {
    expect(
      isAwaitingAttorneySignature('declined', [signer({ status: 'delivered' })], ATTORNEY_EMAIL),
    ).toBe(false)
  })

  it('excludes a voided envelope', () => {
    expect(
      isAwaitingAttorneySignature('voided', [signer({ status: 'delivered' })], ATTORNEY_EMAIL),
    ).toBe(false)
  })

  it('excludes when the attorney has already signed (their own row is "signed", not delivered/opened)', () => {
    expect(
      isAwaitingAttorneySignature('sent', [signer({ status: 'signed' })], ATTORNEY_EMAIL),
    ).toBe(false)
  })

  it('excludes when it is not yet the attorney\'s turn (their row is "pending")', () => {
    expect(
      isAwaitingAttorneySignature('sent', [signer({ status: 'pending' })], ATTORNEY_EMAIL),
    ).toBe(false)
  })

  it('excludes when the delivered/opened signer is a DIFFERENT email (e.g. the client)', () => {
    expect(
      isAwaitingAttorneySignature(
        'sent',
        [signer({ email: 'client@example.test', status: 'delivered' })],
        ATTORNEY_EMAIL,
      ),
    ).toBe(false)
  })

  it('excludes when attorneyEmail is null (no connected Google account)', () => {
    expect(isAwaitingAttorneySignature('sent', [signer({ status: 'delivered' })], null)).toBe(false)
  })

  it('finds the attorney among several signers regardless of position', () => {
    const signers = [
      signer({ email: 'client@example.test', status: 'signed' }),
      signer({ email: ATTORNEY_EMAIL, status: 'delivered' }),
    ]
    expect(isAwaitingAttorneySignature('sent', signers, ATTORNEY_EMAIL)).toBe(true)
  })

  it('matches case-insensitively / trimmed, same as isAttorneySignerMatch', () => {
    expect(
      isAwaitingAttorneySignature(
        'sent',
        [signer({ email: ' Attorney@PachecoLaw.test ', status: 'opened' })],
        ATTORNEY_EMAIL,
      ),
    ).toBe(true)
  })
})
