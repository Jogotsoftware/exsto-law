-- =============================================================================
-- Vertical migration 0016: per-attorney integration connections
--
-- "User AND tenant separation": personal integrations (Google calendar/mail and
-- Granola) belong to the individual attorney, not the whole firm. Today the
-- connection is keyed only by (tenant_id, provider), so whoever connects last
-- becomes the firm's account and every attorney shares it. This adds actor_id so
-- each attorney connects — and sees — their OWN account, still isolated per firm.
--
-- Firm-wide resources keep actor_id NULL: the AI keys (anthropic / openai /
-- perplexity) are loaded by the async drafting worker, which runs as the agent
-- actor (not a logged-in attorney), so they cannot be per-login.
--
-- Discipline (exsto-substrate-migration analog for the vertical): tenant_id stays
-- the RLS boundary (per-actor scoping is an app-layer filter — connectionStore
-- runs withSuperuser); forward-only; tenant_id still indexed (leading column of
-- the scope index below).
-- =============================================================================

ALTER TABLE public.legal_integration_connection
  ADD COLUMN actor_id uuid REFERENCES actor(id);

-- Replace the (tenant_id, provider) primary key with a surrogate id, then a
-- uniqueness rule that treats a NULL actor (firm-wide) as one fixed slot: exactly
-- one row per (tenant, provider, actor), and one firm-wide row per
-- (tenant, provider). COALESCE keeps the connection-store ON CONFLICT a single
-- target. The zero UUID is a sentinel only inside the index expression — no actor
-- has that id, and the actor_id column itself stays NULL for firm-wide rows (so
-- the actor(id) foreign key is satisfied).
ALTER TABLE public.legal_integration_connection
  DROP CONSTRAINT legal_integration_connection_pkey;
ALTER TABLE public.legal_integration_connection
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.legal_integration_connection
  ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX legal_integration_connection_scope_uq
  ON public.legal_integration_connection
     (tenant_id, provider, COALESCE(actor_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX legal_integration_connection_actor_idx
  ON public.legal_integration_connection (tenant_id, actor_id);

-- Backfill: existing google/granola rows pre-date per-attorney ownership — we
-- can't attribute them to an attorney, so mark them disconnected to force one
-- clean per-attorney reconnect. The Vault secret is left in place (the reconnect
-- overwrites it); a disconnected row is the visible "reconnect" state. AI-key
-- rows (anthropic/openai/perplexity) stay as-is — they are firm-wide by design.
UPDATE public.legal_integration_connection
   SET status = 'disconnected', updated_at = now()
 WHERE provider IN ('google', 'granola')
   AND actor_id IS NULL
   AND status <> 'disconnected';
