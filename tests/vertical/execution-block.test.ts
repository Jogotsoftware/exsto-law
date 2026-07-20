// SIG-BLOCK-1 — the canonical signature/date execution block. Pure tests (no DB):
// the marker grammar round-trips (build → parse), the preview transform turns
// whole-line markers and legacy underscore runs into clean ruled `sig-line` markup
// while leaving inline markers and merge tokens alone, the PDF renderer draws the
// marker+underscore paths without throwing, and the drafting prompt (repo file +
// the auto-appended universal rule) instructs the model to use the markers.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildExecutionBlock,
  renderSigMarkersForPreview,
  classifyExecutionLine,
} from '../../verticals/legal/src/esign/executionBlock.js'
import { parseFields } from '../../verticals/legal/src/esign/fields.js'
import { renderDraftPdf } from '../../verticals/legal/src/render/draftPdf.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')

describe('buildExecutionBlock', () => {
  it('emits the canonical block with a literal printed name', () => {
    expect(buildExecutionBlock([{ key: 'client', name: 'Alice Chen' }])).toBe(
      '**Accepted and Agreed:**\n\n{{sign:client}}\n\nName: **Alice Chen**\n\n{{date:client}}',
    )
  })

  it('falls back to a {{name:key}} marker when the name is unknown', () => {
    const md = buildExecutionBlock([{ key: 'client' }])
    expect(md).toContain('{{sign:client}}')
    expect(md).toContain('{{name:client}}')
    expect(md).toContain('{{date:client}}')
  })

  it('adds a Title line only when a title is provided, and honors a custom heading', () => {
    const md = buildExecutionBlock(
      [{ key: 'member1', name: 'Bob Vance', title: 'Managing Member' }],
      {
        heading: 'IN WITNESS WHEREOF',
      },
    )
    expect(md).toContain('**IN WITNESS WHEREOF**')
    expect(md).toContain('Title: Managing Member')
    expect(buildExecutionBlock([{ key: 'client', name: 'Bob' }])).not.toContain('Title:')
  })
})

describe('marker grammar round-trip (build → parse)', () => {
  it('parseFields recognizes every marker the block emits (name marker present when no name)', () => {
    const fields = parseFields(buildExecutionBlock([{ key: 'client' }]))
    expect(fields.map((f) => f.type)).toEqual(['sign', 'name', 'date'])
    expect(fields.every((f) => f.signerKey === 'client')).toBe(true)
  })

  it('a literal printed name leaves only the sign + date markers to anchor', () => {
    const fields = parseFields(buildExecutionBlock([{ key: 'client', name: 'Alice Chen' }]))
    expect(fields.map((f) => f.type)).toEqual(['sign', 'date'])
  })

  it('multi-signer blocks anchor each signer key independently', () => {
    const md = buildExecutionBlock([{ key: 'member1' }, { key: 'member2' }])
    const keys = new Set(parseFields(md).map((f) => f.signerKey))
    expect([...keys].sort()).toEqual(['member1', 'member2'])
  })
})

describe('classifyExecutionLine', () => {
  it('classifies a bare marker line by its type label', () => {
    expect(classifyExecutionLine('{{sign:client}}')).toEqual({ label: 'Signature' })
    expect(classifyExecutionLine('{{date:client}}')).toEqual({ label: 'Date' })
  })

  it('uses a leading "Label:" prefix when present (legacy + marker)', () => {
    expect(classifyExecutionLine('Signature: {{sign:client}}')).toEqual({ label: 'Signature' })
    expect(classifyExecutionLine('Date: ______________________________')).toEqual({ label: 'Date' })
  })

  it('treats a bare underscore run (6+) as an unlabeled rule', () => {
    expect(classifyExecutionLine('______________________________')).toEqual({ label: '' })
  })

  it('ignores prose, short underscore runs, and inline markers', () => {
    expect(classifyExecutionLine('This engagement is governed by NC law.')).toBeNull()
    expect(classifyExecutionLine('a___b')).toBeNull()
    expect(classifyExecutionLine('please sign {{sign:client}} below')).toBeNull()
    expect(classifyExecutionLine('Name: **{{primary_client_name}}**')).toBeNull()
  })
})

