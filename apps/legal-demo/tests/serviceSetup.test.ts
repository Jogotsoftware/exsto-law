import { describe, it, expect } from 'vitest'
import { buildSetupSteps, activeStepIndex } from '../lib/serviceSetup'

const KEY = 'nc_single_member_llc_formation'
const base = `/attorney/services/${KEY}`

describe('buildSetupSteps', () => {
  it('manual + template_merge: Templates is optional, no Prompt step', () => {
    const steps = buildSetupSteps(KEY, 'template_merge', 'manual', [
      'needs a questionnaire (at least one section with one field)',
    ])
    expect(steps.map((s) => s.key)).toEqual(['details', 'questionnaire', 'templates', 'billing'])
    expect(steps.find((s) => s.key === 'questionnaire')!.done).toBe(false)
    expect(steps.find((s) => s.key === 'templates')!.optional).toBe(true)
    expect(steps.find((s) => s.key === 'templates')!.done).toBe(true) // optional for manual
    expect(steps.find((s) => s.key === 'billing')!.optional).toBe(true)
  })

  it('auto + ai_draft: adds Prompt; Templates required and marked from completeness', () => {
    const steps = buildSetupSteps(KEY, 'ai_draft', 'auto', [
      'needs a drafting prompt for "operating_agreement"',
      'needs a document template for "operating_agreement"',
    ])
    expect(steps.map((s) => s.key)).toEqual([
      'details',
      'questionnaire',
      'templates',
      'prompt',
      'billing',
    ])
    expect(steps.find((s) => s.key === 'questionnaire')!.done).toBe(true) // not in missing
    expect(steps.find((s) => s.key === 'templates')!.done).toBe(false)
    expect(steps.find((s) => s.key === 'prompt')!.done).toBe(false)
  })

  it('a complete service shows every required step done', () => {
    const steps = buildSetupSteps(KEY, 'template_merge', 'manual', [])
    expect(steps.every((s) => s.done)).toBe(true)
  })
})

describe('activeStepIndex (longest-prefix match)', () => {
  const steps = buildSetupSteps(KEY, 'ai_draft', 'auto', [])
  it('Details base path does not bleed into a sub-tab', () => {
    expect(activeStepIndex(steps, base)).toBe(0)
  })
  it('sub-tab wins over the Details base prefix', () => {
    expect(activeStepIndex(steps, `${base}/templates`)).toBe(2)
    expect(activeStepIndex(steps, `${base}/prompt`)).toBe(3)
    expect(activeStepIndex(steps, `${base}/billing`)).toBe(4)
  })
  it('unknown path falls back to the first step', () => {
    expect(activeStepIndex(steps, '/attorney/elsewhere')).toBe(0)
  })
})
