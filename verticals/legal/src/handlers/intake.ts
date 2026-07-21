import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  getLatestAttributeValue,
  insertAttribute,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'
import { resolveDefaultMatterOwner } from '../api/matterAccess.js'
import { workflowEngineEnabled } from '../lifecycle/flags.js'
import { resolveActiveServiceVersion } from '../lifecycle/binding.js'
import { createWorkflowInstance } from '../lifecycle/instance.js'
import { entryStage } from '../lifecycle/resolve.js'
import { settleStage } from '../lifecycle/settle.js'
import { dispatchLifecycleEvent } from '../lifecycle/executor.js'
import { dispatchClientDelivery } from './clientDelivery.js'
import { normalizeJurisdiction } from '../api/jurisdictions.js'
import { GOVERNING_JURISDICTION_FIELD_ID } from '../api/intakeFieldLibrary.js'

// ───────────────────────────────────────────────────────────────────────────
// intake.submit — steps 1–3 of the intake flow (REQ-INTAKE-01..04, 07).
// Creates/reuses the client_contact (implicit account keyed by email+phone)
// and records the questionnaire_response. The matter is opened by the
// subsequent matter.open action, which wires the relationships.
// ───────────────────────────────────────────────────────────────────────────

interface IntakeSubmitPayload {
  client_full_name: string
  client_email: string
  client_phone: string | null
  client_company_name: string | null
  attribution_source?: string | null
  service_key: string
  intake_form_id: string | null
  intake_responses: Record<string, unknown>
}

// Implicit accounts are indexed by email (+ phone history). Find an existing
// client_contact whose latest email attribute matches, case-insensitively.
// Exported for the public something-else intake (clientRequest.ts), so both
// public entry points dedupe contacts by the same rule.
export async function findContactByEmail(
  client: DbClient,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const res = await client.query<{ entity_id: string }>(
    `WITH latest_emails AS (
       SELECT DISTINCT ON (a.entity_id)
         a.entity_id, a.value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN entity e ON e.id = a.entity_id
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE a.tenant_id = $1
         AND akd.kind_name = 'email'
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
       ORDER BY a.entity_id, a.valid_from DESC
     )
     SELECT entity_id FROM latest_emails
     WHERE lower(value #>> '{}') = lower($2)
     LIMIT 1`,
    [tenantId, email],
  )
  return res.rows[0]?.entity_id ?? null
}

registerActionHandler('intake.submit', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as IntakeSubmitPayload

  // client_contact — dedupe by email; append-only history keeps prior values.
  const contactKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'client_contact',
  )
  const existingContactId = await findContactByEmail(client, ctx.tenantId, p.client_email)
  const clientEntityId =
    existingContactId ??
    (await insertEntity(client, ctx.tenantId, actionId, contactKindId, p.client_full_name))

  const contactAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'full_name', value: p.client_full_name },
    { kind: 'email', value: p.client_email },
  ]
  if (p.client_phone) contactAttrs.push({ kind: 'phone', value: p.client_phone })
  if (p.client_company_name)
    contactAttrs.push({ kind: 'company_name', value: p.client_company_name })

  for (const a of contactAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: clientEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  // questionnaire_response + its structured payload.
  const respKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'questionnaire_response',
  )
  const questionnaireEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    respKindId,
    `${p.service_key} intake`,
  )
  const respAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'intake_form_id', value: p.intake_form_id ?? p.service_key },
    { kind: 'questionnaire_responses', value: p.intake_responses },
    { kind: 'response_complete', value: true },
  ]
  for (const a of respAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: questionnaireEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  return {
    clientEntityId,
    questionnaireEntityId,
    reusedContact: Boolean(existingContactId),
  }
})

// ───────────────────────────────────────────────────────────────────────────
// matter.open — opens the matter from a completed intake and wires the
// client_of / response_of relationships, plus the client-parent grouping
// (contact_of / matter_of). Emits matter.opened.
// ───────────────────────────────────────────────────────────────────────────

