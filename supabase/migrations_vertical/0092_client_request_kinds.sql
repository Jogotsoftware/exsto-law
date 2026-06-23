-- =============================================================================
-- Vertical migration 0092: client requests (cost-gated self-serve center)
--
-- A `client_request` is a structured, COST-GATED ask a client makes from the
-- portal: request a meeting (priced at the firm's hourly rate), a document, or an
-- attorney review. The client sees and ACCEPTS the price before the request is
-- created; it then becomes an actionable item for the attorney with a lifecycle
-- (requested → accepted → in_progress → fulfilled, or declined). On fulfillment
-- the accepted amount is recorded as a matter service fee (legal.matter.add_fee),
-- so it rolls into the next invoice through the existing billing path.
--
-- Modelled like `task` (0084): an ENTITY with a status ATTRIBUTE and dedicated
-- lifecycle ACTIONS — NOT a workflow_definition (each request is a singular item,
-- not a reusable template). Status / type / currency are attribute VALUES, never
-- new kinds. All writes go through the action handlers
-- (verticals/legal/src/handlers/clientRequest.ts).
--
-- This is the surface the future AI self-serve features extend (AI-drafted docs,
-- "request attorney review of AI output") — same entity, new request types + a
-- judgment/outcome later; nothing here blocks that.
--
-- Id block 0910 (entity 1010, attribute 1011, relationship 1012, action 1013,
-- event 1014) + notification routes 1030-...0011/0012: verified free on
-- origin/main migration files AND against the live DB before apply. Matter entity
-- kind = 1010-...0001; client_contact = 1010-...0002. Config-as-data; idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── client_request entity kind ───────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000910', '00000000-0000-0000-0000-000000000001',
   'client_request', 'Client request',
   'A cost-gated request a client makes from the portal (meeting, document, or attorney review).',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── client_request attributes ────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000910', '00000000-0000-0000-0000-000000000001',
   'request_type', 'Type', 'meeting | document | review.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000911', '00000000-0000-0000-0000-000000000001',
   'request_status', 'Status', 'requested | accepted | in_progress | fulfilled | declined.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000912', '00000000-0000-0000-0000-000000000001',
   'request_description', 'Description', 'What the client is asking for (their words).',
   '00000000-0000-0000-1010-000000000910', 'text', true),
  ('00000000-0000-0000-1011-000000000913', '00000000-0000-0000-0000-000000000001',
   'request_price_amount', 'Accepted price', 'The cost the client accepted, decimal string (ADR 0044).',
   '00000000-0000-0000-1010-000000000910', 'money', false),
  ('00000000-0000-0000-1011-000000000914', '00000000-0000-0000-0000-000000000001',
   'request_currency', 'Currency', 'ISO currency code for the accepted price.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000915', '00000000-0000-0000-0000-000000000001',
   'request_price_basis', 'Price basis', 'Human explanation of the price (e.g. "1.0 hr @ $250/hr").',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000916', '00000000-0000-0000-0000-000000000001',
   'request_duration_minutes', 'Duration (min)', 'For a meeting request, the estimated length in minutes.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000917', '00000000-0000-0000-0000-000000000001',
   'request_assignee_actor_id', 'Assignee', 'Optional firm member (actor id) handling the request.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000918', '00000000-0000-0000-0000-000000000001',
   'request_accepted_at', 'Accepted at', 'ISO timestamp the client accepted the cost and submitted.',
   '00000000-0000-0000-1010-000000000910', 'text', false),
  ('00000000-0000-0000-1011-000000000919', '00000000-0000-0000-0000-000000000001',
   'request_billed_event_id', 'Billed fee event',
   'Set to the service_fee.recorded event id when the fulfilled request is recorded as a matter fee.',
   '00000000-0000-0000-1010-000000000910', 'text', false)
ON CONFLICT (id) DO NOTHING;

