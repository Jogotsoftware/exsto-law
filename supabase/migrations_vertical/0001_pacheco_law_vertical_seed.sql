-- =============================================================================
-- Vertical migration 0001: Pacheco Law vertical seed (Phase 0, WP1)
--
-- DATA-ONLY: zero DDL, zero new tables (schema-as-data, invariants 12/23).
-- Everything here is definition rows + tenant-zero identity for the legal
-- vertical, scoped to tenant zero. Idempotent: fixed UUIDs + ON CONFLICT /
-- NOT EXISTS guards; re-running inserts nothing.
--
-- UUID scheme (vertical block, disjoint from the core seed's 0010-0016 block):
--   bootstrap action  00000000-0000-0000-1000-000000000001
--   hlc source        00000000-0000-0000-1000-0000000000ff
--   entity kinds      00000000-0000-0000-1010-00000000000N
--   attribute kinds   00000000-0000-0000-1011-0000000000NN
--   relationship kinds 00000000-0000-0000-1012-00000000000N
--   action kinds      00000000-0000-0000-1013-0000000000NN
--   event kinds       00000000-0000-0000-1014-00000000000N
--   outcome kinds     00000000-0000-0000-1016-00000000000N
--   workflow defs     00000000-0000-0000-1020-00000000000N
--   public-intake actor 00000000-0000-0000-0001-000000000005
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- -----------------------------------------------------------------------------
-- Tenant zero becomes Pacheco Law Firm (tenant is a mutable identity row).
-- -----------------------------------------------------------------------------
UPDATE tenant SET name = 'Pacheco Law Firm'
 WHERE id = '00000000-0000-0000-0000-000000000001' AND name <> 'Pacheco Law Firm';

-- -----------------------------------------------------------------------------
-- public-intake system actor (wedge pattern, ADR 0035): anonymous client-portal
-- writes act as this fixed system actor; client identity lives on client_contact.
-- -----------------------------------------------------------------------------
INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status) VALUES
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001',
   'system', 'public-intake', 'Public Intake', 'active')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Entity kinds. client_contact extends person via parent_kind_id.
