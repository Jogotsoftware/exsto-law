// Guard for the "needs a drafting prompt twice" bug: a phantom
// "<kind>_drafting_prompt" doc kind (the build wizard's documented anti-pattern)
// must never appear as a real document — it would demand its own drafting prompt
// and block the service from enabling. Pure + DB-free.
import { describe, it, expect } from 'vitest'
import {
  isPromptArtifactDocKind,
  realDocumentKinds,
  completenessFromTransitions,
} from '@exsto/legal'

describe('prompt-artifact doc kinds', () => {
  it('detects "<kind>_drafting_prompt" artifacts and keeps real kinds', () => {
    expect(isPromptArtifactDocKind('mutual_nda_drafting_prompt')).toBe(true)
    expect(isPromptArtifactDocKind('operating_agreement_drafting_prompt')).toBe(true)
    expect(isPromptArtifactDocKind('mutual_nda')).toBe(false)
    expect(isPromptArtifactDocKind('engagement_letter')).toBe(false)
    expect(realDocumentKinds(['mutual_nda', 'mutual_nda_drafting_prompt'])).toEqual(['mutual_nda'])
    expect(realDocumentKinds(['x', null, 7, 'y_drafting_prompt'])).toEqual(['x'])
  })

  it('completeness never lists requirements for a phantom doc kind', () => {
    const res = completenessFromTransitions('nc_mutual_nda', {
      route: 'auto',
      documents: ['mutual_nda', 'mutual_nda_drafting_prompt'],
      // (intake/prompt left unconfigured — the real kind's own requirements may
      // still appear; the regression is that the PHANTOM kind never does.)
    } as Parameters<typeof completenessFromTransitions>[1])

    expect(res.missing.some((m) => m.includes('mutual_nda_drafting_prompt'))).toBe(false)
    // At most one "needs a drafting prompt" line (the real kind), never two.
    expect(
      res.missing.filter((m) => m.startsWith('needs a drafting prompt')).length,
    ).toBeLessThanOrEqual(1)
  })
})
