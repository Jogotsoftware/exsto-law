// MACHINE-COMMS-1 — unit contracts for the pure seams of the memory + voice
// pipelines: the email output parser (SUBJECT line contract), the transcript
// extraction parser ([fact]/[action] bullet contract), and the client-context
// formatter's hard budget + archived-matter visibility. Pure — no DB, no model.
import { describe, it, expect } from 'vitest'
import { parseEmailDraftOutput } from '../../verticals/legal/src/api/generateEmail.js'
import { parseExtractionOutput } from '../../verticals/legal/src/api/transcriptExtraction.js'
import {
  formatClientContext,
  type ClientContext,
} from '../../verticals/legal/src/queries/clientContext.js'

describe('parseEmailDraftOutput — the SUBJECT-line contract', () => {
  it('splits subject and body', () => {
    const out = parseEmailDraftOutput(
      'SUBJECT: Your signed lease review is complete\n\nHi Dana,\n\nGood news.',
      'fallback',
    )
    expect(out.subject).toBe('Your signed lease review is complete')
    expect(out.body).toBe('Hi Dana,\n\nGood news.')
  })

  it('missing SUBJECT line falls back deterministically, body preserved', () => {
    const out = parseEmailDraftOutput('Hi Dana,\n\nGood news.', 'Update on your matter M-1')
    expect(out.subject).toBe('Update on your matter M-1')
    expect(out.body).toBe('Hi Dana,\n\nGood news.')
  })

  it('empty subject after the marker falls back, and an all-whitespace body degrades to the raw text', () => {
    const out = parseEmailDraftOutput('SUBJECT:   \n\n  ', 'fallback')
    expect(out.subject).toBe('fallback')
    expect(out.body.length).toBeGreaterThan(0)
  })
})

describe('parseExtractionOutput — the [fact]/[action] bullet contract', () => {
  const raw = [
    '# Consultation summary',
    '',
    'The client met to discuss a lease.',
    '',
    '## Extracted facts and action items',
    '',
    '- [fact] The lease runs twelve months from August 1, 2026.',
    '- [action] Attorney: send the engagement letter.',
    '- [FACT] Rent is $1,850/month.',
    '- not a tagged bullet, dropped',
    '- [guess] also dropped (unknown tag)',
  ].join('\n')

  it('separates summary from items and parses tags case-insensitively', () => {
    const out = parseExtractionOutput(raw)
    expect(out.summary).toContain('# Consultation summary')
    expect(out.summary).not.toContain('Extracted facts')
    expect(out.items).toHaveLength(3)
    expect(out.items[0]).toEqual({
      kind: 'fact',
      text: 'The lease runs twelve months from August 1, 2026.',
    })
    expect(out.items[1]!.kind).toBe('action')
    expect(out.items[2]!.kind).toBe('fact')
  })

  it('no items section → summary only, zero items (never guessed)', () => {
    const out = parseExtractionOutput('# Consultation summary\n\nShort call, nothing concrete.')
    expect(out.items).toEqual([])
    expect(out.summary).toContain('Short call')
  })
})

describe('formatClientContext — hard budget + archived visibility', () => {
  const context: ClientContext = {
    clientEntityId: 'c1',
    name: 'Dana Whitfield',
    contacts: [{ fullName: 'Dana Whitfield', email: 'dana@example.test' }],
    matters: [
      {
        matterEntityId: 'm2',
        matterNumber: 'M-NEW',
        serviceKey: 'nc_will_drafting',
        matterStatus: 'in_review',
        archived: false,
        openedAt: '2026-07-01',
        intakeFacts: { spouse_name: 'Alex' },
        releasedDocuments: [],
        notes: [],
      },
      {
        matterEntityId: 'm1',
        matterNumber: 'M-OLD',
        serviceKey: 'nc_residential_lease_review',
        matterStatus: 'completed',
        archived: true,
        openedAt: '2026-06-01',
        intakeFacts: { landlord: 'Hollowstone Property Group' },
        releasedDocuments: [
          { documentKind: 'engagement_letter', versionNumber: 3, approvedAt: '2026-06-02' },
        ],
        notes: [],
      },
    ],
    clientNotes: [
      {
        noteEntityId: 'n1',
        body: 'Prefers email over phone.',
        source: 'attorney',
        authorName: 'Joe',
        authorType: 'human',
        aboutEntityId: null,
        aboutEntityKind: null,
        createdAt: '2026-07-01T00:00:00+00:00',
      },
    ],
    transcripts: [],
    recentMessages: [],
  }

  it('archived matters are VISIBLE and marked — finished work informs the next email', () => {
    const text = formatClientContext(context)
    expect(text).toContain('M-OLD')
    expect(text).toContain('ARCHIVED (completed work)')
    expect(text).toContain('engagement_letter v3')
    expect(text).toContain('Prefers email over phone.')
  })

  it('never exceeds the hard budget and marks truncation', () => {
    const text = formatClientContext(context, 200)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text).toContain('truncated')
  })
})
