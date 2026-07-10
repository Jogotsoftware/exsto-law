// createQuestionnaireAI + createTemplateAI (Build-Wizard Phase 2+3). Each AI write
// persists a reasoning_trace sourced to the Claude agent actor, then submits the
// underlying legal.service.upsert AS THE AGENT with the right intent, producing a new
// service version that carries the trace. Mirrors service-create-ai.test.ts. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  createServiceAI,
  createTemplateAI,
  createQuestionnaireAI,
  getDocumentTemplate,
  getQuestionnaire,
  retireService,
  listStandaloneTemplates,
  archiveTemplate,
} from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded Claude agent actor — the source the AI write paths attribute to.
const CLAUDE_AGENT_ACTOR = '00000000-0000-0000-0001-000000000004'
const attorneyCtx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

// The latest action + its reasoning_trace for a service's current row — proves
// agent-sourcing, the intent, and tenant scoping end to end.
async function latestProvenance(serviceKey: string) {
  return withSuperuser(async (client) => {
    const r = await client.query<{
      wf_tenant: string
      action_intent: string
      action_tenant: string
      trace_tenant: string | null
      trace_agent: string | null
      trace_confidence: number | null
    }>(
      `SELECT wf.tenant_id AS wf_tenant,
              a.intent_kind AS action_intent,
              a.tenant_id   AS action_tenant,
              rt.tenant_id  AS trace_tenant,
              rt.agent_actor_id AS trace_agent,
              rt.confidence AS trace_confidence
         FROM workflow_definition wf
         JOIN action a ON a.id = wf.action_id
         LEFT JOIN reasoning_trace rt ON rt.id = a.reasoning_trace_id
        WHERE wf.tenant_id = $1 AND wf.kind_name = $2 AND wf.valid_to IS NULL`,
      [TENANT, serviceKey],
    )
    return r.rows[0]!
  })
}

run('Author questionnaire + template via AI (live DB)', { timeout: 120_000 }, () => {
  const created: string[] = []
  const twinIds: string[] = []
  afterAll(async () => {
    for (const key of created) {
      await retireService(attorneyCtx, key).catch(() => {})
    }
    // The firm-library twins the template test created (BUILDER-CERT-1 WP3).
    for (const id of twinIds) {
      await archiveTemplate(attorneyCtx, id).catch(() => {})
    }
    await closeDbPool()
  })

  it('createTemplateAI writes an agent-sourced, reasoning-traced, tenant-scoped template bound to the service', async () => {
    const svc = await createServiceAI(
      attorneyCtx,
      {
        displayName: `Wizard Svc ${Date.now()}`,
        route: 'manual',
        generationMode: 'template_merge',
      },
      { conclusion: 'shell', confidence: 0.8 },
    )
    created.push(svc.serviceKey)

    const result = await createTemplateAI(
      attorneyCtx,
      svc.serviceKey,
      {
        name: 'Engagement Letter',
        body: 'Dear {{primary_client_name}}, re: {{company_name}}.',
        docKind: 'engagement_letter',
        category: 'document',
        signature: { required: true, signer_roles: ['client'] },
      },
      { conclusion: 'The firm needs an engagement letter.', confidence: 0.7 },
    )
    twinIds.push(result.templateEntityId)

    // The template is bound to the service (readable by docKind) with its body.
    const tpl = await getDocumentTemplate(attorneyCtx, svc.serviceKey, 'engagement_letter')
    expect(tpl).not.toBeNull()
    expect(tpl!.source).toBe('config')
    expect(tpl!.templateText).toContain('{{company_name}}')

    // BUILDER-CERT-1 (WP3) — the FIRM-LIBRARY TWIN: the approved template also lands
    // as a standalone library entity (what document_generation binds by exact id and
    // the e-sign validator reads signability from).
    const twin = (await listStandaloneTemplates(attorneyCtx)).find(
      (t) => t.templateEntityId === result.templateEntityId,
    )
    expect(twin).toBeDefined()
    expect(twin!.docKind).toBe('engagement_letter')
    expect(twin!.signature.required).toBe(true)
    expect(twin!.signature.signer_roles).toEqual(['client'])

    // Agent-sourced + traced + intent 'exploration', all on TENANT.
    const prov = await latestProvenance(svc.serviceKey)
    expect(prov.wf_tenant).toBe(TENANT)
    expect(prov.action_tenant).toBe(TENANT)
    expect(prov.trace_tenant).toBe(TENANT)
    expect(prov.action_intent).toBe('exploration')
    expect(prov.trace_agent).toBe(CLAUDE_AGENT_ACTOR)
    expect(prov.trace_confidence).not.toBeNull()
    expect(Number(prov.trace_confidence)).toBeLessThan(1)
  })

  it('createQuestionnaireAI writes an agent-sourced, reasoning-traced, tenant-scoped intake schema', async () => {
    const svc = await createServiceAI(
      attorneyCtx,
      {
        displayName: `Wizard Q Svc ${Date.now()}`,
        route: 'manual',
        generationMode: 'template_merge',
      },
      { conclusion: 'shell', confidence: 0.8 },
    )
    created.push(svc.serviceKey)

    await createQuestionnaireAI(
      attorneyCtx,
      svc.serviceKey,
      {
        title: 'Intake',
        sections: [
          {
            id: 'company',
            title: 'Company',
            fields: [
              { id: 'company_name', label: 'Company name', type: 'text', required: true },
              { id: 'primary_client_name', label: 'Your name', type: 'text', required: true },
            ],
          },
        ],
      },
      { conclusion: 'Capture what the engagement letter needs.', confidence: 0.75 },
    )

    // The schema is persisted on the service.
    const q = await getQuestionnaire(attorneyCtx, svc.serviceKey)
    expect(q).not.toBeNull()
    const fieldIds = (q!.sections ?? []).flatMap((s) => s.fields.map((f) => f.id))
    expect(fieldIds).toContain('company_name')

    // Agent-sourced + traced + intent 'adjustment' (filling a service's intake), TENANT.
    const prov = await latestProvenance(svc.serviceKey)
    expect(prov.wf_tenant).toBe(TENANT)
    expect(prov.action_tenant).toBe(TENANT)
    expect(prov.trace_tenant).toBe(TENANT)
    expect(prov.action_intent).toBe('adjustment')
    expect(prov.trace_agent).toBe(CLAUDE_AGENT_ACTOR)
    expect(prov.trace_confidence).not.toBeNull()
    expect(Number(prov.trace_confidence)).toBeLessThan(1)
  })
})
