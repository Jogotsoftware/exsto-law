// PR3 receipt: the authored 5-step SMLLC workflow is valid on main's lifecycle
// foundation (validateLifecycle), every step action is in the catalog (guardrail),
// and the gates/triggers match the founder's spec. Pure — no DB.
// Run: pnpm exec tsx verticals/legal/demo/verify-authored-workflow.ts
import {
  validateLifecycle,
  allowedTransitions,
  hasAutomaticTransition,
  entryStage,
} from '../src/lifecycle/resolve.js'
import { NC_SMLLC_AUTHORED } from '../src/lifecycle/authored.js'
import { STEP_ACTION_KINDS } from '../src/lifecycle/catalog.js'

let failed = false
function check(name: string, cond: boolean) {
  if (!cond) failed = true
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`)
}

const lc = NC_SMLLC_AUTHORED

const v = validateLifecycle(lc)
check("authored SMLLC passes main's validateLifecycle", v.ok)
if (!v.ok) console.log('  errors:', v.errors)

check(
  'keys ARE the matter_status vocabulary',
  JSON.stringify(lc.map((s) => s.key)) ===
    JSON.stringify(['intake_submitted', 'consultation_booked', 'in_review', 'approved', 'closed']),
)
check(
  'every stage action is in the catalog (guardrail)',
  lc.every((s) => !s.action || STEP_ACTION_KINDS.includes(s.action.kind)),
)
check('entry is intake_submitted', entryStage(lc)?.key === 'intake_submitted')
check(
  'consultation_booked is informational (blocking:false)',
  lc.find((s) => s.key === 'consultation_booked')?.blocking === false,
)
check(
  'in_review carries the Operating Agreement document',
  (lc.find((s) => s.key === 'in_review')?.documents ?? []).some(
    (d) => d.docKind === 'operating_agreement',
  ),
)
check(
  'in_review → approved is attorney via draft.approve',
  allowedTransitions(lc, 'in_review', ['attorney']).some(
    (e) => e.to === 'approved' && e.via === 'draft.approve',
  ),
)
check(
  'approved → closed is system on invoice.paid',
  allowedTransitions(lc, 'approved', ['system']).some(
    (e) => e.to === 'closed' && e.on === 'invoice.paid',
  ),
)
check(
  'no automatic edges — every step is gated by a person/event',
  !lc.some((s) => hasAutomaticTransition(lc, s.key)),
)

console.log(
  failed ? '\nFAIL' : "\nPASS — authored SMLLC workflow valid on main's lifecycle foundation",
)
if (failed) process.exit(1)
