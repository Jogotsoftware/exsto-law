-- =============================================================================
-- Vertical migration 0119: tenant public handle (public_slug) + a controlled
-- public resolver for the standalone booking front door (/book/{slug}).
--
-- BOOKING-FRONTDOOR-1 WP1. The slug is the firm's PUBLIC HANDLE — deliberately
-- general, not booking-specific: the same handle will later front the intake
-- link, per-service landing pages, and the client portal, and is domain-portable
-- (a subdomain/custom-domain maps to the same slug with no data change).
--
-- tenant already has RLS (tenant_self_select, migration 0001), so an UNAUTHENTICATED
-- page cannot resolve a slug → firm through the normal tenant-scoped read (it has no
-- tenant context yet, and cross-tenant reads are forbidden). The SECURITY DEFINER
-- resolver below is the ONLY public cross-tenant read: it exposes EXACTLY two public
-- fields — the tenant id and the firm name — for an ACTIVE tenant matching the slug,
-- and NOTHING else (never status, timestamps, or any private tenant data). Booking
-- rules are read separately, tenant-scoped, AFTER the tenant is resolved.
--
-- No new kinds; column + function + seed only. Migration 0119 is above main+prod
-- max (0118). Idempotent.
-- =============================================================================

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS public_slug text;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_public_slug_key
  ON tenant (public_slug) WHERE public_slug IS NOT NULL;

-- Seed slugs for the existing firms (idempotent — only sets when still null).
UPDATE tenant SET public_slug = 'pacheco-law'
  WHERE id = '00000000-0000-0000-0000-000000000001' AND public_slug IS NULL;
UPDATE tenant SET public_slug = 'liberty-legal'
  WHERE id = '00000000-0000-0000-0000-000000000002' AND public_slug IS NULL;
UPDATE tenant SET public_slug = 'exsto-sandbox'
  WHERE id = '00000000-0000-0000-00fe-000000000001' AND public_slug IS NULL;

-- The controlled public read. SECURITY DEFINER so it bypasses tenant RLS (an
-- unauthenticated caller has no tenant context), but the body returns ONLY the two
-- public fields for an active, slug-matching firm — the minimal surface the public
-- booking page needs. search_path pinned; slug compared case-insensitively.
CREATE OR REPLACE FUNCTION public.resolve_public_firm(p_slug text)
RETURNS TABLE (tenant_id uuid, firm_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name
  FROM tenant
  WHERE public_slug = lower(btrim(p_slug))
    AND status = 'active'
  LIMIT 1
$$;

-- Only EXECUTE is public — never the underlying table. The function returns nothing
-- private, so any caller (including the anon-facing app role) may resolve a slug.
REVOKE ALL ON FUNCTION public.resolve_public_firm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_public_firm(text) TO PUBLIC;
