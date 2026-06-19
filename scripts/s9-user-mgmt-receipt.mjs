// S9 WP9.3 — user-management live receipt (runs THROUGH the operation core).
//
//   node --env-file=.env.local scripts/s9-user-mgmt-receipt.mjs
//
// Drives the SAME legal.user.* operation-core API the MCP tools / Settings UI
// call, against the live DB, and proves the WP9.3 receipt end to end:
//   1. invite a user (legal.user.invite)        -> persists a new active actor
//   2. list users (legal.user.list)             -> the user shows with role Paralegal
//   3. the new user is ENFORCED (takes effect)   -> blocked write + restricted read
//   4. assign a new role (legal.user.assign_role)-> access changes (now admin)
//   5. deactivate (legal.user.deactivate)        -> status inactive, scopes closed
//
// Requires a working DATABASE_URL (the action layer's DB credential). Imports
// the built dist directly (relative) like the other .mjs scripts. Idempotent:
// re-inviting the same email re-activates the existing actor.
import { submitAction, executeQuery } from '../packages/substrate/dist/index.js'
import {
  inviteUser,
  listUsers,
  assignUserRole,
  deactivateUser,
} from '../verticals/legal/dist/index.js' // also registers all action handlers (side effect)

const TENANT = '00000000-0000-0000-0000-000000000001'
const OWNER = '00000000-0000-0000-0001-000000000002' // firm.admin
const ownerCtx = { tenantId: TENANT, actorId: OWNER }
const EMAIL = 'jane@pachecolaw.test'

const results = []
const record = (check, expected, observed, pass) =>
  results.push({ check, expected, observed, pass })

async function visibleFirmSettings(actorId) {
  const r = await executeQuery(
    { tenantId: TENANT, actorId },
    `SELECT count(*)::int AS n FROM entity e
       JOIN entity_kind_definition k ON k.id=e.entity_kind_id
      WHERE e.tenant_id=$1 AND k.kind_name='firm_settings'`,
    [TENANT],
  )
  return r.rows[0].n
}

async function main() {
  // 1. invite (through the core)
  await inviteUser(ownerCtx, {
    email: EMAIL,
    displayName: 'Jane Paralegal',
    roleName: 'firm.paralegal',
  })

  // 2. list — the user persists with the derived role
  const { users } = await listUsers(ownerCtx)
  const jane = users.find((u) => (u.email ?? '').toLowerCase() === EMAIL)
  record(
    'invite persists',
    'Jane active with role Paralegal',
    jane ? `${jane.status}/${jane.role}` : 'NOT FOUND',
    !!jane && jane.status === 'active' && jane.role === 'Paralegal',
  )
  if (!jane) {
    return report()
  }
  const janeCtx = { tenantId: TENANT, actorId: jane.actorId }

  // 3a. takes effect — blocked write (event.record not in firm.paralegal)
  try {
    await submitAction(janeCtx, {
      actionKindName: 'event.record',
      intentKind: 'exploration',
      payload: { event_kind_name: 'note', summary: 'blocked?' },
    })
    record('new user enforced: blocked write', 'rejected', 'WAS ALLOWED', false)
  } catch (e) {
    const blocked = /row-level security|violates|policy|42501/i.test(e.message)
    record(
      'new user enforced: blocked write',
      'rejected by RLS',
      blocked ? 'blocked' : `other: ${e.message.slice(0, 60)}`,
      blocked,
    )
  }
  // 3b. takes effect — restricted read (firm_settings hidden for paralegal)
  record(
    'new user enforced: restricted read',
    'firm_settings hidden (0)',
    `visible=${await visibleFirmSettings(jane.actorId)}`,
    (await visibleFirmSettings(jane.actorId)) === 0,
  )

  // 4. assign a higher role — access changes
  await assignUserRole(ownerCtx, { actorId: jane.actorId, roleName: 'firm.owner' })
  record(
    'role change takes effect',
    'firm_settings now visible (>=1)',
    `visible=${await visibleFirmSettings(jane.actorId)}`,
    (await visibleFirmSettings(jane.actorId)) >= 1,
  )

  // 5. deactivate
  await deactivateUser(ownerCtx, { actorId: jane.actorId })
  const after = (await listUsers(ownerCtx)).users.find((u) => u.actorId === jane.actorId)
  record(
    'deactivate takes effect',
    'status inactive, scopes cleared',
    after ? `${after.status}/${after.scopes.length} scopes` : 'gone',
    !!after && after.status === 'inactive' && after.scopes.length === 0,
  )

  report()
}

function report() {
  console.log('\n=== S9 WP9.3 — user-management receipt ===\n')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}`)
    console.log(`      expected: ${r.expected}`)
    console.log(`      observed: ${r.observed}`)
  }
  const allPass = results.every((r) => r.pass)
  console.log(
    `\n${allPass ? 'ALL PASS' : 'FAILURES PRESENT'} (${results.filter((r) => r.pass).length}/${results.length})\n`,
  )
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error('receipt run crashed:', e)
  process.exit(2)
})
