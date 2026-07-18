// Brief engine WP2 — the brief read surface (design: scratchpad
// brief-engine-design.md §3/§5). A brief is a runtime-defined `brief` entity
// (migration 0169) attached to its target (matter / client / service) via
// `brief_of`; the body and generation metadata are latest-open attributes,
// superseded on every regeneration (history retained).
//
// READ-ONLY and PRE-MIGRATION-SAFE: every join keys on kind_name, so against a
// database where migration 0169 has not been applied yet the joins simply match
// nothing and the read returns null — never an error. That is the contract the
// legal.matter.brief.get tool (and the BriefButton first-run state) relies on.
import { withActionContext, type ActionContext } from '@exsto/substrate'

export type BriefType = 'matter' | 'client' | 'service_digest'

// One structured section of a synthesized brief (the design's sections contract).
export interface BriefSection {
  heading: string
  body: string
  // The model's honest confidence in THIS section, in [0,1).
  confidence: number
  // Substrate references ("entity:<id>" / source tags) the section drew on.
  sourceRefs: string[]
  // True when the section carries verbatim quoted wording (founder decision 4:
  // quotes only where exact wording matters — commitments, deadlines, admissions).
  quoted: boolean
}

// The stored (persisted) brief, as read back from the substrate.
export interface StoredBrief {
  briefEntityId: string
  briefType: BriefType
  markdown: string
  sections: BriefSection[]
  generatedAt: string | null
  sourceWatermark: string | null
  modelIdentity: string | null
  confidence: number | null
  // Client Brief only (WP3) — the raw brief_research_json attribute value,
  // RAW/untyped here (this is the read-only substrate layer; api/
  // briefResearchGuard.ts owns the typed BriefResearchRecord shape + its
  // tolerant parser, matching how parseStoredSections/BriefSection stay local
  // to this file while the api layer owns richer semantics). Optional so the
  // pre-WP3 matter-brief fixtures/tests need no change: absent ⇒ untouched.
  researchJson?: unknown | null
}

// Latest-open attribute value subselect (the notes.ts shape). Kept as a helper
// string so the eight attribute reads stay visibly identical.
function attr(kindName: string): string {
  return `(SELECT a.value FROM attribute a
      JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
     WHERE a.tenant_id = b.tenant_id AND a.entity_id = b.id
       AND ak.kind_name = '${kindName}' AND a.valid_to IS NULL
     ORDER BY a.valid_from DESC LIMIT 1)`
}

function asText(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Tolerant sections reader: the stored brief_json is model-shaped upstream
// (api/briefEngine.ts normalizes before persisting), but reads stay defensive —
// a malformed row degrades to an empty list, never a throw on the read path.
export function parseStoredSections(v: unknown): BriefSection[] {
  if (!Array.isArray(v)) return []
  const out: BriefSection[] = []
  for (const s of v) {
    if (!s || typeof s !== 'object') continue
    const r = s as Record<string, unknown>
    out.push({
      heading: typeof r.heading === 'string' ? r.heading : '',
      body: typeof r.body === 'string' ? r.body : '',
      confidence:
        typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : 0.5,
      sourceRefs: Array.isArray(r.sourceRefs)
        ? r.sourceRefs.filter((x): x is string => typeof x === 'string')
        : [],
      quoted: r.quoted === true,
    })
  }
  return out
}

// The live brief for (target, type), or null when none has been generated yet
// (or the brief kinds are not seeded in this database yet — same null).
export async function getBriefForTarget(
  ctx: ActionContext,
  targetEntityId: string,
  briefType: BriefType,
): Promise<StoredBrief | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      brief_id: string
      markdown: unknown
      sections: unknown
      generated_at: unknown
      watermark: unknown
      model_identity: unknown
      confidence: unknown
      research_json: unknown
    }>(
      `SELECT
         b.id AS brief_id,
         ${attr('brief_markdown')} AS markdown,
         ${attr('brief_json')} AS sections,
         ${attr('brief_generated_at')} AS generated_at,
         ${attr('brief_source_watermark')} AS watermark,
         ${attr('brief_model_identity')} AS model_identity,
         ${attr('brief_confidence')} AS confidence,
         ${attr('brief_research_json')} AS research_json
       FROM entity b
       JOIN entity_kind_definition ekd ON ekd.id = b.entity_kind_id AND ekd.kind_name = 'brief'
       JOIN relationship r ON r.source_entity_id = b.id AND r.target_entity_id = $2
            AND (r.valid_to IS NULL OR r.valid_to > now())
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            AND rkd.kind_name = 'brief_of'
       WHERE b.tenant_id = $1 AND b.status = 'active'
         AND ${attr('brief_type')} #>> '{}' = $3
       ORDER BY b.created_at ASC
       LIMIT 1`,
      [ctx.tenantId, targetEntityId, briefType],
    )
    const row = res.rows[0]
    if (!row) return null
    return {
      briefEntityId: row.brief_id,
      briefType,
      markdown: asText(row.markdown) ?? '',
      sections: parseStoredSections(row.sections),
      generatedAt: asText(row.generated_at),
      sourceWatermark: asText(row.watermark),
      modelIdentity: asText(row.model_identity),
      confidence: asNumber(row.confidence),
      researchJson: row.research_json ?? null,
    }
  })
}
