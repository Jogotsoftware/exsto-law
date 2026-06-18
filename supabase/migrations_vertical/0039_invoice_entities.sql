-- =============================================================================
-- Vertical migration 0039: invoice + invoice_line entity kinds (Billing, Session 4)
--
-- The billing module rolls the existing time.logged / expense.recorded ledger
-- events (migration 0018) UP into invoices. Time/expense are NOT re-modelled —
-- they stay immutable journal events on the matter timeline; this migration adds
-- only the two genuinely-new concepts billing needs:
--
--   invoice       — a bill issued to a client (status draft → issued → sent),
--                   total + currency, optionally scoped to one matter.
--   invoice_line  — one charged line; points back at its SOURCE EVENT (a
--                   time.logged or expense.recorded event) via line_source_event_id.
--
-- Why the source link is an ATTRIBUTE, not a relationship: a relationship in this
-- substrate connects two ENTITIES (source_entity_id / target_entity_id), but the
-- billed source is an EVENT, not an entity. So the prompt's "billed_on (line→entry)"
-- is realised as the line_source_event_id attribute. (invoice→client and line→invoice
-- ARE entity↔entity and stay relationships — migration 0040.)
--
-- Money discipline (ADR 0044): all amounts use value_type 'money' — decimal STRINGS
-- in jsonb, summed with public.money_to_numeric, never JSON numbers.
--
-- PARALLEL-SAFETY: definition-row UUIDs are a shared manual sequence and five
-- sibling sessions are inserting kinds concurrently in their own migration leases.
-- The file-number lease (0039–0042) does NOT protect these UUIDs. To stay
-- collision-free, Session 4 anchors ALL its definition ids in a dedicated block at
-- ...-00000000040x / ...-0000000004xx (0x4xx ≫ every natural sequence: entity ≤07,
-- attribute ≤30, relationship ≤07, action ≤22, event ≤0e). Verified empty against
-- the live pilot DB before authoring.
--
-- Configuration-as-data: every new concept is a definition row. Idempotent.
-- =============================================================================

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);

-- ── Invoice entity kinds ──────────────────────────────────────────────────────
INSERT INTO entity_kind_definition
  (id, tenant_id, kind_name, display_name, description, parent_kind_id,
   supports_temporal_state, supports_judgment, supports_outcomes, requires_period) VALUES
  ('00000000-0000-0000-1010-000000000401', '00000000-0000-0000-0000-000000000001',
   'invoice', 'Invoice',
   'A bill issued to a client, rolled up from unbilled time + expense ledger events. Lifecycle: draft → issued → sent (no payments/IOLTA in v1).',
   NULL, true, false, false, false),
  ('00000000-0000-0000-1010-000000000402', '00000000-0000-0000-0000-000000000001',
   'invoice_line', 'Invoice line',
   'One charged line on an invoice; references its source time.logged / expense.recorded event via line_source_event_id.',
   NULL, true, false, false, false)
ON CONFLICT (id) DO NOTHING;

