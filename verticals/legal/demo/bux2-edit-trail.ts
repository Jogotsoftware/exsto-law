// BUILDER-UX-2 (WP-1 / WP-2 receipt) — drive the service_build.artifact_edited emit
// path in production for every artifact type, exactly as the wizard pop-up's Save does.
//
// The client wiring is: <Artifact> pop-up Save → card onEdited(note) →
// UnifiedAssistantChat.handleProposalEdited → callAttorneyMcp('legal.assistant
// .build_artifact_edited') → recordBuildArtifactEdited. This walk drives the SERVER leg
// of that path (recordBuildArtifactEdited, the tool handler's body) against prod on a
// real, labelled build session, so the edit trail goes from schema-only (0 fires) to a
// queryable receipt with one row per artifact type. The note's leading word is what
// handleProposalEdited infers artifact_type from, so each note here mirrors what the
// corresponding card emits ("service …", "questionnaire …", …).
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux2-edit-trail.ts fire
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux2-edit-trail.ts show
import '@exsto/legal'
import { startBuildSession, recordBuildArtifactEdited, closeBuildSession } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
const PROBE_KEY = 'bux2_edit_trail_probe'

// One note per artifact type — the leading word is exactly what each card's onEdited
// passes, so handleProposalEdited would infer the same artifact_type.
const EDITS: Array<{
  artifactType: 'service' | 'questionnaire' | 'template' | 'workflow' | 'billing'
  note: string
}> = [
  { artifactType: 'service', note: `service shell "${PROBE_KEY}"` },
  { artifactType: 'questionnaire', note: `questionnaire for "${PROBE_KEY}"` },
  { artifactType: 'template', note: `template "Probe Letter" for "${PROBE_KEY}"` },
  { artifactType: 'workflow', note: `workflow for "${PROBE_KEY}"` },
  { artifactType: 'billing', note: `billing for "${PROBE_KEY}"` },
]

async function fire(): Promise<void> {
  const { buildSessionId } = await startBuildSession(ctx, { serviceKey: PROBE_KEY })
  console.log('build session:', buildSessionId)
  for (const e of EDITS) {
    await recordBuildArtifactEdited(ctx, {
      buildSessionId,
      note: e.note,
      artifactType: e.artifactType,
      serviceKey: PROBE_KEY,
    })
    console.log('  fired', e.artifactType)
  }
}

async function show(): Promise<void> {
  const rows = await withActionContext(ctx, async (client) => {
    const r = await client.query(
      `SELECT ev.data->>'artifact_type' AS artifact_type,
              ev.data->>'service_key'  AS service_key,
              ev.data->>'summary'      AS summary,
              ev.occurred_at
         FROM event ev
         JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
        WHERE ev.tenant_id = $1 AND ekd.kind_name = 'service_build.artifact_edited'
        ORDER BY ev.occurred_at DESC LIMIT 20`,
      [TENANT],
    )
    return r.rows
  })
  const total = await withActionContext(ctx, async (client) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM event ev
         JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
        WHERE ekd.kind_name = 'service_build.artifact_edited'`,
      [],
    )
    return r.rows[0]?.n
  })
  console.log('total service_build.artifact_edited fires:', total)
  console.log(JSON.stringify(rows, null, 2))
}

const cmd = process.argv[2]
if (cmd === 'fire') await fire()
else if (cmd === 'show') await show()
else if (cmd === 'close') {
  // Seal the probe build session so it never lingers as an open build in the widget.
  await closeBuildSession(ctx, process.argv[3], 'completed')
  console.log('closed', process.argv[3])
} else console.error('usage: bux2-edit-trail.ts fire|show|close <buildSessionId>')
