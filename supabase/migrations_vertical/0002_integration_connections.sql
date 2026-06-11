-- =============================================================================
-- Vertical migration 0002: integration connection metadata (Phase 0, WP2)
--
-- One vertical table holding integration CONNECTION METADATA ONLY — provider,
-- status, account, scope, expiry, last error, and the NAME of the secret in
-- Supabase Vault. Secret material (tokens, API keys) lives exclusively in
-- vault.secrets (REQ-SEC-01: Vault, never plaintext). Classified as an
-- operational lifecycle table (ADR 0039 analog: status mutates in place; its
-- history is the action/event stream of connect/disconnect operations).
--
-- Per exsto-substrate-migration: tenant_id NOT NULL + RLS tenant isolation,
-- born with zero anon grants (0019 default privileges), tenant_id indexed
-- (covered by the primary key's leading column).
-- =============================================================================

CREATE TABLE public.legal_integration_connection (
  tenant_id        uuid        NOT NULL REFERENCES tenant(id),
  provider         text        NOT NULL,  -- 'google' | 'granola' | 'anthropic' | ...
  status           text        NOT NULL DEFAULT 'connected'
                   CHECK (status IN ('connected', 'error', 'disconnected')),
  account_email    text,
  scope            text,
  vault_secret_name text       NOT NULL,  -- vault.secrets.name holding the credential JSON
  expires_at       timestamptz,
  last_error       text,
  detail           jsonb       NOT NULL DEFAULT '{}',  -- NON-secret display metadata (e.g. key last-four)
  connected_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

ALTER TABLE public.legal_integration_connection ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_integration_connection_select ON public.legal_integration_connection
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY legal_integration_connection_insert ON public.legal_integration_connection
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY legal_integration_connection_update ON public.legal_integration_connection
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY legal_integration_connection_delete ON public.legal_integration_connection
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
