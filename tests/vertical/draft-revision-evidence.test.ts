// WP B4 (context spine) — the draft_revision evidence scope + the audience
// dimension. buildDraftRevisionEvidence is PURE (fake the material the readers
// return — no DB, no module mocking, mirrors brief-evidence.test.ts): this file
// pins its deterministic section order, per-section budget clipping with an
// honest `truncated` flag, the watermark, and "empty source ⇒ omitted." The
// audience block pins renderEvidenceBundle's per-source allowlist. The grep gate
// asserts no client-portal surface can ever render the internal bundle.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDraftRevisionEvidence,
  renderEvidenceBundle,
  type BriefScope,
  type EvidenceBundle,
} from '@exsto/legal'
import type { MatterDetail } from '@exsto/legal'
import type { ServiceDraftNote, ServiceRevisionRequest } from '@exsto/legal'

const ASSEMBLED_AT = '2026-07-20T12:00:00.000Z'

const SCOPE: Extract<BriefScope, { kind: 'draft_revision' }> = {
  kind: 'draft_revision',
  documentVersionId: 'ver-9',
}

function baseMatter(overrides: Partial<MatterDetail> = {}): MatterDetail {
  return {
    matterEntityId: 'matter-1',
    matterNumber: '2026-042',
    clientName: 'Acme LLC',
    serviceKey: 'nc_llc_single_member',
    workflowRoute: 'manual',
    status: 'in_review',
    scheduledAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    practiceArea: 'nc_llc_single_member',
    summary: '',
    attributes: {},
    questionnaireResponses: null,
    transcriptText: null,
    latestDraftVersionId: null,
    latestDraftStatus: null,
    clientEmail: 'client@acme.test',
    clientEntityId: 'client-1',
    workflow: null,
    workflowRepairAvailable: false,
    ...overrides,
  }
}

function draftNote(overrides: Partial<ServiceDraftNote> = {}): ServiceDraftNote {
  return {
    matterEntityId: 'matter-1',
    matterNumber: '2026-042',
    documentKind: 'operating_agreement',
    documentVersionId: 'ver-1',
    versionNumber: 1,
    note: 'Tightened the indemnification clause.',
    recordedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  }
}

function revisionRequest(overrides: Partial<ServiceRevisionRequest> = {}): ServiceRevisionRequest {
  return {
    matterEntityId: 'matter-1',
    matterNumber: '2026-042',
    documentKind: 'operating_agreement',
    documentVersionId: 'ver-9',
    notes: 'Please add a buy-sell provision.',
    recordedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

type Material = Parameters<typeof buildDraftRevisionEvidence>[0]

function baseMaterial(overrides: Partial<Material> = {}): Material {
  return {
    matter: baseMatter(),
    versionNotes: [],
    revisionRequests: [],
    ...overrides,
  }
}

function build(
  material: Material,
  budget: 'lean' | 'balanced' | 'generous' = 'lean',
): EvidenceBundle {
  return buildDraftRevisionEvidence(material, SCOPE, budget, ASSEMBLED_AT)
}

const sources = (b: EvidenceBundle): string[] => b.sections.map((s) => s.source)

describe('buildDraftRevisionEvidence — section order', () => {
  it('emits matter_core → intake_facts → document_edit_history → document_revision_requests', () => {
    const bundle = build(
      baseMaterial({
        matter: baseMatter({
          questionnaireResponses: { member_count: '1', purpose: 'consulting' },
        }),
        versionNotes: [draftNote()],
        revisionRequests: [revisionRequest()],
      }),
    )
    expect(sources(bundle)).toEqual([
      'matter_core',
      'intake_facts',
      'document_edit_history',
      'document_revision_requests',
    ])
  })

  it('always emits matter_core even when everything else is empty', () => {
    const bundle = build(baseMaterial())
    expect(sources(bundle)).toEqual(['matter_core'])
    expect(bundle.sections[0].content).toContain('2026-042')
  })

  it('omits intake_facts when there are no questionnaire responses (empty source, not empty string)', () => {
    const bundle = build(baseMaterial({ versionNotes: [draftNote()] }))
    expect(sources(bundle)).toEqual(['matter_core', 'document_edit_history'])
    expect(bundle.sections.every((s) => s.content.length > 0)).toBe(true)
  })
})

describe('buildDraftRevisionEvidence — edit history framing', () => {
  it('strips the "AI revision: " prefix so each line reads as the change made', () => {
    const bundle = build(
      baseMaterial({
        versionNotes: [
          draftNote({ versionNumber: 2, note: 'AI revision: Made the tone firmer.' }),
          draftNote({ versionNumber: 1, note: 'Fixed a typo in section 3.' }),
        ],
      }),
    )
    const hist = bundle.sections.find((s) => s.source === 'document_edit_history')!
    expect(hist.content).toContain('- v2: Made the tone firmer.')
    expect(hist.content).toContain('- v1: Fixed a typo in section 3.')
    expect(hist.content).not.toContain('AI revision:')
  })
})

describe('buildDraftRevisionEvidence — budget + truncation', () => {
  it('caps edit-history items at the lean digest budget and flags truncation', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      draftNote({ versionNumber: i + 1, note: `Change ${i + 1}` }),
    )
    const bundle = build(baseMaterial({ versionNotes: many }))
    const hist = bundle.sections.find((s) => s.source === 'document_edit_history')!
    // lean digestItems = 10
    expect(hist.content.split('\n').length).toBe(10)
    expect(hist.truncated).toBe(true)
  })

  it('clips a very long intake block and flags truncation', () => {
    const bundle = build(
      baseMaterial({
        matter: baseMatter({ questionnaireResponses: { essay: 'x'.repeat(50_000) } }),
      }),
    )
    const intake = bundle.sections.find((s) => s.source === 'intake_facts')!
    expect(intake.truncated).toBe(true)
    expect(intake.content).toContain('…[truncated]')
  })

  it('a generous budget admits more edit-history items than lean', () => {
    const many = Array.from({ length: 40 }, (_, i) => draftNote({ versionNumber: i + 1 }))
    const lean = build(baseMaterial({ versionNotes: many }), 'lean')
    const gen = build(baseMaterial({ versionNotes: many }), 'generous')
    const leanLines = lean.sections
      .find((s) => s.source === 'document_edit_history')!
      .content.split('\n')
    const genLines = gen.sections
      .find((s) => s.source === 'document_edit_history')!
      .content.split('\n')
    expect(genLines.length).toBeGreaterThan(leanLines.length)
  })
})

