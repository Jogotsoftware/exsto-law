# Referrals & Multi-Firm Tenancy — Design

Status: ACTIVE (P1 shipping; R-phases planned)
Owner thread: referrals-tenancy (2026-07-17)

## Problem

The platform is genuinely multi-tenant (Dev Firm, Pacheco Law, runtime-provisioned
firms via `cp_bootstrap_tenant`), but two product needs collide with
one-tenant-per-person assumptions:

1. **A client can have matters at more than one firm.** Before P1, that person was
   locked out of BOTH portals: `findClientContactByEmail` failed closed on
   cross-tenant email ambiguity, the portal session carries exactly one tenant, and
   Supabase Auth (GoTrue) is one global password per email — firm B inviting an
   existing firm-A portal user would silently reset their firm-A password.
2. **Referrals** in four modes: firm→firm on-platform handoff, referral-link growth
   attribution, outbound referrals to off-platform professionals
   (`referral_partner` directory), and client-source attribution
   (`attribution_source`). No cross-tenant primitive existed.

## Product decisions (founder, 2026-07-17)

- **Main attorney/firm** = the firm the person signed up with. Their portal
  defaults there; no picker screen.
- A client can be **referred to another firm for a new matter**; that matter is
  shared with the referring attorney as a **read-only mirror in the referring
  firm's tenant** (status/milestones/coarse updates only — the referring attorney
  never enters the receiving firm's workspace).
- **Referred-out matters are their own first-class type** for the referring
  attorney (`referred_matter` entity kind — appears in the Matters list with its
  own card style, not buried in a CRM tab). Marketplace-ready: an eventual
  referral marketplace builds on the directory + terms + milestones + mirrors.
- The client's **main-firm portal also shows referred matters** — rendered from
  the same tenant-local mirror, with "Open in [Firm B]" (firm switch) for full
  detail.
- **One login + firm switcher**; the session and every portal query stay
  single-tenant by construction.

## Architecture decisions

