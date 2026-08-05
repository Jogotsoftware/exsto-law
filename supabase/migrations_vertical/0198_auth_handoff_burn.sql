-- =============================================================================
-- Vertical migration 0198: single-use burn ledger for cross-host auth handoff.
--
-- AUTH-HANDOFF-1. Sessions are host-only cookies, so signing in on the
-- canonical host (app.instruments.legal — the one Google OAuth redirect URI,
-- and the marketing site's neutral /signin) cannot set a cookie on the user's
-- firm subdomain. The app bridges with a short-TTL HMAC one-time token; this
-- table is what makes "one-time" true across serverless instances — an
-- in-memory set would reset on every cold start and let a leaked URL replay.
--
-- Ops table in `private` (worker-job/control-plane precedent), NOT substrate:
-- rows are jti markers, no tenant data, no history semantics. INSERT-once via
-- primary key; the SECURITY DEFINER function returns false on conflict, which
-- the exchange route treats as replay ⇒ reject. Rows are garbage (60s token
-- TTL) — a periodic purge is a listed follow-up; growth is trivial meanwhile.
--
-- 0198 is above main+prod max (0197). Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS private.auth_handoff_burn (
  jti uuid PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON private.auth_handoff_burn FROM PUBLIC, anon;

-- True exactly once per jti. SECURITY DEFINER so the app role (which has no
-- direct grant on the table) can burn through the function and nothing else.
CREATE OR REPLACE FUNCTION private.burn_handoff_jti(p_jti uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH ins AS (
    INSERT INTO private.auth_handoff_burn (jti) VALUES (p_jti)
    ON CONFLICT (jti) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) = 1 FROM ins
$$;

REVOKE ALL ON FUNCTION private.burn_handoff_jti(uuid) FROM PUBLIC, anon;
