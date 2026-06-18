-- =============================================================================
-- Vertical migration 0026: Reconcile a meeting's snapshot with Google (Obj 8)
--
-- legal.meeting.assign captures a Google event ONCE. When that event is later
-- moved / renamed / cancelled IN GOOGLE, the captured snapshot goes stale. This
-- action lets a periodic worker (legal.meeting.reconcile job) re-read Google and
-- APPEND corrections: a changed field becomes a NEW attribute row with
-- integration:'google:'+id provenance (never an in-place edit), and a deleted /
-- cancelled event becomes meeting_event_status='cancelled'. The latest-value read
-- (DISTINCT ON … valid_from DESC) then reflects current truth; capture-time rows
-- remain as history. No new attribute/entity/relationship kinds — it reuses the
-- 0025 meeting_* attributes.
--
-- Next free action id verified against the live pilot DB (action_kind ≤ 0028).
-- Configuration-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000029', '00000000-0000-0000-0000-000000000001',
   'legal.meeting.reconcile', 'Reconcile meeting with Google', 'Append corrections to a captured meeting when its Google event changed (moved/renamed/cancelled).',
   'autonomous', 'reversible_with_state_decay', NULL, false)
ON CONFLICT (id) DO NOTHING;
