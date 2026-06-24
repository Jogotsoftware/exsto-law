// ONE-TIME test-data clear (founder-authorized 2026-06-24) — THROUGH THE CORE.
//
// The substrate is append-only: we never DELETE/TRUNCATE. This ARCHIVES every
// operational entity (entity.archive → status='archived'; kept as history, dropped
// from every active view/list) and RETIRES every service (legal.service.retire →
// valid_to set, status 'deprecated') — all through the ACTION LAYER, so each removal
// is fully audited (an action + configuration_change row), exactly like the existing
// reseed-pilot.ts pattern.
//
// SCOPE (firm tenant only): clears clients, contacts, matters, invoices (+ lines),
// questionnaire responses, the standalone questionnaire-template library, document
// drafts, transcripts, call sessions, e-sign requests/envelopes, calendar events —
// AND retires all services (with their intake questionnaires). It KEEPS: the legal
// skills library, firm settings/profile, the document-template & workflow-step
// library, and ALL schema/definitions, user accounts, and integrations.
//
// SAFETY: DRY RUN by default — it prints exactly what it WOULD archive/retire and
// exits without changing anything. Pass --apply to execute. The effect is
// irreversible in-app (recoverable only via Supabase point-in-time recovery).
//
// Run (DRY RUN):
//   tsx --env-file=/path/to/prod/.env.local verticals/legal/demo/clear-test-data.ts
// Run (EXECUTE):
//   tsx --env-file=/path/to/prod/.env.local verticals/legal/demo/clear-test-data.ts --apply
import { closeDbPool, withSuperuser } from '@exsto/shared'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
// Side-effect import: registers the legal action handlers (legal.service.retire, …)
// so submitAction can dispatch.
import '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
// System actor — unrestricted (zero scope assignments, migration 0073), so it can
// archive + retire. Provenance reads as a system maintenance clear.
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0001-000000000001'
const APPLY = process.argv.includes('--apply')

const ctx: ActionContext = { tenantId: TENANT_ID, actorId: SYSTEM_ACTOR_ID }

// The operational entity kinds to ARCHIVE. An explicit ALLOW-LIST — it never touches
// firm/config/skill kinds (skill, firm_settings, firm_profile, template,
// workflow_step_template). Kinds with 0 active rows are harmless; deal/person are
// kept for older datasets.
const ARCHIVE_KINDS = [
  'matter',
  'client',
  'client_contact',
  'invoice',
  'invoice_line',
  'questionnaire_response',
  'questionnaire_template',
  'document_draft',
  'transcript',
  'call_session',
  'signature_request',
  'signature_envelope',
  'calendar_event',
  'deal',
  'person',
] as const

async function activeIdsOfKind(kind: string): Promise<string[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT e.id FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'`,
      [TENANT_ID, kind],
    )
    return res.rows.map((r) => r.id)
  })
}

async function activeServiceKeys(): Promise<string[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ kind_name: string }>(
      // Services only — exclude firm.* CONFIG rows (e.g. firm.booking_rules), which
      // share the workflow_definition table but are firm settings, not offerings. This
      // is the exact filter listServices() uses to define "a service".
      `SELECT DISTINCT kind_name FROM workflow_definition
        WHERE tenant_id = $1 AND valid_to IS NULL AND status <> 'deprecated'
          AND kind_name NOT LIKE 'firm.%'
        ORDER BY kind_name`,
      [TENANT_ID],
    )
    return res.rows.map((r) => r.kind_name)
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (point --env-file at the prod .env.local).')
  }
  console.log(
    `\n${APPLY ? '⚠️  APPLYING' : '🔍 DRY RUN'} — test-data clear on tenant ${TENANT_ID}\n`,
  )

  // Inventory first (this is the dry-run preview).
  const plan: Array<{ kind: string; ids: string[] }> = []
  for (const kind of ARCHIVE_KINDS) plan.push({ kind, ids: await activeIdsOfKind(kind) })
  const serviceKeys = await activeServiceKeys()

  console.log('Would ARCHIVE (entity.archive):')
  let total = 0
  for (const { kind, ids } of plan) {
    if (ids.length) console.log(`  ${kind.padEnd(24)} ${ids.length}`)
    total += ids.length
  }
  console.log(`  ${'-'.repeat(28)}\n  total entities: ${total}`)
  console.log(`\nWould RETIRE (legal.service.retire): ${serviceKeys.length} service(s)`)
  for (const k of serviceKeys) console.log(`  - ${k}`)
  console.log(
    '\nKEPT untouched: legal skills, firm settings/profile, the document-template & ' +
      'workflow-step library, all definitions, user accounts, and integrations.\n',
  )

  if (!APPLY) {
    console.log('DRY RUN — nothing was changed. Re-run with --apply to execute.\n')
    return
  }

  // Phase 1 — archive every operational entity through the action layer.
  console.log('> Archiving entities…')
  let archived = 0
  for (const { kind, ids } of plan) {
    for (const id of ids) {
      await archiveEntity(ctx, id, 'adjustment')
      archived++
    }
    if (ids.length) console.log(`  archived ${ids.length} ${kind}`)
  }

  // Phase 2 — retire every service through the action layer.
  console.log('> Retiring services…')
  let retired = 0
  for (const key of serviceKeys) {
    await submitAction(ctx, {
      actionKindName: 'legal.service.retire',
      intentKind: 'adjustment',
      payload: { service_key: key },
    })
    retired++
    console.log(`  retired ${key}`)
  }

  console.log(`\n✓ Clear complete: archived ${archived} entities, retired ${retired} services.\n`)
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Clear failed:', error)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
