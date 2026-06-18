-- =============================================================================
-- Vertical migration 0035 (Session 3 / Comms — WP3.4, Objective 6):
-- Deterministic template-merge generation alongside AI drafting.
--
-- Submit-time document generation gains a SECOND path. Until now every draft
-- went through the model (draft.generate, which requires a reasoning trace). A
-- large class of documents — engagement letters, standard notices, fixed-form
-- agreements — is fully determined by structured intake + matter facts and needs
-- NO model call. This migration defines the substrate KINDS that path writes:
--
--   * attribute_kind `generation_mode` (on document_draft) — records HOW each
--     draft was produced ('ai_draft' | 'template_merge'), so the audit trail
--     names the METHOD, not only the output. Read by the review UI and receipts.
--
--   * action_kind `draft.merge` — deterministically renders a configured
--     template with matter + questionnaire data. NO model call, therefore
--     requires_reasoning_trace = FALSE: a deterministic render has no model
--     reasoning to trace (writing a fake trace would violate the substrate's
--     honesty contract). Governance otherwise mirrors draft.generate (autonomous,
--     reversible_with_state_decay) and it produces the SAME document_draft +
--     document_version v1 (pending_review) the review flow already understands.
--
-- The per-document generation_mode VALUE lives in the service/workflow config
-- (Contract G, owned by the templates/questionnaire session). The generation
-- worker READS it and defaults to 'ai_draft' when absent, so the existing AI
-- flow is unchanged until that config is set. This migration adds only the kinds
-- those paths write — seeding generation_mode into a service is the config
-- owner's change, not ours.
--
-- IDs verified collision-free against the live pilot DB (2026-06):
--   attribute_kind 1011 band max = 046  -> 047 free
--   action_kind    1013 band max = 029  -> 030 free
-- Configuration-as-data (schema-as-data, CLAUDE.md hard rule 8); idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- generation_mode: how a document_draft was produced. Bound to the document_draft
-- entity kind so it reads as a first-class draft attribute.
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, value_type, on_entity_kind_id) VALUES
  ('00000000-0000-0000-1011-000000000047', '00000000-0000-0000-0000-000000000001',
   'generation_mode', 'Generation mode',
   'How this draft was produced: ai_draft (model call, carries a linked reasoning trace) or template_merge (deterministic render of a configured template, no model call).',
   'text',
   (SELECT id FROM entity_kind_definition
      WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
        AND kind_name = 'document_draft' AND status = 'active'
      ORDER BY valid_from DESC LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- draft.merge: deterministic template merge. Mirrors draft.generate's governance
-- but requires NO reasoning trace — there is no model reasoning to record for a
-- deterministic render.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000030', '00000000-0000-0000-0000-000000000001',
   'draft.merge', 'Generate draft by template merge',
   'Deterministically render a configured document template with matter + questionnaire data. No model call, no reasoning trace. Produces a document_draft + version v1 (pending_review), identical downstream to draft.generate.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
