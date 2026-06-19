// S9 WP9.2 — RBAC enforcement live receipt (runs THROUGH the operation core).
//
//   node --env-file=.env.local scripts/s9-rbac-receipt.mjs
//
// Seeds (idempotently, via submitAction) two permission scopes and two roles in
// tenant zero, grants the owner an admin scope and restricts the spare
// "Second User" actor to a paralegal scope, then proves enforcement bites:
//   * allowed write : paralegal runs entity.create        -> succeeds
//   * blocked write : paralegal runs event.record         -> rejected by RLS
//   * restricted read: paralegal cannot see invoice rows the owner can
//   * allowed read   : paralegal CAN see permitted kinds  (reads not broken)
//
// Exits non-zero if any assertion fails. Every write is through submitAction —
// no direct substrate SQL. Imports the built dist directly (the repo's .mjs
// scripts use this relative-dist convention; bare @exsto/* + tsx mis-resolves
// the ESM "import" condition on this pnpm-on-Drive layout).
import { submitAction, executeQuery } from '../packages/substrate/dist/index.js'
import '../packages/primitives/dist/index.js' // side-effect: registers all core action handlers
import { createEntity } from '../packages/primitives/dist/index.js'

const TENANT = '00000000-0000-0000-0000-000000000001'
const OWNER = '00000000-0000-0000-0001-000000000002' // Joe Pacheco (firm owner)
const PARALEGAL = '00000000-0000-0000-0001-000000000003' // spare "Second User" actor

const ownerCtx = { tenantId: TENANT, actorId: OWNER }
const paraCtx = { tenantId: TENANT, actorId: PARALEGAL }

const results = []
function record(check, expected, observed, pass) {
  results.push({ check, expected, observed, pass })
}

async function ensureScope(scopeName, displayName, actionKinds, entityKinds) {
  const existing = await executeQuery(
    ownerCtx,
    `SELECT id FROM permission_scope_definition WHERE tenant_id=$1 AND scope_name=$2 AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
    [TENANT, scopeName],
  )
  if (existing.rows[0]) return existing.rows[0].id
  await submitAction(ownerCtx, {
    actionKindName: 'permission_scope.define',
    intentKind: 'enforcement',
    payload: {
      scope_name: scopeName,
      display_name: displayName,
      action_kinds: actionKinds,
      entity_kinds: entityKinds,
    },
  })
  const created = await executeQuery(
    ownerCtx,
    `SELECT id FROM permission_scope_definition WHERE tenant_id=$1 AND scope_name=$2 ORDER BY recorded_at DESC LIMIT 1`,
    [TENANT, scopeName],
  )
  return created.rows[0].id
}

async function ensureRole(roleName, displayName, scopes) {
  const existing = await executeQuery(
    ownerCtx,
    `SELECT id FROM role_definition WHERE tenant_id=$1 AND role_name=$2 AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
    [TENANT, roleName],
  )
  if (existing.rows[0]) return
  await submitAction(ownerCtx, {
    actionKindName: 'role.define',
    intentKind: 'enforcement',
    payload: { role_name: roleName, display_name: displayName, default_permission_scopes: scopes },
  })
}

async function ensureAssignment(actorId, scopeId) {
  const existing = await executeQuery(
    ownerCtx,
    `SELECT id FROM actor_scope_assignment WHERE tenant_id=$1 AND actor_id=$2 AND permission_scope_definition_id=$3 AND (valid_to IS NULL OR valid_to>now()) LIMIT 1`,
    [TENANT, actorId, scopeId],
  )
  if (existing.rows[0]) return
  await submitAction(ownerCtx, {
    actionKindName: 'actor_scope.assign',
    intentKind: 'enforcement',
    payload: { actor_id: actorId, permission_scope_definition_id: scopeId },
  })
}

