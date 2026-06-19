# S10 — Client Portal & Accounts · Integration Plan (HELD)

> Status: **HELD** pending dependencies (S5 booking-confirm, S6/Contract J documents, S9 auth/tenant foundation).
> This worker merges **no portal feature** until those seams exist. It ships only this plan + the
> contract-test checklist (`tests/vertical/s10-portal-contracts.test.ts`) + the Manager report.
> Lease `0076–0078` is **reserved, unwritten**. Decision owner: Joe (2026-06-18).

## Plain-language summary (for Joe)

Most of the "client portal" already exists and works: clients get a magic email link, sign in,
see only their own matters, message the firm, sign documents, and pay. The S10 brief read as if
this were greenfield — it isn't. So this round is **not** "build a portal." It's three deltas on
top of what's live, and **two of the three depend on sibling work that isn't merged yet**, so we're
holding. Your three decisions are locked into this plan:

1. **First-class client accounts** — today a client is just an email + a 30-minute link. You want a
   real, persistent account (a login they own), distinct from their contact record, scoped to the
   firm. That's a new identity and it sits on the **S9** auth foundation, which isn't built yet.
2. **Hold until dependencies land** — I write this plan and the test checklist now; I merge no
   feature that would rest on S5/S6/S9 code that doesn't exist.
3. **Released documents only** — clients will see/download just the documents the attorney has
   explicitly released (scoped to their own matters), and sign where required. This is a controlled
   reversal of today's "the portal never names documents" rule.

## Reconciliation: brief vs. ground truth (`main` @ `2a56f77`)

| Brief assumed | Reality |
|---|---|
| Greenfield portal | **~80% live** — magic-link auth, `/portal` matters+timeline, messaging (mig 0015), `/portal/sign`, `/portal/pay`, RLS isolation tests (`tests/vertical/client-portal-{policy,auth}.test.ts`) |
| Owns `src/features/portal/**`, `feature.manifest.ts`, `settings.manifest.ts` | **None of these paths exist.** Real layout: `apps/legal-demo/app/portal/**` (Next.js) + `verticals/legal/src/{queries,mcp}/clientPortal*`. The file-ownership map is fiction — building into it would create a **duplicate, colliding portal**. |
| Client identity is an open assumption to flag | Already decided **the other way** in shipped code (session-over-contact). Joe's ruling: **upgrade to first-class accounts** (this plan). |
| Build on S9 | S9 **not started**; the live portal shipped its own client auth and does not depend on S9. First-class accounts *do* need S9 → a reason to hold. |
| Tokenized link, etc. | Magic-link tokens already single-use + 30-min expiry (`client-portal-magic-link` email template) — reuse this token discipline, don't reinvent. |

## Seams S10 consumes (exact asks on the owners)

