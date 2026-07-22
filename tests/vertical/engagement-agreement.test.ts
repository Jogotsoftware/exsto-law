// ENGAGEMENT-DOC-1 — the pure seams of the engagement-agreement pipeline:
// the AI-output parser (body vs ===DETAILS=== JSON tail) and the merge-render
// contract the portal gate relies on (sign markers survive, slots fill).
import { describe, expect, it } from 'vitest'
import { parseImportOutput } from '../../verticals/legal/src/api/engagementImportParse.js'
import { renderTemplate } from '../../verticals/legal/src/api/templateMerge.js'
import { substituteClientSignature } from '../../verticals/legal/src/api/engagementExecutedCopy.js'

describe('parseImportOutput', () => {
  it('splits body from the details JSON tail', () => {
    const raw = [
      '# Engagement Letter',
      'Dear {{company_name}}:',
      'By: {{sign:client}}',
      '===DETAILS===',
      '{"hourly_rate":"350.00","litigation_rate":"450.00","retainer":"3500.00","signer_label":"Managing Member"}',
    ].join('\n')
    const { body, details } = parseImportOutput(raw)
    expect(body).toContain('{{company_name}}')
    expect(body).toContain('{{sign:client}}')
    expect(body).not.toContain('===DETAILS===')
    expect(details.hourly_rate).toBe('350.00')
    expect(details.retainer).toBe('3500.00')
    expect(details.signer_label).toBe('Managing Member')
  })

  it('tolerates a missing details tail (whole output = body)', () => {
    const { body, details } = parseImportOutput('Just the letter body.')
    expect(body).toBe('Just the letter body.')
    expect(details).toEqual({})
  })

  it('tolerates malformed JSON without failing the import', () => {
    const { body, details } = parseImportOutput('Letter.\n===DETAILS===\nnot-json')
    expect(body).toBe('Letter.')
    expect(details).toEqual({})
  })

  it('throws on an empty body', () => {
    expect(() => parseImportOutput('===DETAILS===\n{}')).toThrow(/empty template body/)
  })
})

describe('gate merge contract', () => {
  it('fills client slots and leaves {{sign:client}}/{{date:client}} markers intact', () => {
    const body =
      'Dear {{company_name}} ({{client_name}}):\nBy: {{sign:client}}\nDated: {{date:client}}'
    const r = renderTemplate(body, { company_name: 'Mi Rey LLC', client_name: 'Gabriel Fuentes' })
    expect(r.markdown).toContain('Mi Rey LLC')
    expect(r.markdown).toContain('Gabriel Fuentes')
    // Colon-bearing esign markers are NOT merge slots (SLOT_RE has no colon) —
    // the portal gate swaps them for the live signature UI.
    expect(r.markdown).toContain('{{sign:client}}')
    expect(r.markdown).toContain('{{date:client}}')
    expect(r.missingFields).toEqual([])
  })
})

describe('substituteClientSignature (executed copy)', () => {
  const md = [
    'Accepted and Agreed:',
    '',
    'By: {{sign:client}}',
    '{{client_name}}',
    'Managing Member',
    'Dated: {{date:client}}',
  ].join('\n')

  it('writes /s/ name and the date in-flow, leaving no markers', () => {
    const out = substituteClientSignature(md, 'Gabriel Fuentes', '2026-07-22T00:00:00.000Z')
    expect(out).toContain('By: /s/ Gabriel Fuentes')
    expect(out).toContain('Dated: July 22, 2026')
    expect(out).not.toMatch(/\{\{\s*(?:sign|date)\s*:\s*client\s*\}\}/i)
    // The client_name merge token is NOT this function's job — left for the merge.
    expect(out).toContain('{{client_name}}')
  })

  it('only touches the client signer key, never the firm/attorney block', () => {
    const withFirm = 'By: {{sign:attorney}}\nJuan Carlos Pacheco\n\nBy: {{sign:client}}'
    const out = substituteClientSignature(withFirm, 'Gabriel Fuentes', '2026-07-22T00:00:00.000Z')
    expect(out).toContain('{{sign:attorney}}')
    expect(out).toContain('/s/ Gabriel Fuentes')
  })
})
