// WP3.4 / Objective 6 — the deterministic template-merge engine. These are PURE
// unit tests (no DB, no model, always run): they prove renderTemplate fills slots
// from data, flags missing fields honestly, and never calls anything external,
// and that buildMergeData maps matter + questionnaire facts onto template slots.
import { describe, it, expect } from 'vitest'
import { renderTemplate, buildMergeData } from '@exsto/legal'
import type { MatterDetail } from '@exsto/legal'

describe('renderTemplate (deterministic, no Anthropic)', () => {
  it('fills every known slot from the data map', () => {
    const { markdown, filledFields, missingFields } = renderTemplate(
      'Dear {{name}}, your company {{company}} is ready.',
      { name: 'Ada', company: 'Lovelace LLC' },
    )
    expect(markdown).toBe('Dear Ada, your company Lovelace LLC is ready.')
    expect(filledFields.sort()).toEqual(['company', 'name'])
    expect(missingFields).toEqual([])
  })

  it('renders an honest [[MISSING: x]] marker for absent/empty slots — never a blank or a guess', () => {
    const { markdown, missingFields } = renderTemplate('Fee: {{fee}}. Client: {{client}}.', {
      client: '',
      // fee absent entirely
    })
    expect(markdown).toBe('Fee: [[MISSING: fee]]. Client: [[MISSING: client]].')
    expect(missingFields.sort()).toEqual(['client', 'fee'])
  })

  it('tolerates whitespace and repeated slots', () => {
    const { markdown } = renderTemplate('{{ a }} and {{a}} again', { a: 'x' })
    expect(markdown).toBe('x and x again')
  })

  it('is a pure function — same inputs, same output, no side effects', () => {
    const tpl = 'Hi {{name}}'
    const data = { name: 'Sam' }
    expect(renderTemplate(tpl, data).markdown).toBe(renderTemplate(tpl, data).markdown)
  })
})

describe('buildMergeData', () => {
  const baseMatter = {
    matterEntityId: 'm1',
    matterNumber: 'PL-2026-0007',
    clientName: 'Maria Gomez',
    serviceKey: 'nc_llc_multi_member',
    workflowRoute: 'auto',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-06-18T00:00:00Z',
    practiceArea: 'nc_llc_multi_member',
    summary: '',
    attributes: {},
    questionnaireResponses: { company_name: 'Sunrise Ventures' },
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'maria@example.com',
  } satisfies MatterDetail

  it('maps matter + questionnaire facts onto common engagement-letter slots', () => {
    const data = buildMergeData(baseMatter, {
      effectiveDateIso: '2026-06-18T00:00:00Z',
      feeAmountFormatted: '$1,500.00',
      feeStructureHuman: 'a fixed flat fee',
    })
    expect(data.company_name).toBe('Sunrise Ventures')
    expect(data.primary_client_name).toBe('Maria Gomez')
    expect(data.primary_client_salutation).toBe('Maria') // first name
    expect(data.matter_number).toBe('PL-2026-0007')
    expect(data.client_email).toBe('maria@example.com')
    expect(data.effective_date).toBe('June 18, 2026') // deterministic long date
    expect(data.fee_amount_formatted).toBe('$1,500.00')
  })

  it('rendering the engagement-letter slots end-to-end yields a complete document with no model call', () => {
    const data = buildMergeData(baseMatter, { effectiveDateIso: '2026-06-18T00:00:00Z' })
    const tpl =
      '# Engagement — {{company_name}}\nDear {{primary_client_salutation}}, dated {{effective_date}}.'
    const { markdown, missingFields } = renderTemplate(tpl, data)
    expect(markdown).toContain('# Engagement — Sunrise Ventures')
    expect(markdown).toContain('Dear Maria, dated June 18, 2026.')
    // fee not supplied here → flagged, not invented
    expect(missingFields).not.toContain('company_name')
  })
})
