# Client Portal — go-live checklist

This branch (`feat/portal-golive`) makes the client portal usable end-to-end:

1. **Create an account** — attorney sends an invite → client sets a password → signs in.
2. **Log in** — email + password (existing Supabase bridge) or the existing magic link.
3. **View documents** — already working (e-sign portal surfaces).
4. **View invoices** — new client-safe invoice view + a payment seam (Stripe-ready).
5. **Message + make requests** — messaging (existing) + a new cost-gated request center.

Code is committed and type-clean; the steps below are the **deploy actions** to make it live.
Order matters: **migrations first, then deploy** (the new MCP tools look up kinds that the
migrations create).

## 1. Apply the migrations to prod (gated/managed pipeline)
Two additive, idempotent, config-as-data migrations (no DDL, no data changes). Dependencies
(invoice/task/firm-rate kinds) are already present on prod; ids/names verified collision-free
against the live DB **and** the latest `main`:

- `0091_client_portal_invite_route.sql` — invite notification route
- `0092_client_request_kinds.sql` — the `client_request` concept + its notification routes

(The invoice "paid" lifecycle is **already on `main`** as `0090_invoice_paid_lifecycle.sql` — the
`invoice.pay` action / `invoice.paid` event. The client invoice view reads the resulting
`invoice_status='paid'`; the attorney "Mark paid" button uses `legal.invoice.pay`. No payment-seam
migration of our own.)

After applying, verify the new kinds exist (per tenant):
`select kind_name from entity_kind_definition where kind_name = 'client_request';`

## 2. Supabase dashboard (Auth) — REQUIRED for password login
- **Auth → Providers/Email → "Confirm email" must be ON.** If off, every password login returns
  503 (the fail-closed `emailConfirmationGate`). This is the prime suspect for "portal doesn't work".

## 3. Deploy env vars (Netlify, Builds scope) — REQUIRED
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OAUTH_STATE_SECRET` (≥16 chars — signs the portal session + invite tokens)
- **`SUPABASE_SERVICE_ROLE_KEY`** — NEW requirement; the set-password route uses it for Supabase
  Auth admin (create/reset password). Quarantined to `lib/supabaseAdmin.ts` (Auth only, never the DB;
  enforced by `tests/invariants/document-upload-guard.test.ts`).
- `NEXT_PUBLIC_BASE_URL` (or `URL`) — for the links in invite/notification emails.

## 4. Email delivery — REQUIRED for invites/notifications
Emails send through the firm's connected **Google/Gmail** account, drained by the **worker runtime**.
Confirm the attorney's Google is connected and the worker is running, or invite/magic/request emails
silently never arrive.

## 5. Post-deploy smoke test (the 5 capabilities)
1. Attorney → a contact → **Invite to portal** → client gets the email → set password → lands in `/portal`.
2. `/portal` shows Documents; sign one.
3. `/portal` shows Invoices; open one → real data behind the session.
4. Message the attorney; attorney replies; client sees it.
5. **Make a request** (meeting) → see the hourly-rate cost → accept → it appears in the attorney
   **Requests** inbox → Fulfil → it shows as a fee on the next invoice.

## Not in scope (future, by design)
AI-drafted documents / legal review, "request attorney review of AI output", and live card charging.
The `client_request` model + the payment seam are built so these extend in without rework.
