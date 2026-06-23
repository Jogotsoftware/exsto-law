// ADR 0045 PR3 — PURE unit tests (no DB, always run) for the AUTHORED workflow
// model. This formalizes verticals/legal/demo/verify-authored-workflow.ts as a real
// test: the founder's 5-step NC Single-Member LLC workflow is structurally valid on
// the lifecycle foundation, every step action is in the closed catalog (the builder/AI
// guardrail), and walking the graph from the entry stage by its first edges reaches
// the terminal `closed`. Pure — no DB, mirrors lifecycle-resolve / lifecycle-equality.
import { describe, it, expect } from 'vitest'
import {
  NC_SMLLC_AUTHORED,
  STEP_ACTION_KINDS,
  validateLifecycle,
  entryStage,
  edgesFrom,
  stageByKey,
} from '@exsto/legal'

describe('authored NC SMLLC workflow — structural validity', () => {
  it('NC_SMLLC_AUTHORED passes validateLifecycle (ok === true)', () => {
    const res = validateLifecycle(NC_SMLLC_AUTHORED)
    expect(res.errors).toEqual([])
    expect(res.ok).toBe(true)
  })

  it('the stage keys ARE the matter_status vocabulary, in order', () => {
    expect(NC_SMLLC_AUTHORED.map((s) => s.key)).toEqual([
      'intake_submitted',
      'consultation_booked',
      'in_review',
      'approved',
      'closed',
    ])
  })
})

describe('authored NC SMLLC workflow — catalog guardrail', () => {
  it("every authored stage's action.kind is in STEP_ACTION_KINDS", () => {
    for (const s of NC_SMLLC_AUTHORED) {
      // Every authored stage carries an action; if one ever omits it, that is fine —
      // the guardrail only constrains stages that DO name an action kind.
      if (s.action) {
        expect(STEP_ACTION_KINDS).toContain(s.action.kind)
      }
    }
  })

  it('the consultation step is informational (blocking:false) and never holds the matter', () => {
    expect(stageByKey(NC_SMLLC_AUTHORED, 'consultation_booked')?.blocking).toBe(false)
  })
})

describe('authored NC SMLLC workflow — graph walk to terminal', () => {
  it('walking from entry by first edges reaches the terminal `closed` in 5 steps', () => {
    const entry = entryStage(NC_SMLLC_AUTHORED)
    expect(entry?.key).toBe('intake_submitted')

    // Follow the FIRST outgoing edge of each stage, collecting the stages visited.
    // Cap the walk so a malformed cycle can never hang the test.
    const visited: string[] = []
    let cursor = entry?.key ?? null
    for (let i = 0; cursor && i < 16; i++) {
      visited.push(cursor)
      const stage = stageByKey(NC_SMLLC_AUTHORED, cursor)
      if (stage?.terminal) break
      cursor = edgesFrom(NC_SMLLC_AUTHORED, cursor)[0]?.to ?? null
    }

    expect(visited).toEqual([
      'intake_submitted',
      'consultation_booked',
      'in_review',
      'approved',
      'closed',
    ])
    expect(visited).toHaveLength(5)
    expect(visited[visited.length - 1]).toBe('closed')
    expect(stageByKey(NC_SMLLC_AUTHORED, 'closed')?.terminal).toBe(true)
  })
})

// NOTE on legacyStatusToStageKey: the task spec asked, IF present on this branch's
// resolver, to also assert the legacy-status → stage-key projection
// ('inquiry'→'intake_submitted', 'consulted'→'consultation_booked',
// 'in_review'→'in_review', unknown→entry key). That helper is a later-PR addition and
// is NOT exported by @exsto/legal on feat/workflow-engine-pr3, so per the spec the
// projection assertion is SKIPPED here and only the catalog + validateLifecycle +
// graph-walk parts are tested.
