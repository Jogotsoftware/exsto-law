# PORTAL-1 — architectural decisions

Session: portal-1 (fork of main @ 8ff78dc, MACHINE-COMMS-1 + STYLE-FIX-2 in history).
Frontier re-verified 0119 on 2026-07-10. **Zero migrations used** (lease 0135–0149 untouched):
every new concept is a runtime `kind.define` seed or a `legal.capability.upsert`.

## Reconciliation (brief vs repo)

Much of the brief's portal already exists (portal go-live: Supabase email+password auth,
invites, documents, invoices, messaging, priced requests). PORTAL-1 therefore built the
deltas only. Notable brief-vs-reality corrections:

- `workflow_definition.client_display_name/client_description` (UI-BUILDER-FIX-1) do not
  exist yet — portal reads them via `to_jsonb(wd)` so the query works before AND after
  that track lands (fallback to `display_name`/`description`).
- Stage-level client-safe labels already exist as `states[].client_label` with
  `clientLabel()` fallback (lifecycle/resolve.ts) — the portal now uses them.
- The brief's "transactional emails show raw markdown" is half-true: notification-route
  mail already has a branded HTML kit. The confirmed leak is the approved AI-draft send
  (`sendCommunicationDraft` → `enqueueClientEmail` with no html part). Fixed at
  `enqueueClientEmail` so every producer inherits.

## Decisions (unspecified in brief — called out per instructions)

1. **Client actor shape.** `actor_type='human'`, `external_id='client:<clientContactId>'`,
   NOT the email. Reason: attorney Google sign-in resolves actors by
   `lower(external_id)=lower(email)` (identity.ts) — a client actor keyed by email would
   let a client's Google login mint an ATTORNEY session. The `client:` prefix can never
   collide with an email match.
2. **Mapping persistence = attribute, not a table.** `portal_actor_id` attribute on the
   `client_contact` entity (runtime kind.define; provenance + append-only history for
   free). No DDL. The actor row itself is inserted by the
   `legal.client.provision_portal_actor` action handler (action layer owns the write;
   idempotent — re-provision returns the existing actor).
3. **Account gate ordering / atomicity.** Staged intake is persisted BEFORE the account
   step (`legal.client.create` contact + `questionnaire_response` via the existing
   `intake.stage` seam) so a balk leaves a recoverable, queryable lead using EXISTING
   kinds — no new "lead" kind. On account success the normal `intake.submit → matter.open
   → booking.create` runs attributed to the NEW client actor (contact deduped by email, so
   the staged contact is reused, not duplicated).
4. **Account-takeover guard at the gate.** The gate creates an UNCONFIRMED Supabase user
   (email ownership not yet proven); portal login stays behind `email_confirmed_at`
   (existing fail-closed gate). If the email already has an auth account, the gate says
   "sign in instead" — it never resets a password without an invite-token proof.
5. **send_portal_invite delivery** uses the existing `client_portal_invite` notification
   route (static transactional template, house voice), NOT email_generation template
   mode: the brief's own boundary assigns transactional templates (incl. portal invite)
   to static templates with no validator; email_generation would route an invite through
   the drafting/review pipeline. Deviation called out in the report.
6. **Fee-consent model.** Action kinds `legal.fee.quote` (system presents; event
   `fee.quoted`) and `legal.fee.accept`/`legal.fee.decline` (client actor; events
   `fee.accepted`/`fee.declined` referencing the quote). Consent is checked server-side
   at the billable act via `assertFeeConsent()` — payload binds
   {client, subject_kind, subject_key, amount|rate, basis}. UI never enforces.
7. **Portal billing "one truth".** The portal's accrued-fees number is computed by the
   SAME `listUnbilled()` the attorney billing panel uses, scoped to the client's matters
   and projected client-safe (recorded ledger events only; no estimates).
8. **Documents stop being durably public.** `legal.draft.get_shared` now requires a
   short-lived HMAC token (share emails mint it) or the client session (portal). The
   bare `/d/<versionId>` capability-URL door is closed; old emailed links break —
   deliberate, reported.
9. **Pay magic link** reuses the #320 HMAC token pattern (`paymentLinkToken.ts`,
   14-day TTL, binds invoice number + tenant). The pay page accepts session OR token;
   both doors reach the same invoice + payment rails. No second token system.
10. **Chatbot scoping** lives in the tool closures (each tool closes over the
    session-resolved clientContactId/actorId; no id accepted from the model), and the
    client route registers ONLY the client tool array — the attorney tool builder is
    never imported there.
11. **Billable-scheduling toggle** = `portal_scheduling_billable` attribute on the
    client entity (default absent = OFF), set via existing `legal.client.update`.