async function ensureInvoice() {
  const existing = await executeQuery(
    ownerCtx,
    `SELECT e.id FROM entity e JOIN entity_kind_definition k ON k.id=e.entity_kind_id
      WHERE e.tenant_id=$1 AND k.kind_name='invoice' AND e.name='S9 RBAC test invoice' LIMIT 1`,
    [TENANT],
  )
  if (existing.rows[0]) return
  await submitAction(ownerCtx, {
    actionKindName: 'entity.create',
    intentKind: 'exploration',
    payload: { entity_kind_name: 'invoice', name: 'S9 RBAC test invoice', attributes: [] },
  })
}

async function main() {
  // --- Seed (admin = firm owner, unrestricted on first run) ---
  const adminScope = await ensureScope('firm.admin', 'Firm Admin (full access)', ['*'], ['*'])
  const paraScope = await ensureScope(
    'firm.paralegal',
    'Paralegal (matters/clients, no billing)',
    ['entity.create', 'attribute.set'],
    ['matter', 'person', 'client', 'client_contact', 'document'],
  )
  await ensureRole('firm.owner', 'Owner / Admin', ['firm.admin'])
  await ensureRole('firm.paralegal', 'Paralegal', ['firm.paralegal'])
  await ensureInvoice()
  await ensureAssignment(OWNER, adminScope)
  await ensureAssignment(PARALEGAL, paraScope)

  // --- Receipt 1: allowed write (entity.create is in the paralegal scope) ---
  try {
    await createEntity(paraCtx, {
      entityKindName: 'person',
      attributes: [],
      intentKind: 'exploration',
    })
    record('allowed write: paralegal entity.create', 'succeeds', 'succeeded', true)
  } catch (e) {
    record('allowed write: paralegal entity.create', 'succeeds', `THREW: ${e.message}`, false)
  }

  // --- Receipt 2: blocked write (event.record is NOT in the paralegal scope) ---
  try {
    await submitAction(paraCtx, {
      actionKindName: 'event.record',
      intentKind: 'exploration',
      payload: { event_kind_name: 'note', summary: 'should be blocked' },
    })
    record('blocked write: paralegal event.record', 'rejected', 'WAS ALLOWED', false)
  } catch (e) {
    const blocked = /row-level security|violates|policy|42501/i.test(e.message)
    record(
      'blocked write: paralegal event.record',
      'rejected by RLS',
      blocked ? `blocked: ${e.message.slice(0, 90)}` : `threw (other): ${e.message.slice(0, 90)}`,
      blocked,
    )
  }

  // --- Receipt 3 + 4: read enforcement (invoice hidden, permitted kinds visible) ---
  const sql = `SELECT k.kind_name, count(*)::int AS n
               FROM entity e JOIN entity_kind_definition k ON k.id=e.entity_kind_id
               WHERE e.tenant_id=$1 AND k.kind_name IN ('invoice','person')
               GROUP BY k.kind_name`
  const ownerView = Object.fromEntries(
    (await executeQuery(ownerCtx, sql, [TENANT])).rows.map((r) => [r.kind_name, r.n]),
  )
  const paraView = Object.fromEntries(
    (await executeQuery(paraCtx, sql, [TENANT])).rows.map((r) => [r.kind_name, r.n]),
  )
  const ownerInvoices = ownerView['invoice'] ?? 0
  const paraInvoices = paraView['invoice'] ?? 0
  const paraPersons = paraView['person'] ?? 0
  record(
    'restricted read: invoice entities',
    'owner sees >=1, paralegal sees 0',
    `owner=${ownerInvoices}, paralegal=${paraInvoices}`,
    ownerInvoices >= 1 && paraInvoices === 0,
  )
  record(
    'allowed read: person entities (paralegal-permitted kind)',
    'paralegal sees >=1',
    `paralegal=${paraPersons}`,
    paraPersons >= 1,
  )

  // --- Report ---
  console.log('\n=== S9 WP9.2 — RBAC enforcement receipt ===\n')
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
