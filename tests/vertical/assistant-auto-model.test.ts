// The "Auto" model tier is the firm's cost default: send ordinary turns to
// Haiku, escalate to Sonnet only when the turn shows it actually needs it.
// This pins chooseAutoModel()'s branches — build mode, drafting/analysis
// intent against a real document, long messages, and long accumulated
// history — plus the word-boundary safety fix (ASCII \b mis-splits next to
// accented letters; this repo hit that bug before).
import { describe, it, expect } from 'vitest'
import { chooseAutoModel, AUTO_MODEL_HAIKU_ID, AUTO_MODEL_SONNET_ID } from '@exsto/legal'

describe('chooseAutoModel — cost-default router for the Auto tier', () => {
  it('routes ordinary turns to Haiku', () => {
    expect(chooseAutoModel({ message: "what's the status of this matter?" })).toBe(
      AUTO_MODEL_HAIKU_ID,
    )
    expect(chooseAutoModel({ message: 'summarize this matter' })).toBe(AUTO_MODEL_HAIKU_ID)
    expect(chooseAutoModel({ message: 'ok thanks' })).toBe(AUTO_MODEL_HAIKU_ID)
    expect(chooseAutoModel({ message: 'yes, that works' })).toBe(AUTO_MODEL_HAIKU_ID)
  })

  it('keeps "summarize" cheap even against a real document noun (explicitly excluded)', () => {
    expect(chooseAutoModel({ message: 'summarize this lease agreement for me' })).toBe(
      AUTO_MODEL_HAIKU_ID,
    )
  })

  it('escalates a drafting ask against a document to Sonnet', () => {
    expect(chooseAutoModel({ message: 'draft an engagement letter for the client' })).toBe(
      AUTO_MODEL_SONNET_ID,
    )
    expect(chooseAutoModel({ message: 'prepare a lease addendum' })).toBe(AUTO_MODEL_SONNET_ID)
  })

  it('escalates on the "draw up" phrasal verb', () => {
    expect(chooseAutoModel({ message: 'can you draw up a will for this client' })).toBe(
      AUTO_MODEL_SONNET_ID,
    )
  })

  it('does not escalate on bare "draw" without "up"', () => {
    expect(chooseAutoModel({ message: 'draw a quick diagram of the deed transfer' })).toBe(
      AUTO_MODEL_HAIKU_ID,
    )
  })

  it('escalates whenever buildMode is set, even for a trivial message', () => {
    expect(chooseAutoModel({ message: 'hi', buildMode: true })).toBe(AUTO_MODEL_SONNET_ID)
  })

  it('escalates a long message regardless of content', () => {
    const longMessage = 'hello '.repeat(300) // > 1500 chars, no intent verb or doc noun
    expect(longMessage.length).toBeGreaterThan(1500)
    expect(chooseAutoModel({ message: longMessage })).toBe(AUTO_MODEL_SONNET_ID)
  })

  it('does not escalate a message right at or under the 1500-char threshold', () => {
    const message = 'hello '.repeat(249) // 1494 chars
    expect(message.length).toBeLessThanOrEqual(1500)
    expect(chooseAutoModel({ message })).toBe(AUTO_MODEL_HAIKU_ID)
  })

  it('escalates when accumulated history is long, even for a short message', () => {
    expect(chooseAutoModel({ message: 'continue', historyChars: 60_001 })).toBe(
      AUTO_MODEL_SONNET_ID,
    )
  })

  it('does not escalate at or under the historyChars threshold', () => {
    expect(chooseAutoModel({ message: 'continue', historyChars: 60_000 })).toBe(AUTO_MODEL_HAIKU_ID)
  })

  describe('word-boundary safety', () => {
    it('does not fire on "review" appearing inside another word, absent a doc noun', () => {
      expect(chooseAutoModel({ message: 'give me a quick overview of the schedule' })).toBe(
        AUTO_MODEL_HAIKU_ID,
      )
    })

    it('escalates on an inflected form of an intent verb ("reviewing") plus a doc noun', () => {
      expect(chooseAutoModel({ message: 'reviewing the lease agreement now' })).toBe(
        AUTO_MODEL_SONNET_ID,
      )
    })

    it('is Unicode-safe around accented letters (no ASCII \\b mis-split)', () => {
      // "Peña" abuts the accented ñ right where an ASCII \b would misplace a
      // word boundary; the message still carries a real intent verb + doc noun.
      expect(chooseAutoModel({ message: 'draft the contract for señor Peña, please' })).toBe(
        AUTO_MODEL_SONNET_ID,
      )
    })
  })
})
