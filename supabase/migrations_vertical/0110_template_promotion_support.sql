-- =============================================================================
-- Vertical migration 0110: promotion support — cross-tenant template-library reader
--
-- Extends ADR 0046 §6 promotion from services-only to the firm's standalone
-- document/email TEMPLATE library. A `template` is an entity (kind 'template',
-- migration 0023) carrying name/category/body/doc_kind/variables attributes — the
-- reusable library an attorney composes services from. To promote one sandbox→prod
-- the control plane reads it here and REPLAYS it through the target's
-- submitAction(legal.template.create/update) — never a cross-tenant SQL copy.
-- A template entity holds no outbound UUID refs to other kinds, so it promotes
-- standalone keyed by (category, name); no remap needed.
--
-- This adds only the guarded cross-tenant READER (writes go through existing
-- handlers). Guarded by is_platform_admin exactly like 0106's cp_list_workflows;
-- the body mirrors verticals/legal/src/queries/templates.ts TEMPLATE_SELECT,
-- parameterized by tenant. No new tables.
--
-- Number 0110 = next free after origin/main's max 0109; re-checked before
-- authoring. Vertical files are checksum-immutable once applied — forward-only.
-- =============================================================================

-- Active standalone templates (document/email library) for any tenant — platform
-- admins only. Returns the full promotable shape (name, category, body, doc_kind,
-- variables) keyed by the stable (category, name); the entity id is tenant-local
-- and is NOT the promotion key (the target's same-named template is resolved fresh).
CREATE OR REPLACE FUNCTION private.cp_list_templates(p_platform_actor uuid, p_tenant_id uuid)
RETURNS TABLE (
  template_entity_id uuid,
  name text,
  category text,
  body text,
  doc_kind text,
  variables jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM public.attribute a
    JOIN public.attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = p_tenant_id
    ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_name'),
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_category'),
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_body'),
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_doc_kind'),
    (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'template_variables')
  FROM public.entity e
  JOIN public.entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'template'
  WHERE private.is_platform_admin(p_platform_actor)
    AND e.tenant_id = p_tenant_id
    AND e.status = 'active'
$$;

REVOKE ALL ON FUNCTION private.cp_list_templates(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cp_list_templates(uuid, uuid) TO authenticated;

SELECT public.sync_migration_history();
