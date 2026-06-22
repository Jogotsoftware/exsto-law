// Pure logic for the service setup wizard (no React/Next imports, so it's unit
// testable). The ServiceSetupGuide component renders these steps; the [serviceKey]
// layout uses buildSetupSteps to derive the "Continue →" target too — one source
// of truth for the step order and done-state.

export type GenerationMode = 'template_merge' | 'ai_draft'
export type Route = 'auto' | 'manual'

export interface SetupStep {
  key: string
  label: string
  href: string
  done: boolean
  optional?: boolean
}

// The ordered setup steps for a service. `missing` is the server completeness
// check's reasons; a step is "done" when no reason mentions it. Templates is only
// required for auto-route services (manual services draft by hand); Billing is
// always optional (a service can be free). Prompt appears only for AI drafting.
export function buildSetupSteps(
  serviceKey: string,
  generationMode: GenerationMode,
  route: Route,
  missing: string[],
): SetupStep[] {
  const base = `/attorney/services/${serviceKey}`
  const mentions = (frag: string) => missing.some((m) => m.toLowerCase().includes(frag))
  const steps: SetupStep[] = [
    { key: 'details', label: 'Details', href: base, done: true },
    {
      key: 'questionnaire',
      label: 'Questionnaire',
      href: `${base}/questionnaire`,
      done: !mentions('questionnaire'),
    },
    {
      key: 'templates',
      label: 'Templates',
      href: `${base}/templates`,
      done: route === 'auto' ? !mentions('template') : true,
      optional: route !== 'auto',
    },
  ]
  if (generationMode === 'ai_draft') {
    steps.push({
      key: 'prompt',
      label: 'Prompt',
      href: `${base}/prompt`,
      done: !mentions('prompt'),
    })
  }
  steps.push({
    key: 'billing',
    label: 'Billing',
    href: `${base}/billing`,
    done: true,
    optional: true,
  })
  return steps
}

// Index of the step matching the current path. Longest-prefix wins, since every
// sub-tab href starts with the Details base href (so on a sub-tab both the base and
// the sub match — pick the most specific).
export function activeStepIndex(steps: SetupStep[], pathname: string): number {
  const matches = steps
    .map((s, i) => ({ i, len: s.href.length }))
    .filter(({ i }) => pathname === steps[i].href || pathname.startsWith(steps[i].href + '/'))
    .sort((a, b) => b.len - a.len)
  return matches[0]?.i ?? 0
}
