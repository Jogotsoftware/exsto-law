// CAPABILITY-UNIFY-1 — PROD setup (tenant zero 00000000-0000-0000-0000-000000000001).
// Idempotent. Through the action layer only (no raw SQL writes). Steps:
//   1. Ensure the NC Last Will & Testament firm template exists as a standalone
//      document template entity (docKind last_will_and_testament).
//   2. Re-author the nc_will_drafting workflow so the drafting stage is an
//      invoke_capability{document_generation} step naming that template by exact id
//      (ai_draft), replacing the deprecated generate_document step. Existing automatic
//      edge to review is preserved; the broken slug-less client_response is fixed to a
//      real request_client_materials step so the graph validates.
//   3. Archive (NOT delete) the two stranded matters parked on the old generate_will.
//
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-prod-setup.ts
import '@exsto/legal' // register the legal + core action handlers (side effect)
import {
  listStandaloneTemplates,
  getServiceLifecycle,
  setServiceLifecycleAI,
  type Lifecycle,
} from '@exsto/legal'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }

const WILL_TEMPLATE_NAME = 'NC Last Will and Testament'
const WILL_DOC_KIND = 'last_will_and_testament'

// The will template body (the exact one already living in the will service config).
const WILL_TEMPLATE_BODY = `## LAST WILL AND TESTAMENT

### OF {{testator_name}}

*Prepared under the laws of the State of North Carolina.*

I, {{testator_name}}, a resident of {{testator_county}} County, North Carolina, residing at {{testator_address}}, being of sound mind and memory and at least eighteen (18) years of age, and not acting under duress, menace, fraud, or undue influence, do hereby make, publish, and declare this to be my Last Will and Testament, and I hereby revoke all wills and codicils previously made by me.

### ARTICLE I — FAMILY

At the time of executing this Will, my marital status is: {{marital_status}}. The name of my spouse, if any, is: {{spouse_name}}. My children are: {{children_names}}.

### ARTICLE II — PAYMENT OF DEBTS AND EXPENSES

I direct that my legally enforceable debts, funeral expenses, and expenses of administering my estate be paid as soon as practicable after my death.

### ARTICLE III — SPECIFIC GIFTS

{{specific_bequests}}

### ARTICLE IV — RESIDUARY ESTATE

{{residuary_disposition}}

### ARTICLE V — EXECUTOR

I nominate and appoint {{executor_name}} as Executor of this Will. If {{executor_name}} is unable or unwilling to serve, I nominate {{successor_executor_name}} as successor Executor, to serve without bond.

### ARTICLE VI — GUARDIAN FOR MINOR CHILDREN

If at my death any of my children are minors, I nominate {{guardian_name}} as guardian of the person of my minor children.

### ARTICLE VII — GENERAL PROVISIONS

This Will shall be governed by and construed under the laws of the State of North Carolina.

---

IN WITNESS WHEREOF, I have signed this instrument as my Last Will and Testament on {{execution_date}}.

_________________________________
{{testator_name}}, Testator

*[VERIFY: North Carolina requires at least two competent witnesses (N.C.G.S. § 31-3.3); confirm attestation and self-proving affidavit requirements under N.C.G.S. § 31-11.6 before execution.]*`

const WILL_INSTRUCTIONS = `Draft a complete North Carolina Last Will and Testament from the client's intake answers using the firm template as the backbone. Preserve the article structure; replace every {{token}} from the answers; flag anything missing as [NEEDS ATTORNEY INPUT: ...]. Do not invent beneficiaries, bequests, or executors. Jurisdiction is North Carolina (N.C. Gen. Stat. Chapter 31). Plain lawyerly English. These instructions change WHAT you draft, not the required output format: keep the base prompt's output contract exactly — the document markdown first, then the fenced \`\`\`json reasoning trace block at the end. Never omit that block.`

async function ensureWillTemplate(): Promise<string> {
  const existing = (await listStandaloneTemplates(ctx)).find((t) => t.name === WILL_TEMPLATE_NAME)
  if (existing) {
    console.log(`will template already exists: ${existing.templateEntityId}`)
    return existing.templateEntityId
  }
  const res = await submitAction(ctx, {
    actionKindName: 'legal.template.create',
    intentKind: 'enforcement',
    payload: {
      name: WILL_TEMPLATE_NAME,
      category: 'document',
      body: WILL_TEMPLATE_BODY,
      doc_kind: WILL_DOC_KIND,
    },
  })
  const id = (res.effects[0] as { templateEntityId: string }).templateEntityId
  console.log(`will template created: ${id}`)
  return id
}

