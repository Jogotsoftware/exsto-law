-- =============================================================================
-- Vertical migration 0171: transcript_content_hash attribute kind (WP B2)
--
-- Content-keyed transcript dedupe — the poisoned-memory fix. The manual-paste
-- path (api/recordManualCall.ts) mints a fresh `manual-${randomUUID()}`
-- granola_call_id on EVERY submission, so call.ingest's existing id-based
-- dedupe (findCallByGranolaId, unchanged) never catches an attorney re-pasting
-- the SAME transcript onto the SAME matter: each re-paste created a second
-- call_session + transcript entity, re-ran the Claude extraction capability,
-- and double-wrote ai_summary/ai_extraction notes into client memory — the
-- handler's own P11 comment already flagged this as a known gap.
-- handlers/call.ts now hashes the whitespace-normalized transcript_text and
-- checks it, scoped to the matter, before creating anything. Same content on
-- a DIFFERENT matter is deliberately still allowed (a copy-paste mistake
-- caught and correctly re-filed is not the poisoning case this closes).
--
-- DEFINITION ONLY — data-only, zero DDL (schema-as-data, CLAUDE.md hard rule
-- 8 / exsto-add-kind). One attribute_kind_definition row per tenant that
-- already has the `transcript` entity kind, mirroring 0168's DISTINCT
-- tenant_id catch-up pattern so every existing tenant gets the kind, not just
-- tenant zero. attribute_kind_definition carries no action_id FK, so (unlike
-- 0136/0161/0168's permission_scope_definition changes) no per-tenant
-- system-actor/config.change action row is needed here — a plain
-- INSERT ... SELECT over entity_kind_definition covers every tenant.
--
-- NO BACKFILL. Existing transcripts stay unhashed — this dedupe protects the
-- future, it does not retroactively fingerprint history. The handler
-- tolerates this kind not existing at all (an environment where this
-- migration hasn't landed yet): both the hash write and the hash lookup
-- degrade to a no-op (lookupOptionalAttributeKindId / an empty JOIN) rather
-- than throwing — see verticals/legal/src/handlers/call.ts.
--
-- Ids: tenant zero gets the fixed, fresh id
-- 00000000-0000-0000-1011-000000002100 (verified free against origin/main —
-- the highest attribute-kind id on main is 0169's brief-engine block, which
-- tops out at …002007). Every OTHER tenant gets gen_random_uuid() per row,
-- since attribute_kind_definition.id is a single global PK and a loop over
-- tenants not known at authoring time cannot reuse one fixed id (same
-- reasoning as 0161's "every other tenant" block); NOT EXISTS is the real
-- idempotency guard there, ON CONFLICT (id) is defense-in-depth.
--
-- Migration number 0171 is RESERVED for WP B2 within a parallel batch of
-- worktree sessions (siblings hold 0170 and 0172) — picked per CLAUDE.md's
-- "number above both main and prod, fresh id block" rule.
--
-- PLAN ONLY. NOT applied to prod as part of this change. No prod writes.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Tenant zero: fixed id ──────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT
  '00000000-0000-0000-1011-000000002100', '00000000-0000-0000-0000-000000000001',
  'transcript_content_hash', 'Transcript content hash',
  'SHA-256 hex digest of the whitespace-normalized transcript_text (collapse whitespace runs to a single space, trim — no other canonicalization). Written once by call.ingest on a non-dedupe ingest; read back scoped to a matter to recognize the SAME transcript re-pasted and skip re-creating the call/transcript pair and re-running extraction. A one-way digest, not itself treated as PII.',
  ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND ekd.kind_name = 'transcript' AND ekd.status = 'active'
ON CONFLICT (id) DO NOTHING;

-- ── Every OTHER existing tenant that already has the transcript entity kind
--    (0168's DISTINCT-tenant-id catch-up pattern) ───────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii)
SELECT
  gen_random_uuid(), ekd.tenant_id,
  'transcript_content_hash', 'Transcript content hash',
  'SHA-256 hex digest of the whitespace-normalized transcript_text (collapse whitespace runs to a single space, trim — no other canonicalization). Written once by call.ingest on a non-dedupe ingest; read back scoped to a matter to recognize the SAME transcript re-pasted and skip re-creating the call/transcript pair and re-running extraction. A one-way digest, not itself treated as PII.',
  ekd.id, 'text', false
FROM entity_kind_definition ekd
WHERE ekd.kind_name = 'transcript' AND ekd.status = 'active'
  AND ekd.tenant_id <> '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_kind_definition a
    WHERE a.tenant_id = ekd.tenant_id AND a.kind_name = 'transcript_content_hash'
  );
