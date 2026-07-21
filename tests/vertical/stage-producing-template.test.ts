// WF-FIX-2 #4 + #5 — the producing-stage predicate and the pinned-template seam.
// PURE (no DB): stageProducesDocument decides whether regenerate/settle treats a
// stage as document-producing; resolveStageTemplateRef decides whether a draft
// draws from a PINNED template entity (→ templateOverride, superseding the repo
// lookup) or falls back to the (serviceKey, docKind) repo/convention template.
// "Pinned entity beats repo template" IS resolveStageTemplateRef returning the
// entity id instead of null — the exact seam the manual draft path (#5) and
// regenerate (#4) now resolve before calling runDraftGeneration.
import { describe, it, expect } from 'vitest'
import { stageProducesDocument } from '../../verticals/legal/src/lifecycle/resolve.js'
import { resolveStageTemplateRef } from '../../verticals/legal/src/api/generateDocumentRuntime.js'
import type { LifecycleStage } from '../../verticals/legal/src/lifecycle/types.js'

const stage = (over: Partial<LifecycleStage>): LifecycleStage => ({
  key: 'k',
  label: 'L',
  advances_to: [],
  ...over,
})

describe('stageProducesDocument (pure) — WF-FIX-2 #4', () => {
  it('a generate_document stage produces a document', () => {
    expect(stageProducesDocument(stage({ action: { kind: 'generate_document' } }))).toBe(true)
  })

  it('an invoke_capability{document_generation} stage produces a document', () => {
    expect(
      stageProducesDocument(
        stage({
          action: { kind: 'invoke_capability', config: { capability_slug: 'document_generation' } },
        }),
      ),
    ).toBe(true)
  })

  it('an invoke_capability of a NON-document capability does not', () => {
    expect(
      stageProducesDocument(
        stage({
          action: { kind: 'invoke_capability', config: { capability_slug: 'ai_document_review' } },
        }),
      ),
    ).toBe(false)
  })

  it('a review_send_document stage that CARRIES a document ref produces one', () => {
    expect(
      stageProducesDocument(
        stage({
          action: { kind: 'review_send_document' },
          documents: [{ templateEntityId: 'tpl-1' }],
        }),
      ),
    ).toBe(true)
    expect(
      stageProducesDocument(
        stage({
          action: { kind: 'review_send_document' },
          documents: [{ docKind: 'operating_agreement' }],
        }),
      ),
    ).toBe(true)
  })

  it('a BARE review_send_document (no resolvable document ref) does not produce', () => {
    expect(stageProducesDocument(stage({ action: { kind: 'review_send_document' } }))).toBe(false)
    expect(
      stageProducesDocument(stage({ action: { kind: 'review_send_document' }, documents: [{}] })),
    ).toBe(false)
  })

  it('a non-producing kind does not produce', () => {
    expect(stageProducesDocument(stage({ action: { kind: 'view_intake' } }))).toBe(false)
    expect(stageProducesDocument(stage({ action: { kind: 'manual_task' } }))).toBe(false)
    expect(stageProducesDocument(stage({}))).toBe(false)
  })
})

describe('resolveStageTemplateRef — pinned entity beats repo template — WF-FIX-2 #5', () => {
  it('returns the PINNED template entity id from a stage document ref (trimmed)', () => {
    expect(
      resolveStageTemplateRef(
        stage({
          action: { kind: 'generate_document' },
          documents: [{ templateEntityId: ' tpl-abc ' }],
        }),
      ),
    ).toBe('tpl-abc')
    expect(
      resolveStageTemplateRef(
        stage({
          action: { kind: 'review_send_document' },
          documents: [{ templateEntityId: 'tpl-rev' }],
        }),
      ),
    ).toBe('tpl-rev')
  })

  it('returns the PINNED template entity id from an invoke_capability config', () => {
    expect(
      resolveStageTemplateRef(
        stage({
          action: {
            kind: 'invoke_capability',
            config: {
              capability_slug: 'document_generation',
              capability_config: { template_entity_id: 'tpl-cap' },
            },
          },
        }),
      ),
    ).toBe('tpl-cap')
  })

  it('returns null when the stage pins NO template — the draft falls back to the repo template', () => {
    // generate_document with no document ref → repo/convention lookup (last resort).
    expect(resolveStageTemplateRef(stage({ action: { kind: 'generate_document' } }))).toBeNull()
    // a doc ref that names only a kind (no entity) is NOT a pinned entity.
    expect(
      resolveStageTemplateRef(
        stage({ action: { kind: 'review_send_document' }, documents: [{ docKind: 'nda' }] }),
      ),
    ).toBeNull()
    expect(resolveStageTemplateRef(stage({}))).toBeNull()
  })
})