describe('buildDraftRevisionEvidence — watermark', () => {
  it('is the max recorded_at across notes + requests', () => {
    const bundle = build(
      baseMaterial({
        versionNotes: [draftNote({ recordedAt: '2026-02-01T00:00:00Z' })],
        revisionRequests: [revisionRequest({ recordedAt: '2026-05-15T00:00:00Z' })],
      }),
    )
    expect(bundle.sourceWatermark).toBe('2026-05-15T00:00:00Z')
  })

  it('falls back to assembledAt when no source carries a timestamp', () => {
    const bundle = build(baseMaterial())
    expect(bundle.sourceWatermark).toBe(ASSEMBLED_AT)
  })
})

describe('renderEvidenceBundle — audience dimension', () => {
  const bundle: EvidenceBundle = {
    sections: [
      { source: 'matter_core', label: 'Matter core', content: 'core', truncated: false },
      { source: 'intake_facts', label: 'Intake facts', content: 'intake', truncated: false },
      {
        source: 'communications',
        label: 'Client communications',
        content: 'emails',
        truncated: false,
      },
      { source: 'portal_thread', label: 'Portal thread', content: 'portal', truncated: false },
      { source: 'documents', label: 'Drafted documents', content: 'docs', truncated: false },
    ],
    sourceWatermark: ASSEMBLED_AT,
    assembledAt: ASSEMBLED_AT,
    scope: SCOPE,
    budget: 'lean',
  }

  it('attorney_full (default) renders every source', () => {
    const out = renderEvidenceBundle(bundle)
    for (const s of [
      'matter_core',
      'intake_facts',
      'communications',
      'portal_thread',
      'documents',
    ]) {
      expect(out).toContain(`[source: ${s}]`)
    }
    expect(renderEvidenceBundle(bundle, { audience: 'attorney_full' })).toBe(out)
  })

  it('research_framing renders only neutral matter/service facts', () => {
    const out = renderEvidenceBundle(bundle, { audience: 'research_framing' })
    expect(out).toContain('[source: matter_core]')
    expect(out).toContain('[source: documents]')
    expect(out).not.toContain('[source: intake_facts]')
    expect(out).not.toContain('[source: communications]')
    expect(out).not.toContain('[source: portal_thread]')
  })

  it('portal_tool_backed renders only what a client may already see', () => {
    const out = renderEvidenceBundle(bundle, { audience: 'portal_tool_backed' })
    expect(out).toContain('[source: matter_core]')
    expect(out).toContain('[source: portal_thread]')
    expect(out).toContain('[source: documents]')
    expect(out).not.toContain('[source: communications]')
    expect(out).not.toContain('[source: intake_facts]')
  })
})

// ── Portal grep gate ─────────────────────────────────────────────────────────
// renderEvidenceBundle is a SERVER-SIDE attorney-context renderer. No client-
// portal surface may import it (that would risk leaking the internal evidence
// bundle to a client), so the audience filter's fail-closed intent is enforced
// structurally: portal code must not reference the renderer at all.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

const PORTAL_DIRS = ['apps/legal-demo/app/portal', 'apps/legal-demo/app/api/client/portal'].map(
  (p) => join(REPO_ROOT, p),
)

const VERTICAL_API = join(REPO_ROOT, 'verticals/legal/src/api')
const PORTAL_FILE = /^(portal|publicBooking|clientMessaging)/

function listSourceFiles(dir: string, filter?: RegExp): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full, filter))
    else if (/\.(ts|tsx)$/.test(entry) && (!filter || filter.test(entry))) out.push(full)
  }
  return out
}

const PORTAL_FILES = [
  ...PORTAL_DIRS.flatMap((d) => listSourceFiles(d)),
  ...listSourceFiles(VERTICAL_API, PORTAL_FILE),
]

describe('grep gate — no client-portal surface renders the evidence bundle', () => {
  it('finds at least one portal file to scan (the gate is not vacuously empty)', () => {
    expect(PORTAL_FILES.length).toBeGreaterThan(0)
  })

  it('no portal file references renderEvidenceBundle', () => {
    const offenders = PORTAL_FILES.filter((f) =>
      /renderEvidenceBundle/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('sanity: an attorney consumer DOES import it (the identifier is real)', () => {
    const revise = readFileSync(join(VERTICAL_API, 'reviseDraft.ts'), 'utf8')
    expect(/renderEvidenceBundle/.test(revise)).toBe(true)
  })
})