-- ── Invoice attributes ────────────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000401', '00000000-0000-0000-0000-000000000001',
   'invoice_number',      'Invoice number', 'Human-facing invoice number, e.g. INV-2026-0001.',
   '00000000-0000-0000-1010-000000000401', 'text',  false),
  ('00000000-0000-0000-1011-000000000402', '00000000-0000-0000-0000-000000000001',
   'invoice_status',      'Status',         'draft | issued | sent. Transitions also emit invoice.issued / invoice.sent events (ADR 0039).',
   '00000000-0000-0000-1010-000000000401', 'enum',  false),
  ('00000000-0000-0000-1011-000000000403', '00000000-0000-0000-0000-000000000001',
   'invoice_client_id',   'Client',         'Entity id of the client this invoice bills (also the invoice_of relationship).',
   '00000000-0000-0000-1010-000000000401', 'text',  false),
  ('00000000-0000-0000-1011-000000000404', '00000000-0000-0000-0000-000000000001',
   'invoice_matter_id',   'Matter',         'Optional entity id of a single matter this invoice is scoped to (null = whole client).',
   '00000000-0000-0000-1010-000000000401', 'text',  false),
  ('00000000-0000-0000-1011-000000000405', '00000000-0000-0000-0000-000000000001',
   'invoice_total',       'Total',          'Invoice total, a decimal string (ADR 0044). Sum of the line amounts.',
   '00000000-0000-0000-1010-000000000401', 'money', false),
  ('00000000-0000-0000-1011-000000000406', '00000000-0000-0000-0000-000000000001',
   'invoice_currency',    'Currency',       'ISO currency code, defaults USD.',
   '00000000-0000-0000-1010-000000000401', 'text',  false),
  ('00000000-0000-0000-1011-000000000407', '00000000-0000-0000-0000-000000000001',
   'invoice_issued_date', 'Issued date',    'ISO date the invoice was issued.',
   '00000000-0000-0000-1010-000000000401', 'date',  false),
  ('00000000-0000-0000-1011-000000000408', '00000000-0000-0000-0000-000000000001',
   'invoice_due_date',    'Due date',       'ISO date payment is due (optional).',
   '00000000-0000-0000-1010-000000000401', 'date',  false),
  ('00000000-0000-0000-1011-000000000409', '00000000-0000-0000-0000-000000000001',
   'invoice_notes',       'Notes',          'Free-text note shown on the invoice (optional).',
   '00000000-0000-0000-1010-000000000401', 'text',  false)
ON CONFLICT (id) DO NOTHING;

-- ── Invoice-line attributes ───────────────────────────────────────────────────
INSERT INTO attribute_kind_definition
  (id, tenant_id, kind_name, display_name, description, on_entity_kind_id, value_type, is_pii) VALUES
  ('00000000-0000-0000-1011-000000000410', '00000000-0000-0000-0000-000000000001',
   'line_invoice_id',      'Invoice',      'Entity id of the parent invoice (also the line_of relationship).',
   '00000000-0000-0000-1010-000000000402', 'text',   false),
  ('00000000-0000-0000-1011-000000000411', '00000000-0000-0000-0000-000000000001',
   'line_kind',            'Kind',         'time | expense — which ledger this line was billed from.',
   '00000000-0000-0000-1010-000000000402', 'enum',   false),
  ('00000000-0000-0000-1011-000000000412', '00000000-0000-0000-0000-000000000001',
   'line_source_event_id', 'Source event', 'Event id of the time.logged / expense.recorded event this line bills (the billed_on link).',
   '00000000-0000-0000-1010-000000000402', 'text',   false),
  ('00000000-0000-0000-1011-000000000413', '00000000-0000-0000-0000-000000000001',
   'line_description',     'Description',  'Line description (copied from the source entry, attorney-editable).',
   '00000000-0000-0000-1010-000000000402', 'text',   false),
  ('00000000-0000-0000-1011-000000000414', '00000000-0000-0000-0000-000000000001',
   'line_quantity',        'Quantity',     'Billed quantity as a decimal string: hours for time, 1 for an expense.',
   '00000000-0000-0000-1010-000000000402', 'number', false),
  ('00000000-0000-0000-1011-000000000415', '00000000-0000-0000-0000-000000000001',
   'line_rate',            'Rate',         'Unit rate, a decimal string (ADR 0044): hourly rate for time, the expense amount for expense.',
   '00000000-0000-0000-1010-000000000402', 'money',  false),
  ('00000000-0000-0000-1011-000000000416', '00000000-0000-0000-0000-000000000001',
   'line_amount',          'Amount',       'Line total = quantity x rate, a decimal string (ADR 0044).',
   '00000000-0000-0000-1010-000000000402', 'money',  false),
  ('00000000-0000-0000-1011-000000000417', '00000000-0000-0000-0000-000000000001',
   'line_matter_id',       'Matter',       'Entity id of the matter the source entry belongs to.',
   '00000000-0000-0000-1010-000000000402', 'text',   false)
ON CONFLICT (id) DO NOTHING;
