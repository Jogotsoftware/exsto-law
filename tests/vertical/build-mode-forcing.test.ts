// WP5.3 — an EXPLICIT build session (the Build button → input.buildMode) must
// force-load the firm-admin.build-service playbook no matter how the message is
// phrased; the BUILD_REQUEST_RE regex is only the fallback for free-typed build
// requests. Dormancy still wins: with the wizard flag DISABLED nothing is forced
// (WP-L D8 flipped the default ON, so "off" is now the explicit 0/false opt-out).
import { describe, it, expect, afterEach } from 'vitest'
import { wizardForcedSkillSlugs } from '@exsto/legal'

const PLAYBOOK = 'firm-admin.build-service'

describe('wizardForcedSkillSlugs (WP5.3)', () => {
  afterEach(() => {
    delete process.env.LEGAL_BUILD_WIZARD
  })

  it('flag disabled: forces nothing, even in an explicit build session', () => {
    process.env.LEGAL_BUILD_WIZARD = '0'
    expect(wizardForcedSkillSlugs('build me a service', [], true)).toEqual([])
  })

  it('flag unset: default is ON (D8) — buildMode forces the playbook', () => {
    expect(wizardForcedSkillSlugs('build me a service', [], true)).toEqual([PLAYBOOK])
  })

  it('flag on + buildMode: forces the playbook regardless of phrasing', () => {
    process.env.LEGAL_BUILD_WIZARD = '1'
    expect(wizardForcedSkillSlugs('yes', [], true)).toEqual([PLAYBOOK])
    expect(wizardForcedSkillSlugs('"kickoff": the client books it', [], true)).toEqual([PLAYBOOK])
  })

  it('flag on, no buildMode: the regex fallback still catches a typed build request', () => {
    process.env.LEGAL_BUILD_WIZARD = '1'
    expect(wizardForcedSkillSlugs('please build me a new service', [])).toEqual([PLAYBOOK])
    expect(wizardForcedSkillSlugs('what does the review queue do?', [])).toEqual([])
  })

  it('never duplicates an already-selected playbook', () => {
    process.env.LEGAL_BUILD_WIZARD = '1'
    expect(wizardForcedSkillSlugs('continue', [PLAYBOOK], true)).toEqual([PLAYBOOK])
  })
})
