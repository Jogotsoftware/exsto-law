// CAPABILITY-UNIFY-1 — ACCEPTANCE #5 negatives (PROD, tenant zero). Three proofs on
// one throwaway service, then a corrective observation:
//   A. Authoring with a BOGUS capability_config.template_entity_id is rejected by the
//      validator with the exact-path error (and setServiceLifecycleAI writes nothing).
//   B. A contracted-but-unimplemented capability (esignature) authors fine
//      (contract-first) but REFUSES to run: no-simulate → capability_not_executable
//      observation + the job fails (never a faked advance).
//   C. The parked negative matter and the fixture are archived (append-only), never
//      deleted.
// Plus: post a corrective observation on M-1C797C90, which the stranded-matter sweep
// archived with the old-path reason text although it was a NEW-path matter parked by
// the (since-fixed) will drafting-prompt bug.
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-negatives.ts
process.env.LEGAL_WORKFLOW_ENGINE = '1'

import '@exsto/legal'
import { setServiceLifecycleAI, validateProposedLifecycle, type Lifecycle } from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { randomUUID } from 'node:crypto'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

const NEG_DISPLAY = 'CAPUNIFY negative demo (do not use)'
const BOGUS_TEMPLATE_ID = '00000000-dead-beef-0000-000000000000'

function docGenGraph(templateId: string): Lifecycle {
  return [
    {
      key: 'client_intake',
      label: 'Client intake',
      entry: true,
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'draft_doc', gate: 'client', via: 'document.upload' }],
    },
    {
      key: 'draft_doc',
      label: 'Draft the document',
      blocking: true,
      action: {
        kind: 'invoke_capability',
        config: {
          capability_slug: 'document_generation',
          capability_config: { template_entity_id: templateId, generation_mode: 'ai_draft' },
        },
      },
      advances_to: [{ to: 'complete', gate: 'automatic', on: 'draft.completed' }],
    },
    {
      key: 'complete',
      label: 'Complete matter',
      blocking: false,
      action: { kind: 'complete_matter' },
      terminal: true,
      advances_to: [],
    },
  ]
}

const ESIGN_GRAPH: Lifecycle = [
  {
    key: 'client_intake',
    label: 'Client intake',
    entry: true,
    blocking: true,
    action: { kind: 'view_intake' },
    advances_to: [{ to: 'esign_doc', gate: 'client', via: 'document.upload' }],
  },
  {
    key: 'esign_doc',
    label: 'Send for e-signature',
    blocking: true,
    action: { kind: 'invoke_capability', config: { capability_slug: 'esignature' } },
    advances_to: [{ to: 'complete', gate: 'system', on: 'esign.completed' }],
  },
  {
    key: 'complete',
    label: 'Complete matter',
    blocking: false,
    action: { kind: 'complete_matter' },
    terminal: true,
    advances_to: [],
  },
]

