-- =============================================================================
-- Migration 0073: RBAC scope enforcement at the DB layer (S9 — WP9.2)
--
-- The RBAC PRIMITIVES already exist (permission_scope_definition,
-- actor_scope_assignment, role_definition, role_assignment) but NOTHING
-- enforced them: submitAction never consulted a scope, and reads were gated
-- only by tenant RLS. This migration makes scopes bite, the same way tenant
-- isolation already does — in Postgres, as defense the application layer cannot
-- forget (ARCHITECTURE.md: enforce at the DB). It adds NO new substrate code;
-- it is the foundation-aligned enforcement Joe approved routing through a
-- migration (the matching upstream upgrade-request is in docs/upgrades/).
--
-- Model — scopes are OPT-IN restrictions, so this is backward-compatible:
--   * An actor with ZERO active actor_scope_assignment rows is UNRESTRICTED
--     (today's behavior — system/agent/worker/existing humans keep full access).
--   * Once an actor has >=1 active scope, they are limited to the UNION of those
--     scopes: actions whose kind is listed (or '*'), and reads of entity kinds
--     listed (or '*'). An empty action_kinds/entity_kinds list grants none of
--     that surface (e.g. a read-only scope lists entity_kinds, no action_kinds).
--
-- Enforced as AS RESTRICTIVE policies (AND-combined with the permissive tenant
-- policies; a second permissive policy would weaken, not strengthen). Writes are
-- gated on the action INSERT (block the action -> block its effects, since every
-- effect rides the action's transaction). Reads are gated on entity / attribute
-- / relationship — where substrate state lives. RESTRICTIVE policies, like all
-- RLS, are bypassed by BYPASSRLS roles (owner / service_role) and bite for the
-- runtime's `authenticated` role (SUBSTRATE_DB_ROLE=authenticated, ADR 0037).
--
-- Helpers live in the `private` schema (like private.auth_resolve_api_key) so
-- PostgREST does NOT expose them as RPC — SECURITY DEFINER functions in `public`
-- are callable by anon/authenticated and trip the database linter. RLS policies
-- (evaluated in-engine, not over REST) still reference them fine.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- The acting actor from the request's session GUC (set by withTenant). NULL when
-- unset (migration / superuser paths, which bypass RLS anyway) -> unrestricted.
CREATE OR REPLACE FUNCTION private.current_actor_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = private, public, pg_temp
AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid;
$$;

-- An actor is "restricted" once it carries at least one active scope assignment.
CREATE OR REPLACE FUNCTION private.actor_is_scope_restricted(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.actor_scope_assignment asa
    WHERE asa.actor_id = p_actor_id AND (asa.valid_to IS NULL OR asa.valid_to > now())
  );
$$;

-- May this actor run an action of the given kind?
CREATE OR REPLACE FUNCTION private.actor_may_run_action(p_actor_id uuid, p_action_kind_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_actor_id IS NULL THEN true
    WHEN NOT private.actor_is_scope_restricted(p_actor_id) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.actor_scope_assignment asa
      JOIN public.permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      JOIN public.action_kind_definition akd ON akd.id = p_action_kind_id
      WHERE asa.actor_id = p_actor_id
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND (psd.action_kinds ? '*' OR psd.action_kinds ? akd.kind_name)
    )
  END;
$$;

-- May this actor read entities (and their state) of the given entity kind?
CREATE OR REPLACE FUNCTION private.actor_may_read_entity_kind(p_actor_id uuid, p_entity_kind_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_actor_id IS NULL THEN true
    WHEN NOT private.actor_is_scope_restricted(p_actor_id) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.actor_scope_assignment asa
      JOIN public.permission_scope_definition psd ON psd.id = asa.permission_scope_definition_id
      JOIN public.entity_kind_definition ekd ON ekd.id = p_entity_kind_id
      WHERE asa.actor_id = p_actor_id
        AND (asa.valid_to IS NULL OR asa.valid_to > now())
        AND (psd.valid_to IS NULL OR psd.valid_to > now())
        AND (psd.entity_kinds ? '*' OR psd.entity_kinds ? ekd.kind_name)
    )
  END;
$$;

-- Convenience: readability of a specific entity (resolves its kind).
CREATE OR REPLACE FUNCTION private.actor_may_read_entity(p_actor_id uuid, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.actor_may_read_entity_kind(
    p_actor_id,
    (SELECT e.entity_kind_id FROM public.entity e WHERE e.id = p_entity_id)
  );
$$;

GRANT EXECUTE ON FUNCTION private.current_actor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.actor_is_scope_restricted(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.actor_may_run_action(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.actor_may_read_entity_kind(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.actor_may_read_entity(uuid, uuid) TO authenticated;

-- Drop the policies first (they would depend on any prior public.* helpers), so
-- an earlier draft of this migration that created public functions can be cleaned
-- up. Then (re)create the policies referencing the private helpers.
DROP POLICY IF EXISTS action_scope_enforcement_insert ON public.action;
DROP POLICY IF EXISTS entity_scope_enforcement_select ON public.entity;
DROP POLICY IF EXISTS attribute_scope_enforcement_select ON public.attribute;
DROP POLICY IF EXISTS relationship_scope_enforcement_select ON public.relationship;

DROP FUNCTION IF EXISTS public.current_actor_id();
DROP FUNCTION IF EXISTS public.actor_is_scope_restricted(uuid);
DROP FUNCTION IF EXISTS public.actor_may_run_action(uuid, uuid);
DROP FUNCTION IF EXISTS public.actor_may_read_entity_kind(uuid, uuid);
DROP FUNCTION IF EXISTS public.actor_may_read_entity(uuid, uuid);

-- Write gate: every substrate write is an action; gate the action INSERT.
CREATE POLICY action_scope_enforcement_insert ON public.action
  AS RESTRICTIVE FOR INSERT
  WITH CHECK ( private.actor_may_run_action(actor_id, action_kind_id) );

-- Read gates: entity (by kind), attribute (by its entity's kind), relationship
-- (by both endpoints). The cheap "is this actor restricted at all?" check
-- short-circuits the per-row work so unrestricted actors pay ~nothing.
CREATE POLICY entity_scope_enforcement_select ON public.entity
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT private.actor_is_scope_restricted(private.current_actor_id())
    OR private.actor_may_read_entity_kind(private.current_actor_id(), entity_kind_id)
  );

CREATE POLICY attribute_scope_enforcement_select ON public.attribute
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT private.actor_is_scope_restricted(private.current_actor_id())
    OR private.actor_may_read_entity(private.current_actor_id(), entity_id)
  );

CREATE POLICY relationship_scope_enforcement_select ON public.relationship
  AS RESTRICTIVE FOR SELECT
  USING (
    NOT private.actor_is_scope_restricted(private.current_actor_id())
    OR (
      private.actor_may_read_entity(private.current_actor_id(), source_entity_id)
      AND private.actor_may_read_entity(private.current_actor_id(), target_entity_id)
    )
  );

-- Self-record (invariant 12).
SELECT public.sync_migration_history();