-- -----------------------------------------------------------------------------
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000001', '00000000-0000-0000-0000-000000000001',
   'matter', 'Matter', 'A legal matter for the firm.',
   NULL, true, true, true, false),
  ('00000000-0000-0000-1010-000000000002', '00000000-0000-0000-0000-000000000001',
   'client_contact', 'Client contact', 'A prospect or client person record (extends person).',
   '00000000-0000-0000-0010-000000000001', true, true, false, false),
  ('00000000-0000-0000-1010-000000000003', '00000000-0000-0000-0000-000000000001',
   'questionnaire_response', 'Questionnaire response', 'A submitted intake questionnaire for a matter.',
   NULL, true, false, false, false),
  ('00000000-0000-0000-1010-000000000004', '00000000-0000-0000-0000-000000000001',
   'call_session', 'Call session', 'A recorded consultation call (Granola-ingested).',
   NULL, true, false, false, false),
  ('00000000-0000-0000-1010-000000000005', '00000000-0000-0000-0000-000000000001',
   'transcript', 'Transcript', 'A consultation transcript projected from raw call payloads.',
   NULL, true, false, false, false),
  ('00000000-0000-0000-1010-000000000006', '00000000-0000-0000-0000-000000000001',
   'document_draft', 'Document draft', 'An AI- or attorney-drafted document under review (versions live in document_version).',
   NULL, true, true, true, false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Attribute kinds, scoped to their entity kinds. Generic full_name/email/phone
-- already exist in the core seed and are reused, not redefined.
-- -----------------------------------------------------------------------------
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000001', '00000000-0000-0000-0000-000000000001',
   'matter_number',         'Matter number',        'Firm-facing matter reference.',                    '00000000-0000-0000-1010-000000000001', 'text',     false),
  ('00000000-0000-0000-1011-000000000002', '00000000-0000-0000-0000-000000000001',
   'service_key',           'Service kind',         'Which service kind (workflow_definition.kind_name) this matter follows.', '00000000-0000-0000-1010-000000000001', 'text', false),
  ('00000000-0000-0000-1011-000000000003', '00000000-0000-0000-0000-000000000001',
   'workflow_route',        'Workflow route',       'auto (AI drafting) vs manual (attorney drafts).',  '00000000-0000-0000-1010-000000000001', 'enum',     false),
  ('00000000-0000-0000-1011-000000000004', '00000000-0000-0000-0000-000000000001',
   'matter_status',         'Matter status',        'Lifecycle state of the matter.',                   '00000000-0000-0000-1010-000000000001', 'enum',     false),
  ('00000000-0000-0000-1011-000000000005', '00000000-0000-0000-0000-000000000001',
   'scheduled_at',          'Consultation start',   'Scheduled consultation start.',                    '00000000-0000-0000-1010-000000000001', 'datetime', false),
  ('00000000-0000-0000-1011-000000000006', '00000000-0000-0000-0000-000000000001',
   'scheduled_end',         'Consultation end',     'Scheduled consultation end.',                      '00000000-0000-0000-1010-000000000001', 'datetime', false),
  ('00000000-0000-0000-1011-000000000007', '00000000-0000-0000-0000-000000000001',
   'governing_law',         'Governing law',        'Jurisdiction binding generated documents.',        '00000000-0000-0000-1010-000000000001', 'text',     false),
  ('00000000-0000-0000-1011-000000000008', '00000000-0000-0000-0000-000000000001',
   'attribution_source',    'Attribution source',   'How the prospect found the firm.',                 '00000000-0000-0000-1010-000000000001', 'text',     false),
  ('00000000-0000-0000-1011-000000000009', '00000000-0000-0000-0000-000000000001',
   'google_event_id',       'Google event id',      'Calendar event backing the consultation.',         '00000000-0000-0000-1010-000000000001', 'text',     false),
  ('00000000-0000-0000-1011-000000000010', '00000000-0000-0000-0000-000000000001',
   'company_name',          'Company name',         'Prospect business name.',                          '00000000-0000-0000-1010-000000000002', 'text',     true),
  ('00000000-0000-0000-1011-000000000011', '00000000-0000-0000-0000-000000000001',
   'intake_form_id',        'Intake form id',       'Which questionnaire form version was answered.',   '00000000-0000-0000-1010-000000000003', 'text',     false),
  ('00000000-0000-0000-1011-000000000012', '00000000-0000-0000-0000-000000000001',
   'response_complete',     'Response complete',    'Whether all required intake fields were answered.','00000000-0000-0000-1010-000000000003', 'boolean',  false),
  ('00000000-0000-0000-1011-000000000013', '00000000-0000-0000-0000-000000000001',
   'granola_call_id',       'Granola call id',      'Granola id for idempotent ingestion.',             '00000000-0000-0000-1010-000000000004', 'text',     false),
  ('00000000-0000-0000-1011-000000000014', '00000000-0000-0000-0000-000000000001',
   'call_started_at',       'Call started at',      'When the consultation call began.',                '00000000-0000-0000-1010-000000000004', 'datetime', false),
  ('00000000-0000-0000-1011-000000000015', '00000000-0000-0000-0000-000000000001',
   'call_duration_seconds', 'Call duration (s)',    'Call length in seconds.',                          '00000000-0000-0000-1010-000000000004', 'number',   false),
  ('00000000-0000-0000-1011-000000000016', '00000000-0000-0000-0000-000000000001',
   'transcript_source',     'Transcript source',    'Producing integration (integration:granola).',     '00000000-0000-0000-1010-000000000005', 'text',     false),
  ('00000000-0000-0000-1011-000000000017', '00000000-0000-0000-0000-000000000001',
   'transcript_word_count', 'Transcript word count','Word count of the projected transcript.',          '00000000-0000-0000-1010-000000000005', 'number',   false),
  ('00000000-0000-0000-1011-000000000018', '00000000-0000-0000-0000-000000000001',
   'document_kind',         'Document kind',        'operating_agreement | engagement_letter | other.', '00000000-0000-0000-1010-000000000006', 'enum',     false),
  ('00000000-0000-0000-1011-000000000019', '00000000-0000-0000-0000-000000000001',
   'draft_status',          'Draft status',         'pending_review | approved | revision_requested | rejected.', '00000000-0000-0000-1010-000000000006', 'enum', false),
  ('00000000-0000-0000-1011-000000000020', '00000000-0000-0000-0000-000000000001',
   'document_jurisdiction', 'Document jurisdiction','Jurisdiction the document was drafted under.',     '00000000-0000-0000-1010-000000000006', 'text',     false),
  ('00000000-0000-0000-1011-000000000021', '00000000-0000-0000-0000-000000000001',
   'drafting_confidence',   'Drafting confidence',  'Model-reported confidence (0-1) for the draft.',   '00000000-0000-0000-1010-000000000006', 'number',   false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Relationship kinds wiring the vertical entities together.
-- -----------------------------------------------------------------------------
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000001', '00000000-0000-0000-0000-000000000001',
   'client_of',     'Client of',      'Client contact is a client on a matter.',
   '00000000-0000-0000-1010-000000000002', '00000000-0000-0000-1010-000000000001', 'many_to_many', 'directed', 'has_client'),
  ('00000000-0000-0000-1012-000000000002', '00000000-0000-0000-0000-000000000001',
   'call_of',       'Call of',        'Call session belongs to a matter.',
   '00000000-0000-0000-1010-000000000004', '00000000-0000-0000-1010-000000000001', 'many_to_one',  'directed', 'has_call'),
  ('00000000-0000-0000-1012-000000000003', '00000000-0000-0000-0000-000000000001',
   'transcript_of', 'Transcript of',  'Transcript was projected from a call session.',
   '00000000-0000-0000-1010-000000000005', '00000000-0000-0000-1010-000000000004', 'many_to_one',  'directed', 'has_transcript'),
  ('00000000-0000-0000-1012-000000000004', '00000000-0000-0000-0000-000000000001',
   'response_of',   'Response of',    'Questionnaire response belongs to a matter.',
   '00000000-0000-0000-1010-000000000003', '00000000-0000-0000-1010-000000000001', 'many_to_one',  'directed', 'has_response'),
  ('00000000-0000-0000-1012-000000000005', '00000000-0000-0000-0000-000000000001',
   'draft_of',      'Draft of',       'Document draft belongs to a matter.',
   '00000000-0000-0000-1010-000000000006', '00000000-0000-0000-1010-000000000001', 'many_to_one',  'directed', 'has_draft')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Action kinds — the Phase 0 write vocabulary (directive WP1, exact names).