async function ensureNegService(): Promise<string> {
  const existing = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ kind_name: string }>(
      `SELECT kind_name FROM workflow_definition WHERE tenant_id=$1 AND display_name=$2 AND valid_to IS NULL LIMIT 1`,
      [TENANT, NEG_DISPLAY],
    )
    return r.rows[0]?.kind_name ?? null
  })
  if (existing) return existing
  const up = await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'exploration',
    payload: {
      display_name: NEG_DISPLAY,
      description: 'CAPABILITY-UNIFY-1 negative fixtures. Never a real service.',
      route: 'manual',
      documents: [],
    },
  })
  return (up.effects[0] as { serviceKey: string }).serviceKey
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const out: Record<string, unknown> = {}
  const serviceKey = await ensureNegService()
  out.negService = serviceKey

  // A — bogus template id: validator error text + write path refuses.
  const v = (await validateProposedLifecycle(ctx, docGenGraph(BOGUS_TEMPLATE_ID))) as unknown as {
    ok: boolean
    errors: string[]
  }
  out.A_validator = v
  let writeRefused = false
  let writeError = ''
  try {
    await setServiceLifecycleAI(ctx, serviceKey, docGenGraph(BOGUS_TEMPLATE_ID), {
      conclusion: 'negative test — must be rejected',
      confidence: 0.5,
      modelIdentity: 'claude',
    })
  } catch (e) {
    writeRefused = true
    writeError = e instanceof Error ? e.message : String(e)
  }
  out.A_setLifecycleRefused = writeRefused
  out.A_setLifecycleError = writeError.slice(0, 400)

  // B — esignature: contracted, authors fine, refuses to RUN (no-simulate).
  const authored = await setServiceLifecycleAI(ctx, serviceKey, ESIGN_GRAPH, {
    conclusion: 'negative fixture: contracted-but-unimplemented capability stage',
    confidence: 0.9,
    modelIdentity: 'claude',
  })
  out.B_authoredVersion = authored.version

  const matterEntityId = randomUUID()
  const matterNumber = `M-${matterEntityId.slice(0, 8).toUpperCase()}`
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: 'Negative Fixture',
      client_email: 'capunify.negative@example.com',
      client_phone: null,
      client_company_name: null,
      service_key: serviceKey,
      intake_form_id: null,
      intake_responses: { note: 'negative fixture' },
    },
  })
  const eff = intake.effects[0] as { clientEntityId?: string; questionnaireEntityId?: string }
  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      matter_number: matterNumber,
      service_key: serviceKey,
      workflow_route: 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: eff.clientEntityId,
      questionnaire_entity_id: eff.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: 'Negative Fixture',
    },
  })
  await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      object_key: `capunify/neg/${matterEntityId.slice(0, 8)}.txt`,
      original_filename: 'note.txt',
      content_type: 'text/plain',
      size_bytes: 16,
      sha256_hex: 'ef'.repeat(32),
      document_kind: 'client_intake_note',
      document_source: 'client_uploaded',
      client_contact_id: eff.clientEntityId,
    },
  })
  out.B_matter = { matterNumber, matterEntityId }

  // Wait for the worker's FIRST failed attempt to record the no-simulate observation.
  const deadline = Date.now() + 3 * 60 * 1000
  while (Date.now() < deadline) {
    const row = await withActionContext(ctx, async (client) => {
      const r = await client.query<{ n: string; job_status: string | null; err: string | null }>(
        `SELECT (SELECT count(*)::text FROM event e
                  WHERE e.tenant_id=$1 AND e.primary_entity_id=$2::uuid
                    AND e.payload->>'kind'='capability_not_executable') AS n,
                (SELECT status FROM worker_job
                  WHERE tenant_id=$1 AND job_kind='legal.capability.run'
                    AND payload->>'matter_entity_id'=$2::text
                  ORDER BY created_at DESC LIMIT 1) AS job_status,
                (SELECT left(coalesce(last_error,''),160) FROM worker_job
                  WHERE tenant_id=$1 AND job_kind='legal.capability.run'
                    AND payload->>'matter_entity_id'=$2::text
                  ORDER BY created_at DESC LIMIT 1) AS err`,
        [TENANT, matterEntityId],
      )
      return r.rows[0]
    })
    if (row && Number(row.n) > 0) {
      out.B_notExecutableObservations = Number(row.n)
      out.B_jobStatus = row.job_status
      out.B_jobError = row.err
      break
    }
    await new Promise((r) => setTimeout(r, 5000))
  }

  // C — archive the fixture matter (append-only cleanup; the dead-letter job stays as
  // the honest record of the refused run).
  await submitAction(ctx, {
    actionKindName: 'entity.archive',
    intentKind: 'correction',
    payload: { entity_id: matterEntityId },
  })
  out.C_fixtureMatterArchived = true

  // Corrective observation on M-1C797C90 (archived by the sweep with old-path text).
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'correction',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: '1c797c90-9e33-43e4-9db2-7194bda80c5f',
      data: {
        kind: 'matter_archived_correction',
        reason:
          'Correction: M-1C797C90 was NOT stranded on the retired generate_will path. It was a CAPABILITY-UNIFY-1 acceptance drive parked by a pre-existing will drafting-prompt bug (config prompt missing the reasoning-trace contract), fixed the same day via updateDraftingPrompt. Archived as a test artifact.',
      },
      source_type: 'agent',
      source_ref: ADMIN,
    },
  })
  out.correctiveObservationPosted = true

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
