-- =============================================================================
-- Migration 0020: Security hardening — pin function search_path + relocate vector
-- Resolves the 5 Supabase security-advisor warnings (all WARN, EXTERNAL-facing):
--   (1) function_search_path_mutable  public.sync_migration_history
--   (2) function_search_path_mutable  public.substrate_block_write
--   (3) function_search_path_mutable  public.substrate_block_delete
--   (4) function_search_path_mutable  public.substrate_seal_guard
--   (5) extension_in_public           extension `vector` installed in public
--
-- (1-4) A role-mutable search_path lets a caller prepend a schema and shadow a
-- built-in the function relies on. We pin search_path to empty on all four. This
-- is safe with NO behavior change because each function either references nothing
-- schema-bound or fully-qualifies what it touches:
--   * substrate_block_write / substrate_block_delete  — only RAISE + TG_* tags.
--   * substrate_seal_guard                            — only to_jsonb() (pg_catalog,
--       always resolvable regardless of search_path) + NEW/OLD.
--   * sync_migration_history                          — already qualifies
--       public.schema_migration and supabase_migrations.schema_migrations; all
--       other calls (md5, array_to_string, to_timestamp, coalesce, now) are
--       pg_catalog built-ins.
--
-- (5) pgvector lived in `public`. Relocate it to the dedicated `extensions`
-- schema, which is already on the cluster default search_path
-- ("$user", public, extensions) and on which the app roles already hold USAGE.
-- The `vector` type, its operators, the `vector_cosine_ops` opclass, the
-- content_embedding.embedding column, and the HNSW index all depend on the
-- extension by OID, so relocation preserves them with no code change.
-- =============================================================================

-- (1-4) Pin search_path on the substrate guard + migration-history functions.
ALTER FUNCTION public.substrate_block_write()  SET search_path = '';
ALTER FUNCTION public.substrate_block_delete() SET search_path = '';
ALTER FUNCTION public.substrate_seal_guard()   SET search_path = '';
ALTER FUNCTION public.sync_migration_history() SET search_path = '';

-- (5) Move pgvector out of the public schema.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Record this migration in the queryable history (invariant 12).
SELECT public.sync_migration_history();
