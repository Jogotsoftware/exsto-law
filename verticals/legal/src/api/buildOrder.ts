// SB-FIX-1 (1) — THE build order, owned in exactly one place.
//
// Before this, the order a guided build follows existed in three places and two of
// them disagreed with the authoritative playbook:
//
//   • verticals/legal/skills/firm-admin/build-service.md  (authoritative)
//       shell → documents → questionnaire → billing → workflow → enable
//   • api/assistantChat.ts (the prompt pointer)            — same
//   • apps/legal-demo/components/UnifiedAssistantChat.tsx BUILD_PHASES (what the
//     ATTORNEY watches) — questionnaire/template swapped AND workflow/billing
//     swapped, so the progress strip named the wrong phase for most of every build
//     (docs/diagnostics/SB-FIX-1-REPRO.md §C1).
//
// Nothing kept them in sync because nothing was shared. This module is the shared
// thing: the client strip imports PHASES from here, the BUILD BRIEF derives the
// next step from here, and the playbook text is checked against it by a unit test.
// Adding or reordering a build phase is a one-line change here, everywhere.
//
// `artifact` is the key the approval path already uses when it marks a phase done
// (the client's approvedPhases, the brief's derivation); `label` is attorney-facing
// and carries no platform vocabulary (jargon ban).

export interface BuildPhase {
  artifact: 'service' | 'template' | 'questionnaire' | 'billing' | 'workflow' | 'enable'
  label: string
}

export const BUILD_PHASES: readonly BuildPhase[] = [
  { artifact: 'service', label: 'Define service' },
  { artifact: 'template', label: 'Document template' },
  { artifact: 'questionnaire', label: 'Client intake' },
  { artifact: 'billing', label: 'Billing' },
  { artifact: 'workflow', label: 'Workflow' },
  { artifact: 'enable', label: 'Review & publish' },
] as const

export type BuildArtifact = BuildPhase['artifact']

// The phase the build is ON, given what is approved and what is currently sitting
// unapproved in front of the attorney.
//
// Two rules, in order:
//   1. A card the attorney has NOT acted on wins. That card IS the current step —
//      whether it is the next one forward or a revision of something approved long
//      ago. This is what lets the indicator move BACKWARDS, which the old add-only
//      derivation could never do (REPRO §C2).
//   2. Otherwise it is the first phase not yet approved — the forward march.
//
// When several cards are pending, the EARLIEST in build order wins: a detour back to
// the intake is what the attorney is looking at, even if a workflow card is also open.
export function currentBuildPhase(
  approved: Iterable<string>,
  pending: Iterable<string> = [],
): BuildPhase {
  const approvedSet = new Set(approved)
  const pendingSet = new Set(pending)
  const pendingPhase = BUILD_PHASES.find((p) => pendingSet.has(p.artifact))
  if (pendingPhase) return pendingPhase
  const next = BUILD_PHASES.find((p) => !approvedSet.has(p.artifact))
  return next ?? BUILD_PHASES[BUILD_PHASES.length - 1]!
}

// 1-based position for "Step n of 6".
export function buildPhaseNumber(phase: BuildPhase): number {
  return BUILD_PHASES.findIndex((p) => p.artifact === phase.artifact) + 1
}