| # | Decision |
|---|----------|
| D1 | **No durable identity map.** `findClientContactMembershipsByEmail` (live cross-tenant email scan under `withSuperuser`, the sanctioned pattern from `lookupActorByEmail`) returns ALL firms where the email is an active `client_contact`, excluding the reserved platform/sandbox tenants. Exposes per firm only `tenant.name` + `public_slug` — the same two fields `resolve_public_firm` already makes public. Callers may return the list only to a requester who PROVED control of the email. |
| D2 | **Main firm = oldest contact.** memberships are ordered oldest-`entity.created_at` first; the signup firm predates referral-created contacts, so `memberships[0]` is the main firm. Within a tenant, the oldest active contact wins (was: total lockout on duplicates). |
| D3 | **Session format unchanged** (`client-session.v2`, single tenant, HMAC cookie). Sign-in defaults into the main firm; `POST /api/client/auth/switch-firm` re-proves membership live from the DB and re-mints the cookie for the chosen firm. The bridge honors an explicit body `tenantId` only when it is one of the verified email's own memberships; anything else gets the same 403 as an unknown email (no membership oracle). The funnel middleware's `x-firm-slug` header is never honored by authed routes. |
| D4 | **GoTrue password hazard** (firm B invite resetting firm A's password) is guarded at set-password consume time (P2): a CONFIRMED auth user whose email is multi-tenant never gets a password overwrite — 409 → the page flips to sign-in and lands in the inviting firm. Self-serve forgot-password (Supabase recovery) closes the reset gap. |
| D5 | **Cross-tenant referral primitive = mirrored tenant-scoped pair + worker-queue crossing.** Outbound `referral` entity in tenant A, inbound in tenant B, joined by `referral_correlation_id`. The only crossing is `enqueueJob({tenantId: other})` — the dispatcher binds the target tenant and writes via `submitAction` as that tenant's intake/system actor. No live shared state; no cross-tenant reads at request time. Milestones relay back the same way. |
| D6 | **Consent-first, two-step PII reveal.** Client consent (event with the disclosed-terms snapshot) is a hard precondition to send. Initial delivery = name + practice area + summary only; email/phone cross only after the receiving firm accepts. Fee-split ethics posture is per-firm config (`referral_fee_policy`, `referral_consent_mode` on `firm_profile`) — some states bar splits or require signed consent; the platform enforces consent-before-PII unconditionally. No money movement; terms + consent + milestones make later accounting possible. |
| D7 | **One `referral` entity kind for all modes** — `referral_direction` (inbound/outbound) × `referral_channel` (platform_firm / referral_link / external_partner), counterparty = tenant slug | `referral_to_partner` relationship | freetext. `attribution_source` stays the marketing-mix attribute; real referrals also set it and link matter↔referral so the reports reconcile. |
| D8 | **`referred_matter` mirror entity kind** materialized in the referring tenant on accept, linked `mirror_of_referral` + `referred_matter_of_client`, updated by milestone relays. Renders in the attorney Matters list (own type) and on the client's main-portal home. All tenant-local reads. |
| D9 | New SECURITY DEFINER surface: exactly two functions (`list_referral_firms()` — slug+name of opted-in active tenants; `set_referral_directory_optin()` — self-tenant-guarded). Everything else crosses via the worker queue. The sanctioned DEFINER list must stay enumerable in `exsto-verify-tenancy` runs. |
| D10 | **Marketplace-ready, not marketplace-built** — the directory, terms snapshots, milestone relays, and mirrors are the substrate a future `referral_listing` marketplace composes; a control-plane browse surface is designed only when that phase starts. |

## Phases

- **P0 (done 2026-07-17)**: joe@revenueinstruments.com firm sign-in moved to
  Pacheco Law (Pacheco actor `d5854397…` = super_admin + attorney; Dev actor
  deactivated with audit action rows; `/admin` unaffected — platform actor
  resolves via `cp_resolve_admin_by_email`).
- **P1 (this PR)**: memberships resolver + main-firm default + switch-firm route +
  `/me` firms + header switcher + per-tenant intake-actor fix in the session mint
  and set-password paths + tenant-scoped e-sign channel detection + live firm
  name in portal header/messages.
- **P2**: invite/password hazard (D4), forgot-password, invite copy.
- **R1**: `referral` kinds migration; attribution report; outbound partner
  referrals (extends `referral_partner`); Refer-out UI + Referrals tab.
- **R2**: referral links (`{firm-slug}.{shortcode}`, `?ref=` capture in the funnel
  middleware — attribution-only, never tenant resolution), link-relay worker,
  firm-signup attribution at `cp_bootstrap`.
- **R3**: firm→firm handoff (consent token + public consent page, deliver/accept/
  decline/reveal via worker queue, inbound referral queue UI) + `referred_matter`
  mirrors (attorney Matters list + client main-portal cards). Mandatory
  `exsto-verify-tenancy` + DEFINER enumeration.
- **R4**: rev-share readiness reporting, milestone hooks, attorney-level codes,
  e-sign consent mode.
- **R5 (future)**: referral marketplace.

## Known hazards / open items

- `cp_bootstrap_tenant` clones the 7 kind registries but NOT
  `permission_scope_definition` — a runtime-provisioned firm has no
  `client.portal` scope until a catch-up (0168 pattern), so portal actors
  provisioned there hold zero scopes (= unrestricted under the 0073 model).
  R-phase migrations that add scopes must include the catch-up for
  runtime-provisioned tenants; longer-term `cp_bootstrap_tenant` should clone
  scopes + roles too.
- PII persists in `worker_job` payloads after completion; the two-step reveal
  keeps pre-accept crossings to name+summary. Consider payload scrub-on-complete
  before R3 ships.
- Declined referrals leave name+summary in the receiving tenant forever
  (append-only substrate) — revisit whether even the name should be gated behind
  accept.
- `app/api/client/pay/route.ts` still hardcodes the tenant-zero actor for its
  token flow (same class as the mint-path bug fixed in P1) — adjacent follow-up.
