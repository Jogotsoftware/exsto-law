// SECURITY: web_search must never run on a GROUNDED Claude turn, because the full
// matter/client context (client PII, email bodies, transcripts) is in the prompt
// and Anthropic's server-side web_search could exfiltrate it into search queries.
// Perplexity is exempt — it only ever receives the non-confidential framing.
import { describe, it, expect } from 'vitest'
import { webSearchOn } from '@exsto/legal'

const claude = { supportsWebSearch: true, webSearchInherent: false }
const perplexity = { supportsWebSearch: true, webSearchInherent: true }

describe('webSearchOn — web_search security gate', () => {
  it('disables web_search on a grounded Claude turn even with the toggle on', () => {
    expect(webSearchOn(claude, true, true)).toBe(false)
  })

  it('allows web_search on an UNGROUNDED Claude turn when the attorney toggles it on', () => {
    expect(webSearchOn(claude, true, false)).toBe(true)
  })

  it('keeps web_search off on Claude when the toggle is off (grounded or not)', () => {
    expect(webSearchOn(claude, false, false)).toBe(false)
    expect(webSearchOn(claude, false, true)).toBe(false)
  })

  it('keeps Perplexity inherent search on (it only ever gets the non-confidential framing)', () => {
    expect(webSearchOn(perplexity, false, true)).toBe(true)
    expect(webSearchOn(perplexity, true, false)).toBe(true)
  })
})
