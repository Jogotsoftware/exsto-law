import { withActionContext, type ActionContext } from '@exsto/substrate'

// Matter-set resolvers for the attorney client/contact detail tabs. They return
// the SAME matter sets the overview panels show (getClient/getContact), so the
// Documents and Activity tabs are consistent with the Matters panel above them.

// A client (parent entity) has matters via matter_of (matter → client) — the
// same link getClient reads.
export async function resolveClientMatterEntityIds(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<string[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ matter_id: string }>(
      `SELECT r.source_entity_id AS matter_id
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE r.tenant_id = $1 AND r.target_entity_id = $2
          AND rkd.kind_name = 'matter_of'
          AND (r.valid_to IS NULL OR r.valid_to > now())`,
      [ctx.tenantId, clientEntityId],
    )
    return res.rows.map((r) => r.matter_id)
  })
}

// A contact (client_contact entity) has matters via client_of (contact → matter,
// live intake) or matter_has_client (matter → contact, legacy booking) — in
// either direction, the same union getContact reads.
export async function resolveContactMatterEntityIds(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<string[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ matter_id: string }>(
      `SELECT DISTINCT
         CASE WHEN r.source_entity_id = $2 THEN r.target_entity_id ELSE r.source_entity_id END
           AS matter_id
         FROM relationship r
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE r.tenant_id = $1
          AND rkd.kind_name IN ('client_of', 'matter_has_client')
          AND (r.valid_to IS NULL OR r.valid_to > now())
          AND (r.source_entity_id = $2 OR r.target_entity_id = $2)`,
      [ctx.tenantId, contactEntityId],
    )
    return res.rows.map((r) => r.matter_id)
  })
}
