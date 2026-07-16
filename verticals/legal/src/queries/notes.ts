// MACHINE-COMMS-1 (WP1) — the notes read surface. Notes attach to a matter or a
// client via note_of; the body/source are latest-open attributes; the author comes
// from the creating action's actor (provenance, not a duplicated field).
import { withActionContext, type ActionContext } from '@exsto/substrate'

export interface NoteSummary {
  noteEntityId: string
  body: string
  source: string // attorney | ai_summary | ai_extraction
  authorName: string | null
  authorType: string | null // human | agent | system
  aboutEntityId: string | null
  aboutEntityKind: string | null
  createdAt: string
}

// Active notes attached to ONE entity (a matter or a client), newest first.
export async function listNotesForEntity(
  ctx: ActionContext,
  targetEntityId: string,
): Promise<NoteSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      note_id: string
      body: string | null
      source: string | null
      author_name: string | null
      author_type: string | null
      about_id: string | null
      about_kind: string | null
      created_at: string
    }>(
      `SELECT
         n.id AS note_id,
         (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
           WHERE a.tenant_id = n.tenant_id AND a.entity_id = n.id
             AND ak.kind_name = 'note_body' AND a.valid_to IS NULL
           ORDER BY a.valid_from DESC LIMIT 1) AS body,
         (SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
           WHERE a.tenant_id = n.tenant_id AND a.entity_id = n.id
             AND ak.kind_name = 'note_source' AND a.valid_to IS NULL
           ORDER BY a.valid_from DESC LIMIT 1) AS source,
         act.display_name AS author_name,
         act.actor_type AS author_type,
         about_r.target_entity_id AS about_id,
         about_kind.kind_name AS about_kind,
         to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at
       FROM entity n
       JOIN entity_kind_definition ekd ON ekd.id = n.entity_kind_id AND ekd.kind_name = 'note'
       JOIN relationship r ON r.source_entity_id = n.id AND r.target_entity_id = $2
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            AND rkd.kind_name = 'note_of'
       LEFT JOIN action ac ON ac.id = n.action_id
       LEFT JOIN actor act ON act.id = ac.actor_id
       LEFT JOIN relationship about_r
              ON about_r.source_entity_id = n.id
             AND about_r.relationship_kind_id =
                 (SELECT id FROM relationship_kind_definition
                   WHERE tenant_id = n.tenant_id AND kind_name = 'note_about' LIMIT 1)
       LEFT JOIN entity about_e ON about_e.id = about_r.target_entity_id
       LEFT JOIN entity_kind_definition about_kind ON about_kind.id = about_e.entity_kind_id
       WHERE n.tenant_id = $1 AND n.status = 'active'
       ORDER BY n.created_at DESC`,
      [ctx.tenantId, targetEntityId],
    )
    return res.rows.map((row) => ({
      noteEntityId: row.note_id,
      body: row.body ?? '',
      source: row.source ?? 'attorney',
      authorName: row.author_name,
      authorType: row.author_type,
      aboutEntityId: row.about_id,
      aboutEntityKind: row.about_kind,
      createdAt: row.created_at,
    }))
  })
}
