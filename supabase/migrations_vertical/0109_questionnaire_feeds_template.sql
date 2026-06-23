-- =============================================================================
-- Vertical migration 0109: questionnaire → document-template association
--
-- Beta feedback (e0b08543 / 41b365c1): a questionnaire should carry a first-class
-- link to the document template(s) it feeds — so the attorney can see which
-- template(s) a questionnaire fills, and answers flow into those drafts. This
-- registers the binding as a relationship (queryable as a graph), per
-- schema-as-data: a questionnaire_template entity → one or more template entities.
--
--   • relationship kind  questionnaire_feeds_template (questionnaire_template →
--     template, many_to_many, inverse template_fed_by_questionnaire).
--   • action kind        legal.questionnaire_template.set_templates — one "set the
--     set" operation (close removed edges via valid_to, insert added edges) in a
--     single recorded action, mirroring contact.set_company (migration 0067).
--
-- Ids: relationship 1012-…0b00, action 1013-…0b00 (the 0b block, verified free on
-- origin/main across all registries — clear of the actively-filling 0a range).
-- Configuration-as-data; idempotent (fixed ids + ON CONFLICT DO NOTHING).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000b00', '00000000-0000-0000-0000-000000000001',
   'questionnaire_feeds_template', 'Questionnaire feeds template',
   'A questionnaire_template feeds one or more document templates: its answers fill those drafts, and the attorney sees which template(s) correspond to the questionnaire. A template may be fed by many questionnaires.',
   '00000000-0000-0000-1010-000000000700',   -- source: questionnaire_template
   '00000000-0000-0000-1010-000000000008',   -- target: template
   'many_to_many', 'directed', 'template_fed_by_questionnaire')
ON CONFLICT (id) DO NOTHING;

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000b00', '00000000-0000-0000-0000-000000000001',
   'legal.questionnaire_template.set_templates', 'Set questionnaire templates',
   'Set the exact set of document templates a questionnaire feeds (questionnaire_feeds_template edges): closes removed edges (valid_to) and inserts added ones, append-only, in one action.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
