// MACHINE-COMMS-1 — unit contracts for the pure seams of the memory + voice
// pipelines: the email output parser (SUBJECT line contract), the transcript
// extraction parser ([fact]/[action] bullet contract), and the client-context
// formatter's hard budget + archived-matter visibility. Pure — no DB, no model.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  parseEmailDraftOutput,
  formatClientBriefForEmail,
  CLIENT_BRIEF_MAX_CHARS,
  NO_CLIENT_BRIEF_MARKER,
} from '../../verticals/legal/src/api/generateEmail.js'
import {
  checkEmailVoice,
  buildVoiceCorrectionSection,
} from '../../verticals/legal/src/api/emailVoiceChecks.js'
import { loadEmailDraftingPrompt } from '../../verticals/legal/src/templates/loader.js'
import { parseExtractionOutput } from '../../verticals/legal/src/api/transcriptExtraction.js'
import {
  formatClientContext,
  type ClientContext,
} from '../../verticals/legal/src/queries/clientContext.js'
import type { StoredBrief } from '../../verticals/legal/src/queries/briefs.js'

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

describe('checkEmailVoice — the STYLE-FIX-2 deterministic house-voice validator', () => {
  const CLEAN_BODY =
    'Dana,\n\nWe compared the revised lease against our memo. The deposit is now $1,850.\n\nReply and tell us whether to proceed.\n\nBest,\nJoe Pacheco'

  it('a clean draft passes with zero violations', () => {
    expect(checkEmailVoice('Hollowstone Lease: Results', CLEAN_BODY)).toEqual([])
  })

  it('flags an em dash in the subject — the historical 3-for-3 failure site', () => {
    const v = checkEmailVoice('Lease review — results inside', CLEAN_BODY)
    expect(v.some((x) => x.rule === 'em_dash' && x.where === 'subject')).toBe(true)
  })

  it('flags the exact 5/8-draft failure modes: bold headers, em dashes, "actually"', () => {
    const body =
      'Dana,\n\n**What made it in — exactly as negotiated:**\n\n- Deposit: $1,850.\n- Late fee: $75.\n\n**Your next step:** Reply and let us know.\n\nThere is no requirement to actually list the property.\n\nBest,\nJoe Pacheco'
    const v = checkEmailVoice('Results', body)
    const rules = v.map((x) => x.rule)
    expect(rules).toContain('em_dash')
    expect(rules).toContain('body_header')
    expect(rules).toContain('filler_adverb')
    // Both header shapes tripped: the whole-line bold and the bold lead-in label.
    expect(v.filter((x) => x.rule === 'body_header').length).toBeGreaterThanOrEqual(2)
  })

  it('adverbs match on word boundaries — "adjustment" and "justice" stay clean', () => {
    expect(
      checkEmailVoice('Update', 'Dana,\n\nThe adjustment serves justice.\n\nBest,\nJoe'),
    ).toEqual([])
    const v = checkEmailVoice('Update', 'Dana,\n\nWe just need one signature.\n\nBest,\nJoe')
    expect(v.some((x) => x.rule === 'filler_adverb' && x.offending.includes('"just"'))).toBe(true)
  })

  it('banned phrases match through curly apostrophes and both spellings', () => {
    const curly = checkEmailVoice('Update', 'Dana,\n\nIt’s worth noting the cap.\n\nBest,\nJoe')
    expect(curly.some((x) => x.rule === 'banned_phrase')).toBe(true)
    const spelled = checkEmailVoice('Update', 'Dana,\n\nHere is what we found.\n\nBest,\nJoe')
    expect(spelled.some((x) => x.rule === 'banned_phrase')).toBe(true)
  })

  it('requires the plain sign-off near the end of the body', () => {
    const v = checkEmailVoice('Update', 'Dana,\n\nAll set.\n\nWarm regards,\nJoe')
    expect(v.some((x) => x.rule === 'sign_off')).toBe(true)
    expect(
      checkEmailVoice('Update', 'Dana,\n\nAll set.\n\nThanks,\nJoe').some(
        (x) => x.rule === 'sign_off',
      ),
    ).toBe(false)
  })

  it("the doctrine's own exemplar validates clean — house-voice.md can never drift from the checks silently", () => {
    const doctrine = readFileSync(
      new URL('../../verticals/legal/templates/house-voice.md', import.meta.url),
      'utf8',
    )
    const m = doctrine.match(/### Match this register:[\s\S]*?```\n([\s\S]*?)```/)
    expect(m).not.toBeNull()
    expect(checkEmailVoice('Hollowstone Lease: Results', m![1]!.trim())).toEqual([])
  })

  it('the corrective section names each violation with its offending text and shows the failing draft', () => {
    const violations = checkEmailVoice('Results — inside', CLEAN_BODY)
    const section = buildVoiceCorrectionSection(
      { subject: 'Results — inside', body: CLEAN_BODY },
      violations,
    )
    expect(section).toContain('Your previous draft violated these house-voice rules')
    expect(section).toContain('No em dashes anywhere')
    expect(section).toContain('Results — inside')
    expect(section).toContain('Produce a corrected draft')
  })
})

describe('loadEmailDraftingPrompt — composes the house-voice doctrine (STYLE-FIX-2)', () => {
  it('the doctrine is included whole and the slot is consumed', () => {
    const prompt = loadEmailDraftingPrompt()
    expect(prompt).not.toContain('{{house_voice_doctrine}}')
    expect(prompt).toContain('Adapted from stop-slop by Hardik Pandya')
    expect(prompt).toContain('Match this register')
    expect(prompt).toContain('No em dashes anywhere.')
    // The data slots the compose path fills are untouched. {{firm_instructions}}
    // (WP FB-B) is one of these — see ai-context-custom-instructions.test.ts for
    // its fill/empty-safe behavior. {{client_brief}} is WP B5's — see below.
    expect(prompt).toContain('{{purpose}}')
    expect(prompt).toContain('{{client_context}}')
    expect(prompt).toContain('{{client_brief}}')
    expect(prompt).toContain('{{firm_instructions}}')
  })
})

// WP B5 — the {{client_brief}} slot: a plain, clipped READ of the stored
// client brief, honest about absence. Pure — no DB.
describe('formatClientBriefForEmail — the {{client_brief}} slot (WP B5)', () => {
  function storedBrief(markdown: string): StoredBrief {
    return {
      briefEntityId: 'b1',
      briefType: 'client',
      markdown,
      sections: [],
      generatedAt: '2026-07-10T00:00:00.000Z',
      sourceWatermark: '2026-07-10T00:00:00.000Z',
      modelIdentity: 'claude-x',
      confidence: 0.7,
    }
  }

  it('returns the brief markdown verbatim when under budget', () => {
    expect(
      formatClientBriefForEmail(storedBrief('Dana is a repeat client in good standing.')),
    ).toBe('Dana is a repeat client in good standing.')
  })

  it('the honest absence marker when no brief was ever generated (null)', () => {
    expect(formatClientBriefForEmail(null)).toBe(NO_CLIENT_BRIEF_MARKER)
  })

  it('the honest absence marker for a stored-but-empty brief', () => {
    expect(formatClientBriefForEmail(storedBrief('   '))).toBe(NO_CLIENT_BRIEF_MARKER)
  })

  it('clips long briefs to the budget and marks the truncation, never silently', () => {
    const long = 'x'.repeat(CLIENT_BRIEF_MAX_CHARS + 500)
    const out = formatClientBriefForEmail(storedBrief(long))
    expect(out.length).toBeLessThanOrEqual(CLIENT_BRIEF_MAX_CHARS)
    expect(out).toContain(`truncated at ${CLIENT_BRIEF_MAX_CHARS} chars`)
  })

  it('respects a custom maxChars override', () => {
    const out = formatClientBriefForEmail(storedBrief('y'.repeat(500)), 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out).toContain('truncated at 100 chars')
  })
})
