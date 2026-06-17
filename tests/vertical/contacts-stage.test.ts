// Contacts CRM pipeline stage derivation (Contacts CRM PR). deriveLeadStage maps
// a contact's matter statuses to a single pipeline stage: a contact with any open
// (non-closed) matter sits at that matter's FURTHEST stage; all-closed ⇒ closed;
// no matters ⇒ prospect. Pure (no DB).
import { describe, it, expect } from 'vitest'

describe('deriveLeadStage / statusToStage (pure)', { timeout: 90_000 }, () => {
  it('maps individual statuses to stages', async () => {
    const { statusToStage } = await import('@exsto/legal')
    expect(statusToStage('inquiry')).toBe('prospect')
    expect(statusToStage('questionnaire_submitted')).toBe('prospect')
    expect(statusToStage('consultation_scheduled')).toBe('consulted')
    expect(statusToStage('drafting')).toBe('engaged')
    expect(statusToStage('in_review')).toBe('engaged')
    expect(statusToStage('matter_active')).toBe('active')
    expect(statusToStage('engagement_signed')).toBe('active')
    expect(statusToStage('matter_closed')).toBe('closed')
    expect(statusToStage('something_unknown')).toBe('prospect')
  })

  it('derives the contact stage from all their matter statuses', async () => {
    const { deriveLeadStage } = await import('@exsto/legal')
    expect(deriveLeadStage([])).toBe('prospect') // no matters
    expect(deriveLeadStage(['inquiry'])).toBe('prospect')
    expect(deriveLeadStage(['consultation_scheduled'])).toBe('consulted')
    expect(deriveLeadStage(['matter_active'])).toBe('active')
    expect(deriveLeadStage(['matter_closed'])).toBe('closed') // all closed
    // furthest OPEN stage wins
    expect(deriveLeadStage(['inquiry', 'drafting'])).toBe('engaged')
    expect(deriveLeadStage(['consultation_scheduled', 'matter_active'])).toBe('active')
    // an open matter beats a closed one (they're still an active client)
    expect(deriveLeadStage(['matter_closed', 'drafting'])).toBe('engaged')
    expect(deriveLeadStage(['matter_closed', 'matter_closed'])).toBe('closed')
  })
})