interface MatterOpenPayload {
  matter_entity_id?: string
  matter_number?: string
  service_key: string
  workflow_route: 'auto' | 'manual'
  attribution_source?: string | null
  client_entity_id: string
  questionnaire_entity_id: string
  intake_action_id?: string
  summary?: string
  // Name for the client-parent account when one must be created (company name
  // when the intake had one, else the person's full name). Optional: callers
  // that omit it fall back to the contact entity's own name.
  client_display_name?: string | null
  // WF-FIX-2 #6 — this matter was opened BY the client's OWN funnel intake (the
  // finalize/booking path: intake submitted + fee consent recorded, as the
  // client's actor). The submission IS the client's acceptance, so the entry
  // intake stage's client-accept edge auto-advances (no attorney "Record client
  // acceptance" click). ONLY the funnel paths (submitBooking) set this; an
  // attorney-opened matter (openMatter) omits it and parks at intake for the
  // manual acceptance card. Never inferred — set explicitly by the creator.
  client_intake?: boolean
}

// Find the client-parent account this contact already belongs to (contact_of),
// or create one and attach the contact. Returns the client entity id. This is
// what makes an intake produce a fully-linked contact + client + matter: the
// CRM's Clients tab and matter↔client grouping read this account via contact_of
// / matter_of (queries/client.ts, matters.ts). A returning client (same
// contact) reuses their existing account instead of forking a new one per
// matter. All writes stay inside this action's transaction.
async function findOrCreateClientParent(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    contactEntityId: string
    displayName?: string | null
  },
): Promise<string> {
  const existing = await client.query<{ client_id: string }>(
    `SELECT r.target_entity_id AS client_id
     FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     JOIN entity ce ON ce.id = r.target_entity_id
     JOIN entity_kind_definition cekd ON cekd.id = ce.entity_kind_id
     WHERE r.tenant_id = $1
       AND r.source_entity_id = $2
       AND rkd.kind_name = 'contact_of'
       AND cekd.kind_name = 'client'
       AND ce.status = 'active'
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY r.valid_from DESC
     LIMIT 1`,
    [args.tenantId, args.contactEntityId],
  )
  if (existing.rows[0]) return existing.rows[0].client_id

  // Name the account after the contact: the provided display name (company or
  // person), else the contact entity's own name. Never empty.
  let name = (args.displayName ?? '').trim()
  if (!name) {
    const c = await client.query<{ name: string | null }>(
      `SELECT name FROM entity WHERE tenant_id = $1 AND id = $2`,
      [args.tenantId, args.contactEntityId],
    )
    name = (c.rows[0]?.name ?? '').trim() || 'Client'
  }

  const clientKindId = await lookupKindId(client, 'entity_kind_definition', args.tenantId, 'client')
  const clientEntityId = await insertEntity(
    client,
    args.tenantId,
    args.actionId,
    clientKindId,
    name,
    {},
  )

  const clientNameAk = await lookupKindId(
    client,
    'attribute_kind_definition',
    args.tenantId,
    'client_name',
  )
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: clientEntityId,
    attributeKindId: clientNameAk,
    value: name,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })

  const contactOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    args.tenantId,
    'contact_of',
  )
  await insertRelationship(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    sourceEntityId: args.contactEntityId,
    targetEntityId: clientEntityId,
    relationshipKindId: contactOfId,
  })

  return clientEntityId
}

// Pure projection: the intake's answers → the governing_law stamp value, or
// null when there is no such answer, no such id, or the answer doesn't
// normalize (junk, or the WP2.4 "I don't know" sentinel) — never a guess.
// Exported for unit tests (tests/vertical), same PURE-no-DB pattern as
// normalizeGoverningLawValue (handlers/matterJurisdiction.ts).
export function resolveGoverningLawStamp(
  intakeResponses: Record<string, unknown> | null | undefined,
): string | null {
  const answer =
    intakeResponses && typeof intakeResponses === 'object'
      ? intakeResponses[GOVERNING_JURISDICTION_FIELD_ID]
      : undefined
  return typeof answer === 'string' ? normalizeJurisdiction(answer) : null
}

