// B1.1 (item 7) — READ-ONLY census of matters stranded behind the pre-fix stage-1
// edge. Written by the B1 session; NOT run against prod by that session (the
// orchestrator runs this after reviewing/applying migration 0181, per the
// coordination protocol in ui-fixes-for-exsto-lexical-starlight.md — "do NOT run
// against prod" applied to the writing session, not to the orchestrator's own
// verification).
//
// A matter is "stranded" here if its BOUND workflow_definition version's CURRENT
// stage has an outgoing edge with gate='client' AND via='booking.create' — the
// exact structural no-op B1.1 fixes (signalEvent only ever matches system/
// automatic `on:` edges, so a client-gated `via` edge can never be reached by the
// `intake.completed` dispatch matter.open fires). This is a superset of "matters
// on the two services migration 0181 patches" — it is shape-matched, tenant- and
// service-agnostic, and DOES NOT modify anything.
//
// For each stranded matter it prints a recommendation:
//   • has a submitted questionnaire (matter_has_questionnaire relationship) →
//     RETRO-ADVANCE candidate. After 0181 lands (or the matter's service is
//     otherwise fixed), the per-matter recipe is demo/unstick-pacheco-matter.ts:
//     repin to the latest version (#416), then dispatch `intake.completed` if the
//     landed stage still waits on it. Safe because the client-visible fact
//     (intake was actually submitted) is real — the signal just never fired.
//   • no submitted questionnaire → do NOT retro-advance (there is nothing to
//     honestly signal). Use the sanctioned Skip control on the matter's Workflow
//     step instead (works today — proven on M-MRTHA103).
//
// Usage (root .env.local carries DATABASE_URL):
//   npx tsx --env-file=.env.local verticals/legal/demo/stranded-intake-matters.ts
import { withSuperuser, closeDbPool } from '@exsto/shared'

interface StrandedRow {
  tenant_id: string
  matter_entity_id: string
  matter_number: string | null
  current_state: string
  kind_name: string
  version: number
  workflow_definition_id: string
  is_latest_version: boolean
  has_questionnaire: boolean
}

async function main(): Promise<void> {
  const rows = await withSuperuser(async (client) => {
    const r = await client.query<StrandedRow>(`
      WITH latest_active AS (
        SELECT DISTINCT ON (tenant_id, kind_name) tenant_id, kind_name, id AS latest_id
          FROM workflow_definition
         WHERE valid_to IS NULL AND status = 'active'
         ORDER BY tenant_id, kind_name, version DESC
      )
      SELECT
        wi.tenant_id,
        wi.subject_entity_id AS matter_entity_id,
        e.name AS matter_number,
        wi.current_state,
        wd.kind_name,
        wd.version,
        wd.id AS workflow_definition_id,
        (la.latest_id IS NOT NULL AND la.latest_id = wd.id) AS is_latest_version,
        EXISTS (
          SELECT 1
            FROM relationship rel
            JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id
           WHERE rel.tenant_id = wi.tenant_id
             AND rel.source_entity_id = wi.subject_entity_id
             AND rkd.kind_name = 'matter_has_questionnaire'
        ) AS has_questionnaire
        FROM workflow_instance wi
        JOIN workflow_definition wd ON wd.id = wi.workflow_definition_id
        LEFT JOIN entity e ON e.tenant_id = wi.tenant_id AND e.id = wi.subject_entity_id
        LEFT JOIN latest_active la ON la.tenant_id = wi.tenant_id AND la.kind_name = wd.kind_name
       WHERE wi.status = 'active'
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(wd.states) s
            WHERE s ->> 'key' = wi.current_state
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(s -> 'advances_to') edge
                 WHERE edge ->> 'gate' = 'client' AND edge ->> 'via' = 'booking.create'
              )
         )
       ORDER BY wi.tenant_id, wd.kind_name, wi.subject_entity_id
    `)
    return r.rows
  })

  console.log(
    `Stranded-matter census: ${rows.length} matter(s) parked behind a client/booking.create edge\n`,
  )

  let retroCandidates = 0
  let skipOnly = 0
  for (const row of rows) {
    const recommendation = row.has_questionnaire
      ? 'RETRO-ADVANCE candidate (questionnaire on file — repin to latest + dispatch intake.completed, demo/unstick-pacheco-matter.ts)'
      : 'SKIP only (no questionnaire on file — nothing honest to retro-signal; use the sanctioned Skip control)'
    if (row.has_questionnaire) retroCandidates += 1
    else skipOnly += 1
    console.log(
      `- tenant ${row.tenant_id} · matter ${row.matter_number ?? row.matter_entity_id} (${row.matter_entity_id})\n` +
        `    service ${row.kind_name} v${row.version}${row.is_latest_version ? '' : ' (STALE — not the latest active version; repin first)'} · resting at "${row.current_state}"\n` +
        `    → ${recommendation}`,
    )
  }

  console.log(
    `\nSummary: ${rows.length} stranded · ${retroCandidates} retro-advance candidates · ${skipOnly} Skip-only.`,
  )
  console.log(
    "Recommendation: after migration 0181 is applied (or the matter's specific service is otherwise " +
      'repinned to a fixed version), retro-advance ONLY the candidates above with a real questionnaire on ' +
      "file — each is a one-time correction (intent 'correction'), not a bulk auto-fix, since a matter's " +
      'circumstances may have changed since it stranded. For matters with no questionnaire on file, do not ' +
      'fabricate an intake.completed signal — use the sanctioned per-matter Skip control instead.',
  )
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Stranded-matter census failed:', error)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
