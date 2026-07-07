-- 0115: AI document review — event vocabulary.
--
-- Three event kinds for the review pipeline (reviewDocument.ts): requested at
-- intake-bind/manual-run, completed when the memo persists, failed for
-- non-retryable preconditions (disabled config, foreign-matter version,
-- unextractable file). Everything else the feature needs already exists:
-- the memo reuses draft.generate / document_draft / draft_of, per-service
-- review config is transitions jsonb (config-as-data), and the notification
-- reuses the attorney_draft_completed route. No tables, no columns.
--
-- Id block 1017 (fresh — 1000/1010-1014/1016/1020/1030 are taken on main;
-- verify against the prod ledger before applying, per exsto-substrate-migration).
-- Tenant zero (Pacheco pilot); ON CONFLICT DO NOTHING keeps re-runs safe.

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