function buildWillGraph(willTemplateId: string): Lifecycle {
  return [
    {
      key: 'client_intake',
      label: 'Client intake',
      client_label: 'Your intake',
      entry: true,
      blocking: true,
      action: { kind: 'view_intake' },
      advances_to: [{ to: 'generate_will', gate: 'client', via: 'document.upload' }],
    },
    {
      key: 'generate_will',
      label: 'Draft the will',
      blocking: true,
      action: {
        kind: 'invoke_capability',
        config: {
          capability_slug: 'document_generation',
          capability_config: {
            template_entity_id: willTemplateId,
            generation_mode: 'ai_draft',
            instructions: WILL_INSTRUCTIONS,
          },
        },
      },
      advances_to: [{ to: 'review_send_will', gate: 'automatic', on: 'draft.completed' }],
    },
    {
      key: 'review_send_will',
      label: 'Review & send the will',
      client_label: 'Review your draft will',
      blocking: true,
      action: { kind: 'review_send_document' },
      advances_to: [{ to: 'client_response', gate: 'attorney', via: 'draft.approve' }],
    },
    {
      key: 'client_response',
      label: 'Client reviews the draft',
      client_label: 'Review your draft will',
      blocking: true,
      action: {
        kind: 'invoke_capability',
        config: {
          capability_slug: 'request_client_materials',
          capability_config: {
            message:
              'Your draft will is ready in the portal. Please review it and reply to confirm any changes.',
          },
        },
      },
      advances_to: [{ to: 'complete', gate: 'client', via: 'client.message.post' }],
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

async function reauthorWill(willTemplateId: string): Promise<void> {
  const before = await getServiceLifecycle(ctx, 'nc_will_drafting')
  const graph = buildWillGraph(willTemplateId)
  const res = await setServiceLifecycleAI(ctx, 'nc_will_drafting', graph, {
    conclusion:
      'Migrated the will drafting step from the deprecated generate_document kind to an invoke_capability{document_generation} step naming the firm will template by exact id (ai_draft); fixed the slug-less client_response to a real request_client_materials step.',
    confidence: 0.9,
    modelIdentity: 'claude',
  })
  console.log(
    `nc_will_drafting re-authored: v${before?.version ?? '?'} -> v${res.version} (wd ${res.workflowDefinitionId})`,
  )
}

async function archiveStrandedMatters(): Promise<void> {
  // The two matters parked on the old generate_will (M-MRCT0MDH, M-MRCK3A49). Archive
  // through the core entity.archive action (append-only, reversible) — NOT a delete.
  const stranded = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string; matter_number: string; current_state: string }>(
      `SELECT wi.subject_entity_id AS id,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.entity_id = wi.subject_entity_id AND akd.kind_name = 'matter_number'
                ORDER BY a.valid_from DESC LIMIT 1) AS matter_number,
              wi.current_state
         FROM workflow_instance wi
         JOIN workflow_definition wd ON wd.id = wi.workflow_definition_id
         JOIN entity e ON e.id = wi.subject_entity_id
        WHERE wi.tenant_id = $1 AND wd.kind_name = 'nc_will_drafting'
          AND wi.current_state = 'generate_will' AND e.status = 'active'`,
      [TENANT],
    )
    return r.rows
  })
  for (const m of stranded) {
    await submitAction(ctx, {
      actionKindName: 'entity.archive',
      intentKind: 'correction',
      payload: { entity_id: m.id },
    })
    // Record why, on the matter timeline, for the audit trail.
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'correction',
      payload: {
        event_kind_name: 'observation',
        primary_entity_id: m.id,
        data: {
          kind: 'matter_archived',
          reason:
            'CAPABILITY-UNIFY-1: stranded on the retired generate_will path; not rescued on the old path — archived. The fix is the new invoke_capability{document_generation} path.',
          matter_number: m.matter_number,
        },
        source_type: 'agent',
        source_ref: ADMIN,
      },
    })
    console.log(`archived stranded matter ${m.matter_number} (${m.id})`)
  }
  if (stranded.length === 0) console.log('no stranded matters found (already archived?)')
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const willTemplateId = await ensureWillTemplate()
  await reauthorWill(willTemplateId)
  await archiveStrandedMatters()
  console.log('CAPABILITY-UNIFY-1 prod setup complete.')
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