describe('renderSigMarkersForPreview', () => {
  it('turns a whole-line signature marker into ruled sig-line markup', () => {
    const out = renderSigMarkersForPreview('{{sign:client}}')
    expect(out).toContain(
      '<div class="sig-line"><span class="sig-line-label">Signature</span></div>',
    )
  })

  it('turns a whole-line date marker into a Date rule', () => {
    expect(renderSigMarkersForPreview('{{date:client}}')).toContain(
      '<span class="sig-line-label">Date</span>',
    )
  })

  it('converts legacy underscore runs (labeled and bare) to rules', () => {
    expect(renderSigMarkersForPreview('Signature: ______________________________')).toContain(
      '<span class="sig-line-label">Signature</span>',
    )
    expect(renderSigMarkersForPreview('______________________________')).toContain(
      'class="sig-line"',
    )
  })

  it('leaves an inline marker and plain merge tokens untouched', () => {
    const src = 'Dear {{client_name}}, please sign {{sign:client}} below.'
    expect(renderSigMarkersForPreview(src)).toBe(src)
    const nameLine = 'Name: **{{primary_client_name}}**'
    expect(renderSigMarkersForPreview(nameLine)).toBe(nameLine)
  })

  it('is a referential no-op when the document has no execution lines', () => {
    const src = '# Title\n\nSome body text.'
    expect(renderSigMarkersForPreview(src)).toBe(src)
  })

  it('isolates each rule so surrounding markdown still renders (blank-line separation)', () => {
    const out = renderSigMarkersForPreview('{{sign:client}}\nName: **Alice**\n{{date:client}}')
    // The middle line survives as its own block, flanked by blank lines.
    expect(out).toMatch(/sig-line">.*Signature.*<\/div>\n\nName: \*\*Alice\*\*\n\n<div/s)
  })
})

describe('renderDraftPdf — execution block + legacy underscores', () => {
  it(
    'renders markers and underscore runs to a non-empty PDF without throwing',
    { timeout: 30_000 },
    async () => {
      const md = [
        '# Engagement Letter',
        '',
        '**Accepted and Agreed:**',
        '',
        '{{sign:client}}',
        '',
        'Name: **Alice Chen**',
        '',
        '{{date:client}}',
        '',
        'Legacy block:',
        '',
        'Signature: ______________________________',
        'Name: **Bob Vance**',
        'Date: ______________________________',
      ].join('\n')
      const buf = await renderDraftPdf(md, { title: 'Engagement Letter' })
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect(buf.length).toBeGreaterThan(0)
    },
  )
})

describe('drafting prompt carries the execution-block rule', () => {
  it('the repo fallback prompt instructs the canonical markers', () => {
    const prompt = readFileSync(
      join(REPO_ROOT, 'verticals/legal/templates/drafting-prompt.md'),
      'utf8',
    )
    expect(prompt).toMatch(/#\s*Execution block/i)
    expect(prompt).toContain('{{sign:client}}')
    expect(prompt).toContain('{{date:client}}')
  })

  it(
    'validateDraftingPrompt auto-appends the rule so configured prompts get it too',
    { timeout: 90_000 },
    async () => {
      const { validateDraftingPrompt, hasExecutionBlockRule, DRAFTING_EXECUTION_BLOCK_RULE } =
        await import('@exsto/legal')
      const bare = [
        'Draft the document.',
        '{{questionnaire_responses_json}}',
        '{{transcript_text}}',
        '{{operating_agreement_template}}',
      ].join('\n')
      expect(hasExecutionBlockRule(bare)).toBe(false)
      const out = validateDraftingPrompt(bare)
      expect(out).toContain('{{sign:')
      expect(hasExecutionBlockRule(out)).toBe(true)
      expect(DRAFTING_EXECUTION_BLOCK_RULE).toContain('{{sign:client}}')
      // Idempotent: a prompt that already carries the rule is not double-appended.
      expect(validateDraftingPrompt(out)).toBe(out)
    },
  )
})
