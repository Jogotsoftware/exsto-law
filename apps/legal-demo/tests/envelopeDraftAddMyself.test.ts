// "Add myself" (founder request, esign composer Recipients step) — pinned
// against the two pure seams useEnvelopeDraft exposes for it: the duplicate-
// email guard that also drives the button's disabled state, and the default
// signing-order a newly appended row (Add recipient OR Add myself) receives.
import { describe, expect, it } from 'vitest'
import {
  EMPTY_RECIPIENT,
  nextRecipientOrder,
  recipientHasEmail,
  type DraftRecipient,
} from '@/components/esign/useEnvelopeDraft'

function recipient(patch: Partial<DraftRecipient>): DraftRecipient {
  return { ...EMPTY_RECIPIENT, ...patch }
}

describe('recipientHasEmail — the "Add myself" duplicate guard', () => {
  it('no match against an empty or unrelated recipient list', () => {
    expect(recipientHasEmail([], 'attorney@pachecolaw.com')).toBe(false)
    expect(
      recipientHasEmail([recipient({ email: 'client@example.com' })], 'attorney@pachecolaw.com'),
    ).toBe(false)
  })

  it('matches case-insensitively and ignores surrounding whitespace on both sides', () => {
    expect(
      recipientHasEmail(
        [recipient({ email: '  Attorney@PachecoLaw.com  ' })],
        'attorney@pachecolaw.com',
      ),
    ).toBe(true)
    expect(
      recipientHasEmail(
        [recipient({ email: 'attorney@pachecolaw.com' })],
        '  ATTORNEY@pachecolaw.com',
      ),
    ).toBe(true)
  })

  it('a blank/untouched row never counts as a match, even for a blank needle', () => {
    expect(recipientHasEmail([recipient({ email: '' })], '')).toBe(false)
    expect(recipientHasEmail([recipient({ email: '' })], '   ')).toBe(false)
  })
})

describe('nextRecipientOrder — default order for a newly appended row', () => {
  it('signing order OFF: every new row is parallel (order 1), regardless of count', () => {
    expect(nextRecipientOrder(0, false)).toBe(1)
    expect(nextRecipientOrder(3, false)).toBe(1)
  })

  it(
    'signing order ON: a new row lands last (existing count + 1) — e.g. the attorney ' +
      'countersigning after the client',
    () => {
      expect(nextRecipientOrder(0, true)).toBe(1)
      expect(nextRecipientOrder(1, true)).toBe(2)
      expect(nextRecipientOrder(3, true)).toBe(4)
    },
  )
})
