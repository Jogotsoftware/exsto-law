-- 0116: AI document review — event vocabulary.
--
-- Three event kinds for the review pipeline (reviewDocument.ts): requested at
-- intake-bind/manual-run, completed when the memo persists, failed for
-- non-retryable preconditions (disabled config, foreign-matter version,
-- unextractable file). Everything else the feature needs already exists:
-- the memo reuses draft.generate / document_draft / draft_of, per-service
-- review config is transitions jsonb (config-as-data), and the notification
-- reuses the attorney_draft_completed route. No tables, no columns.
--
-- Numbered 0116: the prod ledger max is 0115 (0115_manual_payment_methods, which
-- also claimed 0115 on main — this feature branch's original 0115 collided and
-- was renumbered here). Id block 1017 (fresh — 1000/1010-1014/1016/1020/1030 are
-- taken on main; verified 0 document.review.* kinds in prod before applying).
--
-- event_kind_definition is TENANT-SCOPED (RLS) and event.record throws
-- "Kind not found" when the row is absent for the acting tenant, so the kinds
-- must exist for EVERY legal tenant, not just tenant zero — otherwise the
-- worker's document.review.completed record throws AFTER the memo + model spend
-- and the job retries into duplicate memos. This mirrors 0113/0115's
-- "seed for every firm" pattern (firm_settings = the per-tenant legal marker).

-- ── Tenant zero (Pacheco pilot) — fixed ids, idempotent ───────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1017-000000000001', '00000000-0000-0000-0000-000000000001',
   'document.review.requested', 'AI document review requested',
   'An AI review job was enqueued for an uploaded matter document. Primary=matter, secondary=[document]; payload holds document_version_id, service_key, job_id.',
   false),
  ('00000000-0000-0000-1017-000000000002', '00000000-0000-0000-0000-000000000001',
   'document.review.completed', 'AI document review completed',
   'The AI review memo was persisted (as a pending_review draft via draft.generate). Primary=matter, secondary=[reviewed document]; payload holds reviewed_document_version_id, memo_document_version_id, redline flag (+ redline_error when the optional redline pass failed), model_identity.',
   false),
  ('00000000-0000-0000-1017-000000000003', '00000000-0000-0000-0000-000000000001',
   'document.review.failed', 'AI document review failed',
   'A review job hit a non-retryable precondition (review disabled, document not of this matter, no extractable text). Primary=matter, secondary=[document]; payload holds document_version_id, reason, retryable:false.',
   false)
ON CONFLICT (id) DO NOTHING;

-- ── Same kinds for EVERY OTHER existing legal tenant ──────────────────────────
-- Kinds are strictly per-tenant (mirrors 0113/0115's "seed for every firm"):
-- every tenant with an active firm_settings entity kind is a legal tenant; fresh
-- random ids; idempotent via NOT EXISTS. Tenants created AFTER this migration
-- inherit the kinds from the tenant-zero registry clone.
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change)
SELECT gen_random_uuid(), t.tenant_id, k.kind_name, k.display_name, k.description, false
FROM (
  SELECT DISTINCT tenant_id
  FROM entity_kind_definition
  WHERE kind_name = 'firm_settings' AND status = 'active'
    AND tenant_id <> '00000000-0000-0000-0000-000000000001'
) t
CROSS JOIN (VALUES
  ('document.review.requested', 'AI document review requested',
   'An AI review job was enqueued for an uploaded matter document. Primary=matter, secondary=[document]; payload holds document_version_id, service_key, job_id.'),
  ('document.review.completed', 'AI document review completed',
   'The AI review memo was persisted (as a pending_review draft via draft.generate). Primary=matter, secondary=[reviewed document]; payload holds reviewed_document_version_id, memo_document_version_id, redline flag (+ redline_error), model_identity.'),
  ('document.review.failed', 'AI document review failed',
   'A review job hit a non-retryable precondition (review disabled, document not of this matter, no extractable text). Primary=matter, secondary=[document]; payload holds document_version_id, reason, retryable:false.')
) AS k(kind_name, display_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM event_kind_definition e
  WHERE e.tenant_id = t.tenant_id AND e.kind_name = k.kind_name
);
