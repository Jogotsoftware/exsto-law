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
  // Sign-up "details" step (PORTAL signup part 2) — client-level facts written
  // onto the client_contact. Optional; omitted → nothing extra is written.
  clientMailingAddress?: unknown | null
  clientBusinessAddress?: unknown | null
  clientPreferredContactMethod?: string | null
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
      client_mailing_address: input.clientMailingAddress ?? null,
      client_business_address: input.clientBusinessAddress ?? null,
      client_preferred_contact_method: input.clientPreferredContactMethod ?? null,
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

// PORTAL-1 (WP4) — prefill for a signed-in repeat booking: the client's most
// recent questionnaire answers, preferring the same service. Only the client's
// OWN responses (via their matters' response_of links); the client edits and
// confirms before submitting.
export async function getClientIntakePrefill(
  ctx: ActionContext,
  clientContactId: string,
  serviceKey?: string | null,
): Promise<Record<string, unknown> | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      responses: Record<string, unknown> | null
      form: string | null
    }>(
      `SELECT
         (SELECT a.value FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = qr.id
              AND akd.kind_name = 'questionnaire_responses'
            ORDER BY a.valid_from DESC LIMIT 1) AS responses,
         (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = qr.id
              AND akd.kind_name = 'intake_form_id'
            ORDER BY a.valid_from DESC LIMIT 1) AS form
       FROM relationship cof
       JOIN relationship_kind_definition cofk ON cofk.id = cof.relationship_kind_id
       JOIN relationship rof ON rof.target_entity_id = cof.target_entity_id
       JOIN relationship_kind_definition rofk ON rofk.id = rof.relationship_kind_id
       JOIN entity qr ON qr.id = rof.source_entity_id
       JOIN entity_kind_definition qrk ON qrk.id = qr.entity_kind_id
       WHERE cof.tenant_id = $1 AND cof.source_entity_id = $2
         AND cofk.kind_name = 'client_of'
         AND rofk.kind_name = 'response_of'
         AND qrk.kind_name = 'questionnaire_response'
       ORDER BY (CASE WHEN $3::text IS NOT NULL AND (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = $1 AND a.entity_id = qr.id
              AND akd.kind_name = 'intake_form_id'
            ORDER BY a.valid_from DESC LIMIT 1) = $3 THEN 0 ELSE 1 END),
         qr.created_at DESC
       LIMIT 1`,
      [ctx.tenantId, clientContactId, serviceKey ?? null],
    )
    const row = res.rows[0]
    if (!row?.responses || typeof row.responses !== 'object') return null
    return row.responses
  })
}
