-- =============================================================================
-- Vertical migration 0088: matter ownership + send authorization (PR B)
--
-- Mail-send permissions: an attorney may only send CLIENT email (compose / reply)
-- and signature requests on matters they OWN, are GRANTED access to, or as a firm
-- admin. Two schema-as-data facts on the matter carry that, written ONLY through
-- the action layer:
--   1) matter_owner            — the owning attorney's actor id (text). Assigned
--      via legal.matter.set_owner. There is no create-time stamp: the only real
--      create path is the PUBLIC matter.open (its actor is the intake actor, not an
--      attorney), and legal.matter.create is a phantom kind (0078). So new matters
--      start unowned (firm-shared — any attorney may send) until assigned. Wiring an
--      attorney-facing assignment step is the follow-up that ACTIVATES enforcement.
--   2) matter_access_actor_ids — a JSON array of additional attorney actor ids
--      granted send access, replaced wholesale via legal.matter.grant_access.
--
-- Enforcement lives in the operation-core API (assertCanSendOnMatter), NOT in
-- RLS: the DB RBAC floor (0078) gates by action KIND only and cannot express
-- per-matter ownership (every matter is kind=matter). A matter with NO owner set
-- (legacy / pre-0088) is treated as firm-shared — any attorney may send — so this
-- introduces ownership without regressing existing matters; enforcement bites the
-- moment a matter has an owner.
--
-- SCOPE / DORMANCY (known, intended): owner is stamped only on the attorney
-- create path, and there is not yet an attorney-facing "assign owner" step wired
-- into intake/triage — so booking-originated matters start unowned (firm-shared)
-- until legal.matter.set_owner is called. There is also a link-shape split: the
-- mail send path (clientEmailIndex) reads client_of + email (booking matters),
-- while legal.matter.create writes matter_has_client + contact_email; reconciling
-- that + wiring owner-assignment is the follow-up that makes mail isolation bite
-- broadly. esign sendForSignature resolves the matter from the draft (not the
-- email index), so its guard already bites on any owned matter today.
--
-- Data-only / additive / idempotent (ON CONFLICT DO NOTHING). Migration number
-- 0088 = next free across origin/main (max 0087 = calendar_categories, PR A) AND
-- prod (0084 task_primitive / 0085 service_billing_mode / 0086 engagement_status;
-- 0087 not yet applied). Parallel branches churn these numbers — if a collision
-- appears at merge, bump the number: the KIND IDS are the real uniqueness contract
-- and are verified free on prod (attribute 1011-…709/…70a, actions 1013-…707/…708;
-- distinct from calendar_categories' 1011-…708 / 1013-…705/…706).
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- The owning attorney's actor id (a matter has at most one owner at a time).
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000709', '00000000-0000-0000-0000-000000000001',
   'matter_owner', 'Matter owner',
   'The actor id of the attorney who owns this matter. Stamped at creation; gates who may send client email / signature requests on the matter (owner, granted actors, or a firm admin).',
   '00000000-0000-0000-1010-000000000001', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- Additional attorney actor ids granted send access (JSON array of actor ids).
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-00000000070a', '00000000-0000-0000-0000-000000000001',
   'matter_access_actor_ids', 'Matter access grants',
   'A JSON array of attorney actor ids granted send access to this matter in addition to the owner. Replaced wholesale via legal.matter.grant_access.',
   '00000000-0000-0000-1010-000000000001', 'json', false)
ON CONFLICT (id) DO NOTHING;

-- Set / transfer a matter's owner (writes the matter_owner attribute).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000707', '00000000-0000-0000-0000-000000000001',
   'legal.matter.set_owner', 'Set matter owner',
   'Set or transfer the owning attorney of a matter (writes the matter_owner attribute). Permitted to the current owner or a firm admin.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- Replace a matter's access-grant list (writes matter_access_actor_ids).
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000708', '00000000-0000-0000-0000-000000000001',
   'legal.matter.grant_access', 'Grant matter access',
   'Replace the set of attorney actor ids granted send access to a matter (writes matter_access_actor_ids). Permitted to the owner or a firm admin.',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
