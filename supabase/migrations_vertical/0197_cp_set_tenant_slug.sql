-- =============================================================================
-- Vertical migration 0197: control-plane write path for tenant.public_slug.
--
-- SLUG-PROV-1. Migration 0119 added public_slug + the public resolver, but the
-- ONLY way to assign a slug has been a hand-written UPDATE — provisioning a new
-- firm's subdomain was manual SQL. This adds private.cp_set_tenant_slug so the
-- admin console (via the controlPlane TS wrapper, which also writes the audit
-- row) can assign/rename/clear a slug, with the same is_platform_admin posture
-- as cp_bootstrap_tenant (0101).
--
-- Validation is re-encoded here from verticals/legal/src/lib/publicSlug.ts
-- (regex + reserved labels): SQL can't import the TS module, and the DB must
-- reject a bad slug even if a future caller skips the TS validation. Keep the
-- two in sync.
--
-- Also recreates cp_list_tenants / cp_get_tenant to expose public_slug (console
-- display). DROP + CREATE because CREATE OR REPLACE cannot change a function's
-- return table. No new kinds; functions only. 0197 is above main+prod max
-- (0196). Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.cp_set_tenant_slug(
  p_platform_actor uuid,
  p_tenant_id uuid,
  p_slug text
)
RETURNS TABLE (id uuid, public_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
BEGIN
  IF NOT private.is_platform_admin(p_platform_actor) THEN
    RAISE EXCEPTION 'not a platform admin';
  END IF;

  -- NULL/blank clears the slug (the firm loses its subdomain; resolver stops
  -- matching). Otherwise normalize exactly like the TS validator.
  v_slug := nullif(lower(btrim(p_slug)), '');

  IF v_slug IS NOT NULL THEN
    IF v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN
      RAISE EXCEPTION 'invalid slug: %', v_slug USING ERRCODE = '22023';
    END IF;
    IF v_slug = ANY (ARRAY[
      'www','app','api','admin','login','signin','signup','auth',
      'mail','smtp','imap','pop','mx','webmail','ns1','ns2','autodiscover','autoconfig',
      'dev','staging','test','demo','sandbox','preview',
      'portal','book','sign','docs','help','support','status','blog',
      'cdn','static','assets','dashboard','console','internal','billing','pay',
      'exsto','instruments','legal'
    ]) THEN
      RAISE EXCEPTION 'reserved slug: %', v_slug USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    RETURN QUERY
    UPDATE public.tenant t
       SET public_slug = v_slug
     WHERE t.id = p_tenant_id
    RETURNING t.id, t.public_slug;
  EXCEPTION WHEN unique_violation THEN
    -- tenant_public_slug_key (0119): another firm already owns this handle.
    RAISE EXCEPTION 'slug taken: %', v_slug USING ERRCODE = '23505';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown tenant: %', p_tenant_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.cp_set_tenant_slug(uuid, uuid, text) FROM PUBLIC, anon;

-- Console reads gain the slug column. Return-table changes require DROP+CREATE;
-- the TS wrappers ship in the same PR, so no caller sees the gap.
DROP FUNCTION IF EXISTS private.cp_list_tenants(uuid);
CREATE FUNCTION private.cp_list_tenants(p_platform_actor uuid)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz, public_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.name, t.status, t.created_at, t.public_slug
  FROM public.tenant t
  WHERE private.is_platform_admin(p_platform_actor)
  ORDER BY t.created_at
$$;
REVOKE ALL ON FUNCTION private.cp_list_tenants(uuid) FROM PUBLIC, anon;

DROP FUNCTION IF EXISTS private.cp_get_tenant(uuid, uuid);
CREATE FUNCTION private.cp_get_tenant(p_platform_actor uuid, p_tenant_id uuid)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz,
               actor_count bigint, human_count bigint, public_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.name, t.status, t.created_at,
         (SELECT count(*) FROM public.actor a WHERE a.tenant_id = t.id),
         (SELECT count(*) FROM public.actor a WHERE a.tenant_id = t.id AND a.actor_type = 'human'),
         t.public_slug
  FROM public.tenant t
  WHERE private.is_platform_admin(p_platform_actor)
    AND t.id = p_tenant_id
$$;
REVOKE ALL ON FUNCTION private.cp_get_tenant(uuid, uuid) FROM PUBLIC, anon;
