-- =============================================================================
-- Vertical migration 0150: Retire a standalone template (HARDENING-RESIDUALS-1
-- WP-F, item 22)
--
-- Mirrors legal.service.retire (0022) one shelf over: a template leaves the
-- Templates library and every attach/picker surface (all active reads filter
-- entity.status = 'active') while its history — and every document_draft ever
-- generated from it — stays untouched. Soft, through core, append-only.
--
-- The handler (handlers/template.ts) BLOCKS the retire while the template is
-- attached to an active service's workflow or fed by a questionnaire — the
-- attorney detaches first, then retires ("in use by X" is the error surface).
--
-- Definition only (configuration-as-data); kind.define cannot mint ACTION
-- kinds, so this is a migration in the HARDENING-RESIDUALS-1 lease (0150–0159)
-- per the #327/#328 precedent. Id block 1013-…0f50 (fresh; 0135 used 0f00–0f03).
-- Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000f50', '00000000-0000-0000-0000-000000000001',
   'legal.template.retire', 'Retire template', 'Soft-retire a standalone template: it leaves the Templates library and every picker (entity status flips to archived) while history and existing document drafts stay untouched. Blocked while the template is attached to an active service or questionnaire.',
   'notify', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
