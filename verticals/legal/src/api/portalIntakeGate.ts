import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// PORTAL-1 (WP1) — the intake account gate's server half.
//
// The /book funnel persists the intake as a LEAD before showing the account
// step, so a client who balks at "choose a password" is a recoverable,
// queryable row — never vapor. The lead reuses EXISTING kinds: intake.submit
// (client_contact deduped by email + a questionnaire_response holding the
// answers) with NO matter.open — exactly the shape the attorney already knows.
// On account success, the normal intake.submit → matter.open → booking.create
// runs attributed to the client's OWN actor; intake.submit's email dedupe means
// the staged contact is reused, not duplicated.

export interface StageIntakeLeadInput {
  clientFullName: string
  clientEmail: string
  clientPhone?: string | null
  clientCompanyName?: string | null
  serviceKey: string
  intakeResponses: Record<string, unknown>
}

export interface StagedIntakeLead {
  clientEntityId: string
  questionnaireEntityId: string
}

export async function stageIntakeLead(
  ctx: ActionContext,
  input: StageIntakeLeadInput,
): Promise<StagedIntakeLead> {
  if (!input.clientEmail?.trim()) throw new Error('Email is required.')
  if (!input.clientFullName?.trim()) throw new Error('Name is required.')
  if (!input.serviceKey?.trim()) throw new Error('serviceKey is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'exploration',
    payload: {
      client_full_name: input.clientFullName.trim(),
      client_email: input.clientEmail.trim(),
      client_phone: input.clientPhone ?? null,
      client_company_name: input.clientCompanyName ?? null,
      service_key: input.serviceKey,
      intake_form_id: null,
      intake_responses: input.intakeResponses ?? {},
    },
  })
  const effects = (res.effects[0] ?? {}) as {
    clientEntityId?: string
    questionnaireEntityId?: string
  }
  if (!effects.clientEntityId || !effects.questionnaireEntityId) {
    throw new Error('Staging the intake failed.')
  }
  return {
    clientEntityId: effects.clientEntityId,
    questionnaireEntityId: effects.questionnaireEntityId,
  }
}

// Tenant-scoped: the active client_contact with this email (latest email
// attribute, case-insensitive). The finalize route uses it to bind the account
// to the staged contact. Mirrors the intake handler's findContactByEmail.
export async function findClientContactIdByEmail(
  ctx: ActionContext,
  email: string,
): Promise<string | null> {
  if (!email?.trim()) return null
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ entity_id: string }>(
      `SELECT DISTINCT ON (a.entity_id) a.entity_id
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN entity e ON e.id = a.entity_id
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE a.tenant_id = $1
         AND akd.kind_name = 'email'
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
         AND lower(a.value #>> '{}') = lower($2)
       ORDER BY a.entity_id, a.valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, email.trim()],
    )
    return res.rows[0]?.entity_id ?? null
  })
}