-- ── relationships: request -> matter, request -> client_contact ──────────────
INSERT INTO relationship_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   source_entity_kind_id, target_entity_kind_id, cardinality, directionality, inverse_kind_name) VALUES
  ('00000000-0000-0000-1012-000000000910', '00000000-0000-0000-0000-000000000001',
   'client_request_of', 'Request of', 'A client request belongs to a matter.',
   '00000000-0000-0000-1010-000000000910', '00000000-0000-0000-1010-000000000001',
   'many_to_one', 'directed', 'has_client_request'),
  ('00000000-0000-0000-1012-000000000911', '00000000-0000-0000-0000-000000000001',
   'client_request_from', 'Request from', 'A client request was filed by a client contact.',
   '00000000-0000-0000-1010-000000000910', '00000000-0000-0000-1010-000000000002',
   'many_to_one', 'directed', 'filed_client_request')
ON CONFLICT (id) DO NOTHING;

-- ── lifecycle actions (all writes go through these handlers) ──────────────────
-- Archival reuses the core entity.archive action; no new archive kind needed.
INSERT INTO action_kind_definition
  (id, tenant_id, kind_name, display_name, description,
   default_autonomy_tier, reversibility, reverse_action_kind_name, requires_reasoning_trace) VALUES
  ('00000000-0000-0000-1013-000000000910', '00000000-0000-0000-0000-000000000001',
   'legal.client_request.create', 'Create client request',
   'Create a cost-accepted client request on a matter (the client accepted the price).',
   'notify', 'fully_reversible', 'entity.archive', false),
  ('00000000-0000-0000-1013-000000000911', '00000000-0000-0000-0000-000000000001',
   'legal.client_request.accept', 'Accept client request',
   'Attorney accepts a client request (requested → accepted).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000912', '00000000-0000-0000-0000-000000000001',
   'legal.client_request.start', 'Start client request',
   'Attorney begins work on a client request (accepted → in_progress).',
   'notify', 'fully_reversible', NULL, false),
  ('00000000-0000-0000-1013-000000000913', '00000000-0000-0000-0000-000000000001',
   'legal.client_request.fulfill', 'Fulfill client request',
   'Attorney completes a client request (→ fulfilled). The accepted amount is recorded as a matter fee.',
   'notify', 'reversible_with_state_decay', NULL, false),
  ('00000000-0000-0000-1013-000000000914', '00000000-0000-0000-0000-000000000001',
   'legal.client_request.decline', 'Decline client request',
   'Attorney declines a client request (→ declined). No fee is recorded.',
   'notify', 'fully_reversible', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── lifecycle events (state changes) ─────────────────────────────────────────
INSERT INTO event_kind_definition
  (id, tenant_id, kind_name, display_name, description, is_state_change) VALUES
  ('00000000-0000-0000-1014-000000000910', '00000000-0000-0000-0000-000000000001',
   'client_request.created', 'Client request created',
   'A client submitted a cost-accepted request; payload holds type, amount, currency.', true),
  ('00000000-0000-0000-1014-000000000911', '00000000-0000-0000-0000-000000000001',
   'client_request.accepted', 'Client request accepted', 'Attorney accepted the request.', true),
  ('00000000-0000-0000-1014-000000000912', '00000000-0000-0000-0000-000000000001',
   'client_request.in_progress', 'Client request in progress', 'Attorney began the request.', true),
  ('00000000-0000-0000-1014-000000000913', '00000000-0000-0000-0000-000000000001',
   'client_request.fulfilled', 'Client request fulfilled',
   'Attorney completed the request; payload may reference the recorded fee event.', true),
  ('00000000-0000-0000-1014-000000000914', '00000000-0000-0000-0000-000000000001',
   'client_request.declined', 'Client request declined', 'Attorney declined the request.', true)
ON CONFLICT (id) DO NOTHING;

-- ── notification routes: new request → attorney; status change → client ──────
INSERT INTO notification_route_definition
  (id, tenant_id, action_id, kind_name, display_name, channel, recipients, template_ref, config) VALUES
  ('00000000-0000-0000-1030-000000000011', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'attorney_new_request', 'Attorney: new client request',
   'email', '{"role":"attorney"}'::jsonb, 'attorney-new-request', '{}'::jsonb),
  ('00000000-0000-0000-1030-000000000012', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-1000-000000000001',
   'client_request_update', 'Client: request status update',
   'email', '{"role":"client"}'::jsonb, 'client-request-update', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT public.sync_migration_history();
