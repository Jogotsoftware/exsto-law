// v1.0.1 FIX 1 (invariant 9): an action kind with no registered handler must be
// REJECTED at submission — recording an action row with zero effects is a
// silent lie in the audit trail (found by the exsto-law Phase 0 build, where
// event.record submissions no-opped until @exsto/primitives was imported).
//
// Two guarantees:
//   a. Submitting an unregistered kind throws and records NOTHING (DB-gated).
//   b. Registration completeness: every action kind the foundation seeds has a
//      registered handler once @exsto/primitives is imported — so the
//      foundation can never trip its own rule (pure, no DB).
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'
import { submitAction, hasActionHandler, type ActionContext } from '@exsto/substrate'
import '@exsto/primitives' // registers the generic handlers (side effect)
import { closeDbPool } from '@exsto/shared'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ctx: ActionContext = {
  tenantId: TENANT,
  actorId: '00000000-0000-0000-0001-000000000002',
}

// The complete action-kind vocabulary shipped by supabase/seed/0001_initial_data.sql.
// This list is a deliberate contract: adding a kind to the seed requires adding
// it here AND registering its handler.
const CORE_ACTION_KINDS = [
  'system.bootstrap',
  'entity.create',
  'entity.update',
  'entity.archive',
  'attribute.set',
  'relationship.create',
  'relationship.close',
  'event.record',
  'judgment.record',
  'outcome.record',
  'identity.assert',
  'config.change',
  'kind.define',
  'workflow.define',
  'workflow.start',
  'workflow.advance',
  'approval.request',
  'approval.respond',
  'policy.define',
  'permission_scope.define',
  'actor_scope.assign',
  'trigger.define',
  'notification_route.define',
  'subscription.create',
  'period.open',
  'period.close',
  'ownership.assign',
  'role.define',
  'role.assign',
  'hierarchy.define',
  'hierarchy.set_membership',
  'collection.define',
  'commitment.create',
  'commitment.fulfill',
  'thread.start',
  'message.append',
  'stakeholder.set',
  'causal.claim',
  'contestation.open',
  'contestation.update',
  'reasoning.capture',
  'access.record',
  'content_blob.store',
  'document.add_version',
  'raw_event.ingest',
  'source_record.link',
  'integration_mapping.define',
  'authoritative_source.designate',
  'conflict_rule.define',
] as const

describe('handler registration completeness (no DB)', () => {
  it('every foundation-seeded action kind has a registered handler', () => {
    const missing = CORE_ACTION_KINDS.filter((k) => !hasActionHandler(k))
    expect(missing).toEqual([])
  })
})

run('unregistered handler rejection (live DB)', { timeout: 60_000 }, () => {
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    await closeDbPool()
  })

  it('submitAction throws on an unregistered kind and records nothing', async () => {
    // A definition row with a deliberately unregistered kind (fixed UUID,
    // idempotent — definition seeding, not substrate state).
    await db.query(
      `INSERT INTO action_kind_definition
         (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, requires_reasoning_trace)
       VALUES ('00000000-0000-0000-0013-0000000000ff', $1, 'test.unregistered_v101',
               'Test: unregistered kind', 'Exists only to prove unregistered submissions are rejected.',
               'autonomous', 'irreversible', false)
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    )
    expect(hasActionHandler('test.unregistered_v101')).toBe(false)

    const before = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM action a
       JOIN action_kind_definition akd ON akd.id = a.action_kind_id
       WHERE a.tenant_id = $1 AND akd.kind_name = 'test.unregistered_v101'`,
      [TENANT],
    )

    await expect(
      submitAction(ctx, {
        actionKindName: 'test.unregistered_v101',
        intentKind: 'exploration',
        payload: { should: 'never be recorded' },
      }),
    ).rejects.toThrow(/no registered action handler/i)

    const after = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM action a
       JOIN action_kind_definition akd ON akd.id = a.action_kind_id
       WHERE a.tenant_id = $1 AND akd.kind_name = 'test.unregistered_v101'`,
      [TENANT],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
