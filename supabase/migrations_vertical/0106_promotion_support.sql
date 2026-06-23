-- =============================================================================
-- Vertical migration 0106: promotion support — cross-tenant service reader (ADR 0046 §6)
--
-- Promotion ("build a service in the sandbox, push it to production tenants")
-- works by REPLAY, never cross-tenant SQL copy: the control plane reads a service
-- (workflow_definition) from the source tenant and re-submits it through the
-- TARGET tenant's submitAction('workflow.define'), so the promoted service lands
-- as a normal, audited action in the target, with a fresh target-local id and the
-- next version number. workflow_definition references entity kinds BY NAME
-- (participating_entity_kinds, transitions), so it promotes without UUID remapping.
--
-- This migration adds only the guarded cross-tenant READER the control plane needs
-- (the writes go through existing handlers). No new tables. Guarded by
-- is_platform_admin, exactly like the other private.cp_* functions.
--
-- Number 0106 = next after 0105.
-- =============================================================================

-- Active workflow definitions (services) for any tenant — platform admins only.
-- Used to list promotable services, diff source-vs-target, and read a source
-- service's full definition before replaying it into the target.
CREATE OR REPLACE FUNCTION private.cp_list_workflows(p_platform_actor uuid, p_tenant_id uuid)
RETURNS TABLE (
  kind_name text,
  display_name text,
  description text,
  states jsonb,
  transitions jsonb,
  participating_entity_kinds jsonb,
  version integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (w.kind_name)
         w.kind_name, w.display_name, w.description, w.states, w.transitions,
         w.participating_entity_kinds, w.version
  FROM public.workflow_definition w
  WHERE private.is_platform_admin(p_platform_actor)
    AND w.tenant_id = p_tenant_id
    AND w.valid_to IS NULL
    AND w.status = 'active'
  ORDER BY w.kind_name, w.version DESC
$$;

REVOKE ALL ON FUNCTION private.cp_list_workflows(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cp_list_workflows(uuid, uuid) TO authenticated;

SELECT public.sync_migration_history();