- **S9 — auth/tenant foundation (BLOCKING).** S10 needs a first-class, tenant-scoped `client_account`
  identity: a persistent credential distinct from `client_contact`, an RLS predicate scoping every
  read to *that account's own matters*, and a session carrying `{tenant_id, client_account_id,
  client_contact_id}`. S10 registers the account-creation handler on S9's auth primitives; S9 owns
  the credential storage. **Open with Manager:** does S9 own the credential table, or does S10?
- **S5 — booking confirm + email (BLOCKING for WP10.1/10.2).** (a) booking already creates
  `client`+`client_contact` (#20 ✅); (b) S5 must expose a core action `legal.booking.confirm`
  (`intent_kind` = `enforcement`) that a signed-in client may call; (c) the **booking-confirmation
  email** (sent by S5 via Contract B) must embed the account-setup link (fix #21). *No
  booking-confirmation email template exists today* — flag to S5.
- **B — `enqueueClientEmail` (S3).** S10 does **not** send mail. S10 owns the template-variable
  contract for a new `client-booking-confirmation` template: `{ account_setup_url, client_full_name,
  matter_number }`. S5 enqueues it via B.
- **J — document view (S6, BLOCKING for WP10.3).** S10 needs a query returning a client's
  **released** documents scoped to their matters + a render/download path. S10 adds
  `legal.client.documents` (list released) and `legal.client.document_get` (render/download) to the
  authed allowlist, reading via J. A non-released doc must be invisible (`knowability_state` =
  `withheld`).
- **S8 — e-sign (already consumed).** Keep `/portal/sign` + `esignPortalTools`. WP10.3 links a
  released document to its signature task where required.
- **C — nav registry (S2).** Register a "Portal" nav group. **Confirm C exists** — no manifest
  registry was found; today the portal is plain routes under `/portal`. If C is also fiction,
  fall back to the real nav mechanism and note it.

## Integration point in our code

The single security seam is `verticals/legal/src/mcp/clientPolicy.ts` — `CLIENT_PORTAL_TOOLS`
(unauth/public) and the authed allowlist (`isClientPortalAuthedTool`) gating
`apps/legal-demo/app/api/client/portal/mcp/route.ts` (default-deny: a non-allowlisted name returns the
same 404 as unknown — no oracle). **All new client tools are added here**, never by widening the
public list. Client session: `@/lib/clientSession` (`readClientSessionFromCookieHeader`,
`exsto_client_session` httpOnly cookie).

## Work packages — build steps (execute only after deps land)

**WP10.1 — Account creation via tokenized booking link (fix #21).**
1. New `client_account` identity on S9 (entity-kind/definition row — config-as-data, ADR/CLAUDE soft-rule 8 — plus S9 credential storage).
2. Account-setup token: single-use, ≤30-min, opaque + hashed at rest, bound to `client_contact_id` + purpose `account_setup`. Reuse the magic-link token discipline.
3. S5's booking-confirmation email embeds `account_setup_url`; landing page creates the account, sets the credential, links it to the booking's `client_contact`, scoped to the firm tenant.
- **Receipt R10.1:** a token from a booking → a created, tenant-scoped `client_account` linked to that booking's `client_contact`.

**WP10.2 — Confirm booking from the portal.**
1. Add `legal.booking.confirm` to the **authed** allowlist (consume S5's core action).
2. Portal action transitions the booking to confirmed *through the core* (no direct substrate write).
- **Receipt R10.2:** a booking transitions to confirmed via a portal action through the core.

**WP10.3 — Manage documents (released-only).**
1. Add `legal.client.documents` + `legal.client.document_get` to the authed allowlist (consume J).
2. Released-only filter; non-released = invisible. Link to S8 signature where required.
- **Receipt R10.3:** a signed-in client views one released document + completes a signature; cannot see any other client's records.

## Migrations — lease `0076–0078` (reserved, written only post-dependency)

- `0076` — `client_account` identity definition + RLS scoping (coordinate ownership of credential storage with S9).
- `0077` — `client-booking-confirmation` notification route + template (data-only row, like `0014`).
- `0078` — released-document client-view permission scope + `legal.client.document*` allowlist policy rows.

## Safety / anti-patterns (enforced)

- Every client read scoped to `client_account → own matters` (RLS via S9). Extend
  `tests/vertical/client-portal-{policy,auth}.test.ts` for cross-client **and** cross-tenant leak.
- Default-deny allowlist; never widen the public list. No write/admin/research tool client-callable.
- Released-docs-only: an unreleased doc is `withheld`, never enumerated.
- Tokens single-use + short-lived + hashed; never long-lived/guessable.
- Don't reimplement documents (consume J), e-sign (consume S8), or mail (S5 sends via B).
- No portal account that isn't tenant-scoped.

## Definition of done (this HELD round)

- [x] Reconciliation + integration plan (this doc).
- [x] Contract-test checklist pinning R10.1–R10.3 (`tests/vertical/s10-portal-contracts.test.ts`, green via `it.todo`, standing-invariant guards live).
- [x] Manager report incl. the resolved client-identity decision (`docs/workers/S10-report.md`).
- [ ] *Deferred to post-dependency:* migrations `0076–0078`, feature wiring, live receipts.
