-- =============================================================================
-- Vertical migration 0169: Brief engine kinds (Brief engine WP2 — Matter Brief)
--
-- Design: scratchpad brief-engine-design.md §3 (Persistence & caching). The Brief
-- engine synthesizes an attorney-readable narrative over the WP1 EvidenceBundle,
-- then PERSISTS it (cached, versioned, refreshable) so the assistant and drafting
-- can read a stable, cheap prefix instead of re-assembling every turn. A brief is
-- a runtime-defined `brief` ENTITY (schema-as-data, CLAUDE.md hard rule 8) — NO new
-- tables. WP2 ships the MATTER scope; the same kinds serve WP3 (client) and WP4
-- (service_digest) — brief_type discriminates, brief_of is poly-target, and
-- brief_research_json is defined here (nullable, Client-Brief-only) so WP3 needs no
-- second migration.
--
-- One LIVE brief per (target, brief_type): the legal.brief.generate action creates
-- the brief entity the first time and SUPERSEDES its attributes on every regen
-- (append-only — prior versions stay queryable, effective-dated by valid_from).
-- Every generation is an AI operation with a REAL reasoning trace
-- (requires_reasoning_trace=true; exsto-ai-operation) — model identity + honest
-- confidence < 1.0 recorded on the trace and on brief_confidence.
--
-- STALENESS (design §3): the action's payload carries `target_entity_id`, NOT
-- `matter_entity_id` — deliberately, so a brief generation NEVER lands in the
-- matter's own timeline (getMatterHistory keys on payload->>'matter_entity_id')
-- and therefore never bumps the matter watermark that staleness compares against.
-- A brief is a derived read, not matter activity.
--
-- Id block 2000 (entity 1010-...002000, attributes 1011-...002000..2007,
-- relationship 1012-...002000, action 1013-...002000): verified FREE on origin/main
-- migration files (0000000020xx unused; frontier migration 0168) and picked ABOVE
-- both the file frontier and the highest recorded ledger version. Configuration-as-
-- data; every insert idempotent via ON CONFLICT (id) DO NOTHING. Seeds tenant-zero
-- (dev, 0001) per the established feature-migration convention; cross-tenant kind
-- provisioning rides the normal bootstrap/replay path.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── brief entity kind ────────────────────────────────────────────────────────
-- supports_temporal_state=true: a brief has a live body that supersedes over time
-- (its history is the version trail). No judgments/outcomes; no accounting period.
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000002000', '00000000-0000-0000-0000-000000000001',
   'brief', 'Brief',
   'A synthesized, attorney-readable narrative over a matter / client / service — cached, versioned, refreshable. Body in brief_markdown, structured sections in brief_json.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── brief attributes ─────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000002000', '00000000-0000-0000-0000-000000000001',
   'brief_type', 'Brief type',
   'matter | client | service_digest — which scope this brief synthesizes.',
   '00000000-0000-0000-1010-000000002000', 'text', false),
  ('00000000-0000-0000-1011-000000002001', '00000000-0000-0000-0000-000000000001',
   'brief_markdown', 'Brief markdown',
   'The rendered brief, attorney-readable markdown. Superseded on every regeneration.',
   '00000000-0000-0000-1010-000000002000', 'text', false),
  ('00000000-0000-0000-1011-000000002002', '00000000-0000-0000-0000-000000000001',
   'brief_json', 'Brief sections (structured)',
   'The structured sections the markdown renders from: [{heading, body, confidence, sourceRefs, quoted}].',
   '00000000-0000-0000-1010-000000002000', 'json', false),
  ('00000000-0000-0000-1011-000000002003', '00000000-0000-0000-0000-000000000001',
   'brief_generated_at', 'Generated at',
   'When this brief body was synthesized (exact_instant).',
   '00000000-0000-0000-1010-000000002000', 'datetime', false),
  ('00000000-0000-0000-1011-000000002004', '00000000-0000-0000-0000-000000000001',
   'brief_source_watermark', 'Source watermark',
   'The EvidenceBundle watermark (max source recorded_at) this brief was built from — the staleness key.',
   '00000000-0000-0000-1010-000000002000', 'datetime', false),
  ('00000000-0000-0000-1011-000000002005', '00000000-0000-0000-0000-000000000001',
   'brief_model_identity', 'Model identity',
   'The Claude model that synthesized this brief (audit / calibration across model upgrades).',
   '00000000-0000-0000-1010-000000002000', 'text', false),
  ('00000000-0000-0000-1011-000000002006', '00000000-0000-0000-0000-000000000001',
   'brief_confidence', 'Confidence',
   'The model''s honest overall confidence in the brief, in [0,1) — never 1.0.',
   '00000000-0000-0000-1010-000000002000', 'number', false),
  ('00000000-0000-0000-1011-000000002007', '00000000-0000-0000-0000-000000000001',
   'brief_research_json', 'External research (Client Brief only)',
   'Nullable — Client Brief only (WP3): external findings + the exact outbound queries that left the firm.',
   '00000000-0000-0000-1010-000000002000', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- ── brief_of relationship (brief -> matter | client | service entity) ─────────
-- Poly-target (target_entity_kind_id NULL, like note_of): a brief attaches to a
-- matter, a client, or a service entity; brief_type disambiguates. One ACTIVE
-- brief per (target, type) is enforced by the handler (supersession), not the kind.
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000002000', '00000000-0000-0000-0000-000000000001',
   'brief_of', 'Brief of', 'Attaches a brief to the matter, client, or service it summarizes.',
   '00000000-0000-0000-1010-000000002000', NULL,
   'many_to_one', 'directed', 'has_brief')
ON CONFLICT (id) DO NOTHING;

-- ── legal.brief.generate action (AI operation — requires a reasoning trace) ────
-- default_autonomy_tier 'notify': a moderate derived write (no external side
-- effect). requires_reasoning_trace=true: every generation records model identity
-- + honest confidence + evidence, linked to the action (exsto-ai-operation). The
-- handler create-or-supersedes the brief entity + attributes in-transaction.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000002000', '00000000-0000-0000-0000-000000000001',
   'legal.brief.generate', 'Generate brief',
   'Synthesize (or refresh) a brief over a matter / client / service and persist it (create first time, supersede after).',
   'notify', 'fully_reversible', NULL, true)
ON CONFLICT (id) DO NOTHING;