registerActionHandler('matter.open', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterOpenPayload

  const matterEntityId = p.matter_entity_id ?? randomUUID()
  const matterNumber = p.matter_number ?? `M-${Date.now().toString(36).toUpperCase()}`
  const matterKindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, 'matter')

  await client.query(
    `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)`,
    [
      matterEntityId,
      ctx.tenantId,
      actionId,
      matterKindId,
      matterNumber,
      JSON.stringify({ service_key: p.service_key, workflow_route: p.workflow_route }),
    ],
  )

  const matterAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'matter_number', value: matterNumber },
    { kind: 'service_key', value: p.service_key },
    { kind: 'workflow_route', value: p.workflow_route },
    { kind: 'matter_status', value: 'intake_submitted' },
  ]
  // WP A2b — governing jurisdiction is a PER-MATTER fact from the client's OWN
  // intake answer, never a hardcoded default (this used to always stamp
  // 'North Carolina'). When the intake carried the reusable governing_jurisdiction
  // question (intakeFieldLibrary.ts) and the client answered it, normalize and
  // stamp THAT. Otherwise stamp nothing: absence is an honest unset, and
  // resolveMatterJurisdiction (api/matterJurisdiction.ts) is what falls back to
  // the firm's home jurisdiction — this handler must never guess one.
  const intakeResponses = await getLatestAttributeValue<Record<string, unknown>>(
    client,
    ctx.tenantId,
    p.questionnaire_entity_id,
    'questionnaire_responses',
  )
  const normalizedJurisdiction = resolveGoverningLawStamp(intakeResponses)
  if (normalizedJurisdiction) {
    matterAttrs.push({ kind: 'governing_law', value: normalizedJurisdiction })
  }
  // Send-authz owner (0088): this is the PUBLIC booking/intake path — ctx.actorId is
  // the intake actor, not an attorney — so auto-assign the firm's PRACTICING
  // attorney (resolveDefaultMatterOwner) as owner. While the firm has one attorney
  // this is correct; multi-attorney routing rules supersede it later. Reassignable
  // via legal.matter.set_owner. If the firm has no attorney yet, the matter stays
  // unowned (firm-shared) and enforcement is dormant for it.
  const defaultOwner = await resolveDefaultMatterOwner(ctx.tenantId)
  if (defaultOwner) {
    matterAttrs.push({ kind: 'matter_owner', value: defaultOwner })
  }
  if (p.attribution_source) {
    matterAttrs.push({ kind: 'attribution_source', value: p.attribution_source })
  }
  for (const a of matterAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: matterEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  // ADR 0045 (PR3) — flag-gated workflow ENGINE. When LEGAL_WORKFLOW_ENGINE is on
  // AND this service has an authored lifecycle bound (a non-empty
  // workflow_definition.states for its kind_name), stand up a workflow_instance for
  // the matter so the engine can drive it. The existing matter_status write above
  // stays the source of truth and is untouched; the instance is bound to the LATEST
  // active version (invariant 17 pins the matter to that version thereafter). Wrapped
  // so a binding/insert failure never fails matter.open — with the flag OFF this
  // block is a perfect no-op.
  if (workflowEngineEnabled()) {
    // MACHINE-COMMS-1 (WP0) — BOOKING HONESTY: a service with no ACTIVE workflow
    // definition is not openable, and the failure is LOUD. The old behavior bound
    // regardless of status and, when binding returned null, silently skipped
    // instantiation — the matter looked open but had no engine, and the matter page
    // fabricated a legacy pipeline (the 5c5c4ffb class). The throw below fails the
    // whole matter.open action (no half-open matter), and the public booking page
    // hides non-bookable services upstream (listServices.bookable) so clients
    // ~never reach this error.
    const bound = await resolveActiveServiceVersion(client, ctx.tenantId, p.service_key)
    if (!bound) {
      throw new Error(
        `Service "${p.service_key}" has no ACTIVE workflow definition — it is not bookable. ` +
          `Enable the service and give it a lifecycle before opening matters on it.`,
      )
    }
    // The instance INSERT still runs under a SAVEPOINT: an infrastructure failure
    // there (not a config gap — that just failed loudly above) rolls back only the
    // engine work, records a queryable observation, and the matter still opens.
    await client.query('SAVEPOINT workflow_engine')
    try {
      const entry = entryStage(bound.graph)
      await createWorkflowInstance(client, ctx, {
        workflowDefinitionId: bound.workflowDefinitionId,
        subjectEntityId: matterEntityId,
        currentState: entry?.key ?? 'intake_submitted',
        actionId,
      })
      // WF-FIX-1 — settle the entry: a non-blocking entry stage (e.g. an
      // informational consultation) passes through immediately instead of parking
      // the matter; a producing entry stage still auto-runs after matter.open
      // commits (scheduling is a synchronous push — safe inside the savepoint).
      await settleStage(
        client,
        ctx,
        matterEntityId,
        entry?.key ?? 'intake_submitted',
        bound.graph,
        actionId,
      )
      // WF-FIX-1 (WP2) — the public funnel runs intake.submit BEFORE matter.open,
      // so intake is complete the moment the instance exists: emit the signal and
      // dispatch it so a system edge waiting on 'intake.completed' fires in this
      // same action (create → settle → dispatch; dispatch is a no-op when no edge
      // waits — same contract as every dispatchLifecycleEvent site).
      await insertEvent(client, {
        tenantId: ctx.tenantId,
        actionId,
        eventKindName: 'intake.completed',
        primaryEntityId: matterEntityId,
        data: { service_key: p.service_key, questionnaire_entity_id: p.questionnaire_entity_id },
        sourceType: 'system',
        sourceRef: 'system:workflow_engine',
      })
      await dispatchLifecycleEvent(client, ctx, matterEntityId, 'intake.completed', actionId)
      // WF-FIX-2 #6 — a CLIENT-created matter (funnel finalize: intake + fee
      // consent, as the client's actor) has ALREADY been accepted by the client:
      // the submission IS the acceptance. So auto-advance the entry intake stage's
      // CLIENT-accept edge (via 'legal.client_request.accept') via the SAME
      // dispatchClientDelivery every other client action uses, attributed to the
      // acting (client) actor — advancing intake → drafting with zero attorney
      // clicks. A no-op when the stage has no such client edge (e.g. it already
      // advanced on the intake.completed SYSTEM edge above, or it waits on a
      // different token). ONLY for client-created matters: an attorney-opened
      // matter omits the flag and PARKS at intake so the manual "Record client
      // acceptance / Skip" card still governs (attorney/phone acceptance).
      if (p.client_intake === true) {
        await dispatchClientDelivery(
          client,
          ctx,
          matterEntityId,
          'legal.client_request.accept',
          actionId,
        )
      }
      await client.query('RELEASE SAVEPOINT workflow_engine')
    } catch (err) {
      // Roll back ONLY the engine work; the matter is opened either way.
      await client.query('ROLLBACK TO SAVEPOINT workflow_engine')
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[legal.matter.open] workflow instance creation skipped:', err)
      // Leave a QUERYABLE signal so a matter the engine silently skipped is
      // detectable (not just a log line): an `observation` event (core-seeded,
      // is_state_change=false — it does NOT touch matter_status) on the matter,
      // tagged workflow_engine_skipped with the reason. Wrapped so this diagnostic
      // can itself never fail matter.open; the rollback above left the transaction
      // usable so this INSERT runs cleanly.
      try {
        await insertEvent(client, {
          tenantId: ctx.tenantId,
          actionId,
          eventKindName: 'observation',
          primaryEntityId: matterEntityId,
          data: {
            kind: 'workflow_engine_skipped',
            service_key: p.service_key,
            reason,
          },
          sourceType: 'system',
          sourceRef: 'system:workflow_engine',
        })
      } catch (signalErr) {
        console.error('[legal.matter.open] could not record workflow-skip signal:', signalErr)
      }
    }
  }

  const clientOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'client_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: p.client_entity_id,
    targetEntityId: matterEntityId,
    relationshipKindId: clientOfId,
  })

  const responseOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'response_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: p.questionnaire_entity_id,
    targetEntityId: matterEntityId,
    relationshipKindId: responseOfId,
  })

  // Beta feedback (intake linking): attach this matter — and, the first time,
  // the contact — to a client-parent account so intake produces a fully-linked
  // contact + client + matter, not an orphaned contact↔matter pair. The direct
  // client_of link above stays the contact↔matter source of truth; matter_of /
  // contact_of give the CRM its Clients tab and grouping.
  const clientParentId = await findOrCreateClientParent(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    contactEntityId: p.client_entity_id,
    displayName: p.client_display_name,
  })
  const matterOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: matterEntityId,
    targetEntityId: clientParentId,
    relationshipKindId: matterOfId,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'matter.opened',
    primaryEntityId: matterEntityId,
    secondaryEntityIds: [p.client_entity_id, p.questionnaire_entity_id],
    data: {
      service_key: p.service_key,
      workflow_route: p.workflow_route,
      intake_action_id: p.intake_action_id ?? null,
    },
    sourceRef: ctx.actorId,
  })

  return { matterEntityId, matterNumber }
})