-- Autonomy tier + reversibility chosen deliberately; draft.generate REQUIRES a
-- reasoning trace (invariant 20).
-- -----------------------------------------------------------------------------
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description, default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000001', '00000000-0000-0000-0000-000000000001',
   'intake.submit',          'Submit intake',            'Prospect submits the intake flow (steps 1-3).',
   'autonomous', 'reversible_with_state_decay',      NULL,             false),
  ('00000000-0000-0000-1013-000000000002', '00000000-0000-0000-0000-000000000001',
   'booking.create',         'Create booking',           'Book a consultation; writes the Google Calendar event.',
   'autonomous', 'reversible_with_external_caveats', 'booking.cancel', false),
  ('00000000-0000-0000-1013-000000000003', '00000000-0000-0000-0000-000000000001',
   'booking.update',         'Update booking',           'Reschedule or edit a consultation event.',
   'autonomous', 'reversible_with_external_caveats', NULL,             false),
  ('00000000-0000-0000-1013-000000000004', '00000000-0000-0000-0000-000000000001',
   'booking.cancel',         'Cancel booking',           'Cancel a consultation; removes the calendar event.',
   'notify',     'reversible_with_external_caveats', 'booking.create', false),
  ('00000000-0000-0000-1013-000000000005', '00000000-0000-0000-0000-000000000001',
   'call.ingest',            'Ingest call',              'Project a Granola payload into call_session + transcript.',
   'autonomous', 'irreversible',                     NULL,             false),
  ('00000000-0000-0000-1013-000000000006', '00000000-0000-0000-0000-000000000001',
   'draft.generate',         'Generate draft',           'AI-draft a document from questionnaire + transcript.',
   'autonomous', 'reversible_with_state_decay',      NULL,             true),
  ('00000000-0000-0000-1013-000000000007', '00000000-0000-0000-0000-000000000001',
   'draft.approve',          'Approve draft',            'Attorney approves a draft.',
   'notify',     'reversible_with_state_decay',      'draft.request_revision', false),
  ('00000000-0000-0000-1013-000000000008', '00000000-0000-0000-0000-000000000001',
   'draft.request_revision', 'Request draft revision',   'Attorney requests changes to a draft.',
   'autonomous', 'fully_reversible',                 NULL,             false),
  ('00000000-0000-0000-1013-000000000009', '00000000-0000-0000-0000-000000000001',
   'draft.reject',           'Reject draft',             'Attorney rejects a draft.',
   'notify',     'reversible_with_state_decay',      NULL,             false),
  ('00000000-0000-0000-1013-000000000010', '00000000-0000-0000-0000-000000000001',
   'document.edit',          'Edit document',            'Inline edit producing a NEW document_version row.',
   'notify',     'reversible_with_state_decay',      NULL,             false),
  ('00000000-0000-0000-1013-000000000011', '00000000-0000-0000-0000-000000000001',
   'matter.open',            'Open matter',              'Open a matter from a completed intake.',
   'autonomous', 'reversible_with_state_decay',      'entity.archive', false),
  ('00000000-0000-0000-1013-000000000012', '00000000-0000-0000-0000-000000000001',
   'mail.send',              'Send mail',                'Send client email through the attorney''s Gmail.',
   'notify',     'irreversible',                     NULL,             false),
  ('00000000-0000-0000-1013-000000000013', '00000000-0000-0000-0000-000000000001',
   'mail.ingest',            'Ingest mail',              'Ingest inbound client mail (idempotent on Gmail message id).',
   'autonomous', 'irreversible',                     NULL,             false),
  ('00000000-0000-0000-1013-000000000014', '00000000-0000-0000-0000-000000000001',
   'notification.send',      'Send notification',        'Send a notification through a configured route.',
   'autonomous', 'irreversible',                     NULL,             false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Event kinds — matter lifecycle.
-- -----------------------------------------------------------------------------
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000001', '00000000-0000-0000-0000-000000000001',
   'matter.opened',            'Matter opened',            'A matter was opened from intake.',          true),
  ('00000000-0000-0000-1014-000000000002', '00000000-0000-0000-0000-000000000001',
   'consultation.booked',      'Consultation booked',      'A consultation was booked.',                true),
  ('00000000-0000-0000-1014-000000000003', '00000000-0000-0000-0000-000000000001',
   'consultation.rescheduled', 'Consultation rescheduled', 'A consultation moved to a new time.',       true),
  ('00000000-0000-0000-1014-000000000004', '00000000-0000-0000-0000-000000000001',
   'consultation.cancelled',   'Consultation cancelled',   'A consultation was cancelled.',             true),
  ('00000000-0000-0000-1014-000000000005', '00000000-0000-0000-0000-000000000001',
   'transcript.received',      'Transcript received',      'A consultation transcript landed on the matter.', true),
  ('00000000-0000-0000-1014-000000000006', '00000000-0000-0000-0000-000000000001',
   'draft.requested',          'Draft requested',          'An async drafting job was enqueued.',       false),
  ('00000000-0000-0000-1014-000000000007', '00000000-0000-0000-0000-000000000001',
   'draft.completed',          'Draft completed',          'An AI draft finished and is ready for review.', true),
  ('00000000-0000-0000-1014-000000000008', '00000000-0000-0000-0000-000000000001',
   'draft.failed',             'Draft failed',             'An async drafting job failed after retries.', false),
  ('00000000-0000-0000-1014-000000000009', '00000000-0000-0000-0000-000000000001',
   'matter.closed',            'Matter closed',            'A matter reached a terminal state.',        true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Outcome kinds — draft review outcomes (about document_draft).
-- -----------------------------------------------------------------------------
INSERT INTO outcome_kind_definition
  (id, tenant_id, kind_name, display_name, description, about_entity_kind_id, polarity, is_terminal) VALUES
  ('00000000-0000-0000-1016-000000000001', '00000000-0000-0000-0000-000000000001',
   'draft_approved',           'Draft approved',           'Attorney approved the draft.',
   '00000000-0000-0000-1010-000000000006', 'positive', true),
  ('00000000-0000-0000-1016-000000000002', '00000000-0000-0000-0000-000000000001',
   'draft_revision_requested', 'Draft revision requested', 'Attorney asked for changes.',
   '00000000-0000-0000-1010-000000000006', 'neutral',  false),
  ('00000000-0000-0000-1016-000000000003', '00000000-0000-0000-0000-000000000001',
   'draft_rejected',           'Draft rejected',           'Attorney rejected the draft.',
   '00000000-0000-0000-1010-000000000006', 'negative', true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Service kinds as workflow definitions (definition rows, not tables).
-- Each binds an intake form id + workflow route (auto vs manual) in its
-- transitions config. workflow_definition.action_id is NOT NULL, so the seed
-- records itself as an honest system.bootstrap action first.
-- -----------------------------------------------------------------------------
INSERT INTO action
  (id, tenant_id, action_kind_id, actor_id, intent_kind, autonomy_tier,
   payload, hlc_physical_time, hlc_logical_counter, hlc_source_id) VALUES
  ('00000000-0000-0000-1000-000000000001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0013-000000000001',  -- system.bootstrap
   '00000000-0000-0000-0001-000000000001',  -- system actor
   'automatic_sync', 'autonomous',
   jsonb_build_object('seed', 'vertical-0001', 'defines', 'pacheco law service kinds'),
   now(), 0, '00000000-0000-0000-1000-0000000000ff')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_definition
  (id, tenant_id, action_id, kind_name, display_name, description, states, transitions, participating_entity_kinds, version) VALUES
  ('00000000-0000-0000-1020-000000000001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'nc_llc_single_member', 'NC LLC — Single-Member Formation',
   'Single-member North Carolina LLC formation. Auto route: AI drafts the operating agreement + engagement letter after the consultation.',
   '["intake_submitted","consultation_booked","consulted","drafting","in_review","approved","closed"]'::jsonb,
   '{"route":"auto","intake_form_id":"nc-llc-single-member-oa-v1","documents":["operating_agreement","engagement_letter"],"on_transcript":"draft.generate"}'::jsonb,
   '["matter","client_contact","questionnaire_response","call_session","transcript","document_draft"]'::jsonb,
   1),
  ('00000000-0000-0000-1020-000000000002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'nc_llc_multi_member', 'NC LLC — Multi-Member Formation',
   'Multi-member North Carolina LLC formation. Manual route: attorney drafts after the consultation; attorney is notified by email.',
   '["intake_submitted","consultation_booked","consulted","manual_drafting","closed"]'::jsonb,
   '{"route":"manual","intake_form_id":"nc-llc-multi-member-v1","notify":"attorney_email"}'::jsonb,
   '["matter","client_contact","questionnaire_response","call_session","transcript"]'::jsonb,
   1),
  ('00000000-0000-0000-1020-000000000003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'something_else', 'Something Else — General Consultation',
   'Catch-all matter. Manual route: free-text intake, consultation, attorney follows up; attorney is notified by email.',
   '["intake_submitted","consultation_booked","consulted","manual_follow_up","closed"]'::jsonb,
   '{"route":"manual","intake_form_id":"something-else-v1","notify":"attorney_email"}'::jsonb,
   '["matter","client_contact","questionnaire_response","call_session","transcript"]'::jsonb,
   1)
ON CONFLICT (id) DO NOTHING;
