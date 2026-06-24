// ADR 0045 — backfill a workflow_instance for every EXISTING matter that has none
// but whose service resolves to a non-empty authored lifecycle. The engine
// (intake.ts) only stands an instance up for matters opened AFTER the flag flipped;
// this script gives the matters opened BEFORE that a running instance so the engine
// can drive them too. It is the workflow_instance sibling of backfill-lifecycle.ts
// (which backfills workflow_definition.STATES — the service graph; this backfills the
// per-matter INSTANCE bound to that graph).
//
// What it does, per matter with NO instance:
//   1. read its service_key + current matter_status,
//   2. resolve the service's ACTIVE version graph (resolveActiveServiceVersion) —
//      skip the matter if the service has no authored lifecycle (empty graph),
//   3. insert ONE workflow_instance bound to that version, with current_state set to
//      the stage matching the matter's current matter_status if that stage exists in
//      the graph, else the entry stage. (So a matter mid-flight resumes where it is,
//      not back at intake.)
//
// IDEMPOTENT: skips any matter that already has a workflow_instance, so a re-run
// writes nothing new. DEFAULT DRY-RUN (read-only): pass --apply (or set
// BACKFILL_APPLY=1) to write. Migration-script territory (hard rule 1 permits direct
// writes in migration scripts): each instance is created with createWorkflowInstance
// (the action-layer instance writer) wrapped in a system.bootstrap action row so the
// instance + its state_history entry carry a real action id (never a placeholder).
//
// Run (dry):   tsx --env-file=.env.local verticals/legal/demo/backfill-workflow-instances.ts
// Run (apply): tsx --env-file=.env.local verticals/legal/demo/backfill-workflow-instances.ts --apply
import { randomUUID } from 'node:crypto'
import { closeDbPool } from '@exsto/shared'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import {
  resolveActiveServiceVersion,
  createWorkflowInstance,
  entryStage,
  stageByKey,
} from '@exsto/legal'
// Side effect: registers the legal action handlers (not strictly needed here, but
// keeps parity with the other demo scripts and ensures the package initializes).
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000001', // System actor, tenant zero
}

// The seeded system.bootstrap action kind — the right provenance for a one-time
// backfill/seed write (autonomous, irreversible).
const SYSTEM_BOOTSTRAP_ACTION_KIND_ID = '00000000-0000-0000-0013-000000000001'

const APPLY = process.argv.includes('--apply') || process.env.BACKFILL_APPLY === '1'

interface MatterRow {
  matter_id: string
  service_key: string | null
  matter_status: string | null
  has_instance: boolean
}

async function loadMatters(): Promise<MatterRow[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<MatterRow>(
      `SELECT
         e.id AS matter_id,
         (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition k ON k.id = a.attribute_kind_id
           WHERE a.entity_id = e.id AND a.tenant_id = e.tenant_id
             AND k.kind_name = 'service_key' AND a.valid_to IS NULL
           ORDER BY a.valid_from DESC LIMIT 1) AS service_key,
         (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition k ON k.id = a.attribute_kind_id
           WHERE a.entity_id = e.id AND a.tenant_id = e.tenant_id
             AND k.kind_name = 'matter_status' AND a.valid_to IS NULL
           ORDER BY a.valid_from DESC LIMIT 1) AS matter_status,
         EXISTS (
           SELECT 1 FROM workflow_instance wi
            WHERE wi.tenant_id = e.tenant_id AND wi.subject_entity_id = e.id
         ) AS has_instance
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'matter'
      WHERE e.tenant_id = $1 AND e.status = 'active'
      ORDER BY e.created_at`,
      [ctx.tenantId],
    )
    return res.rows
  })
}

async function main(): Promise<void> {
  const matters = await loadMatters()
  console.log(
    `${matters.length} active matters${APPLY ? ' (APPLY mode)' : ' (dry-run — no writes)'}\n`,
  )

  let skippedHasInstance = 0
  let skippedNoService = 0
  let skippedNoLifecycle = 0
  let wouldWrite = 0
  let wrote = 0

  for (const m of matters) {
    if (m.has_instance) {
      skippedHasInstance++
      continue
    }
    if (!m.service_key) {
      skippedNoService++
      console.log(`  • ${m.matter_id}: no service_key — skipped`)
      continue
    }

    // Resolve the service's active lifecycle. resolveActiveServiceVersion returns
    // null for a service with no authored lifecycle (empty states) — skip it.
    const bound = await withActionContext(ctx, (client) =>
      resolveActiveServiceVersion(client, ctx.tenantId, m.service_key!),
    )
    if (!bound) {
      skippedNoLifecycle++
      console.log(`  • ${m.matter_id} [${m.service_key}]: no authored lifecycle — skipped`)
      continue
    }

    // Resume where the matter IS: the stage matching its current matter_status if
    // that stage exists in the graph, else the entry stage.
    const entry = entryStage(bound.graph)
    const statusStage = m.matter_status ? stageByKey(bound.graph, m.matter_status) : null
    const startState = statusStage?.key ?? entry?.key ?? 'intake_submitted'

    console.log(
      `  • ${m.matter_id} [${m.service_key}] v${bound.version}  ` +
        `status=${m.matter_status ?? '(none)'} → entry-state '${startState}'`,
    )

    wouldWrite++
    if (!APPLY) continue

    await withActionContext(ctx, async (client) => {
      // Record a system.bootstrap action row so the instance + its state_history
      // entry carry a real action id (migration-script direct write — hard rule 1).
      const actionId = randomUUID()
      // hlc_* are NOT NULL on action; a one-shot backfill doesn't need the live HLC
      // generator (no concurrent ordering to preserve), so stamp now()/0/random — the
      // same shape submitAction writes, just without the in-process clock.
      await client.query(
        `INSERT INTO action
           (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
            hlc_physical_time, hlc_logical_counter, hlc_source_id, occurred_at, recorded_at)
         VALUES ($1, $2, $3, $4, 'automatic_sync', 'autonomous',
            now(), 0, gen_random_uuid(), now(), now())`,
        [actionId, ctx.tenantId, SYSTEM_BOOTSTRAP_ACTION_KIND_ID, ctx.actorId],
      )
      await createWorkflowInstance(client, ctx, {
        workflowDefinitionId: bound.workflowDefinitionId,
        subjectEntityId: m.matter_id,
        currentState: startState,
        actionId,
      })
    })
    wrote++
    console.log(`      ↳ instance created at '${startState}'`)
  }

  console.log(
    `\n${APPLY ? `Applied: created ${wrote}` : `Dry-run: would create ${wouldWrite}`} instance(s); ` +
      `skipped ${skippedHasInstance} already-instanced, ${skippedNoService} without a service, ` +
      `${skippedNoLifecycle} without an authored lifecycle.`,
  )
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('✗ Backfill failed:', e)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
