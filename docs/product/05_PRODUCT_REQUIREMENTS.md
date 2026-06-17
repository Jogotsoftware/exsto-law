# Pacheco Law Software — Product Requirements

Living document. Requirement IDs are stable across revisions; new requirements get new IDs. Section status: **MUST** (in active build), **SHOULD** (planned, sequenced), **COULD** (roadmap), **FUTURE** (post-product-market-fit).

> Maintain in `docs/product/05_PRODUCT_REQUIREMENTS.md`. This revision applies three corrections vs. the wedge-era draft: §11 reframed to the operation-core model (ADR 0038), Open Decision #7 resolved (fresh certified clone), REQ-PERF-01 updated to the certified measurement.

---

## 1. Product overview

An AI-native legal practice platform. Built on the Exsto substrate. Pacheco Law Firm (solo NC attorney, Juan Carlos Pacheco) is the first customer and tenant zero.

Three product layers compose over time:

- **The wedge** — auto-generated North Carolina LLC operating agreements from structured client intake + recorded consultation transcripts, with full reasoning trace for attorney review.
- **The platform** — a Clio Manage replacement: matter management, time tracking, billing, document management, communications, CRM, co-counsel collaboration, configurable per-firm workflows.
- **The marketplace** — a cross-firm referral network with shared AI effectiveness, the long-term defensible moat.

Every customer-facing surface goes through the operation core's adapters (MCP primary). Substrate primitives are tenant-scoped. Every change is auditable with provenance, reasoning, intent, and reversibility paths.

---

## 2. Stakeholders

- **Attorney** (primary user) — drafts, reviews, approves, bills, manages matters, owns the firm's library of templates and rules.
- **Staff** (paralegals, future additional attorneys, billing admins) — scoped access to matters and operations.
- **Prospects** — submit intake anonymously, book consultations, fill matter-type-specific questionnaires.
- **Clients** (post-engagement) — view their matters, sign documents, communicate with the attorney, pay invoices.
- **Co-counsel** (future) — attorneys at other firms with scoped access to specific matters.
- **Firm administrator** (future, may be the attorney) — configures the firm's libraries, rules, billing setup, integrations.

---

## 3. Phase 0 — The Wedge (MUST)

### 3.1 Intake & Booking

**REQ-INTAKE-01.** The product presents prospects with a 4-step intake flow: service selection → contact info → matter-type-specific intake form → booking page.

**REQ-INTAKE-02.** Service selection offers three options at launch: single-member NC LLC formation, multi-member NC LLC formation, "something else" (catch-all).

**REQ-INTAKE-03.** Contact info captures name, email, and phone number. Phone is required.

**REQ-INTAKE-04.** Each service option binds to a matter-type-specific intake form. Single-member uses the canonical NC single-member OA questionnaire. Multi-member uses a stripped-down intake (number of members, member contact info, business description, anticipated timeline). "Something else" uses a free-text "tell us about your matter" prompt.

**REQ-INTAKE-05.** The booking page is gated — prospects cannot select a consultation time until they have completed steps 1–3.

**REQ-INTAKE-06.** The booking page displays availability from the attorney's Google Calendar (Pacheco Law account only). Bookings create a calendar event on that calendar and send a confirmation email to the prospect.

**REQ-INTAKE-07.** Prospects are not required to authenticate. Account creation happens implicitly on form submission, indexed by email + phone.

### 3.2 Consultation Recording & Transcription

**REQ-CALL-01.** Consultations are recorded and transcribed via Granola (Business plan, API integrated). Recording is bot-free — Granola captures system audio without joining the call as a visible participant.

**REQ-CALL-02.** On consultation completion, Granola fires a webhook to the product. The product fetches the full transcript and Granola's structured AI notes via the API, writes them through the action layer with `integration:granola` as the source.

**REQ-CALL-03.** The product stores raw call payloads in raw_event_log per substrate invariant 14 (append-only), and projects them to `call_session` and `transcript` entities.

**REQ-CALL-04.** Audio is not retained by the product. Granola deletes audio post-transcription per their SOC 2 architecture.

### 3.3 Document Auto-Generation

**REQ-DRAFT-01.** For single-member NC LLC formation matters, the product auto-generates a draft operating agreement and a draft engagement letter from the submitted questionnaire data + the consultation transcript.

**REQ-DRAFT-02.** Drafting uses the Claude API with a templated prompt that consumes the intake schema fields and transcript content as structured inputs.

**REQ-DRAFT-03.** Every drafting call produces a `reasoning_trace` row containing the prompt, evidence considered (which intake fields, which transcript excerpts), alternatives evaluated, conclusion, and confidence per substrate invariant 20.

**REQ-DRAFT-04.** Generated documents respect the firm's rule set. For Pacheco Law's first workflow, the binding rule is "North Carolina law."

**REQ-DRAFT-05.** For multi-member and "something else" matters, the product does not auto-generate documents at launch. These matters route to a manual workflow where the attorney drafts independently after the consultation.

### 3.4 Attorney Review & Approval

**REQ-REVIEW-01.** The attorney app presents a matter dashboard listing all open matters with status, matter type, client, and date filters.

**REQ-REVIEW-02.** The matter detail view shows the questionnaire response, the call transcript, the generated drafts, and the workflow state.

**REQ-REVIEW-03.** The draft review screen presents the document body alongside the structured reasoning trace, with visible provenance badges (which intake field, which transcript excerpt, which attorney rule) and confidence indicators on each section.

**REQ-REVIEW-04.** The attorney can approve, request a revision, or reject any draft. Each action is captured through the action layer with intent and is reversible per substrate invariant 11.

**REQ-REVIEW-05.** Approved drafts can be edited inline before final delivery; edits are tracked as new document_version rows, not destructive overwrites, per invariant 14.

### 3.5 Notifications

**REQ-NOTIFY-01.** On new matter creation, the product notifies the attorney. The booked calendar event is the primary notification for consultation matters; email covers manual-workflow matters and async draft completion. Notifications include matter type, prospect contact info, and a link to the matter detail view. (SMS deferred — the notification interface is provider-agnostic so SMS can be added later with no call-site changes.)

**REQ-NOTIFY-02.** Notifications fire reliably for multi-member and "something else" matters, since those route to the manual workflow and require attorney attention without auto-generation visible.

**REQ-NOTIFY-03.** The product sends confirmation emails to prospects on intake submission and booking confirmation.

### 3.6 Demo Readiness

**REQ-DEMO-01.** The product runs locally on the attorney's laptop for demo via `pnpm install && pnpm build && pnpm seed:demo && pnpm preflight && pnpm dev:*`.

**REQ-DEMO-02.** A `pnpm seed:demo` script loads a realistic two-founder NC LLC formation matter end-to-end through the action layer, with a pre-generated draft cached in the database.

**REQ-DEMO-03.** A `pnpm preflight` script verifies database connectivity, API key validity, seed data presence, and all services starting cleanly.

**REQ-DEMO-04.** A dev-mode `?demo_user=` query parameter bypasses real auth flows for the demo. Gated to `NODE_ENV !== 'production'`.

### 3.7 Calendar & Mail Workspace (added)

**REQ-CALMAIL-01.** The attorney app includes a Calendar tab giving full visibility and management of the connected Pacheco calendar (day/week/month): create, edit, reschedule, and cancel events in-app; changes write through the action layer and round-trip sync to Google Calendar; external changes appear in-app. Consultation events link to their matters.

**REQ-CALMAIL-02.** The attorney app includes a Mail tab surfacing client-related Gmail threads (matched to matter contacts by email), shown on the Mail tab and on each matter as matter-scoped communication history. The attorney can read, reply, and compose to clients in-app; sends go through the action layer with `integration:gmail` provenance and his real Gmail account; inbound client mail is ingested via raw_event_log, idempotent on Gmail message ids.

**REQ-CALMAIL-03.** Client-related mail only — never ingest or display unrelated personal/firm mail. ~~Gmail scopes requested incrementally on first Mail tab use.~~ **Superseded:** a single "Connect Google" grants the full set (calendar + Gmail read + Gmail send) in one consent — the incremental "Enable Mail" step was retired so an attorney connects once. The client-related-mail-only discipline still holds (the Mail tab queries are scoped to known matter-contact addresses regardless of the granted read scope).

**REQ-CALMAIL-04.** Integration connection UX: one-click "Connect Google Calendar" / "Connect Granola" from a Settings screen — visible connection health, reconnect path on token expiry, no developer steps for the attorney. A broken connection is shown prominently.

---

## 4. Phase 1 — The Library Layer (SHOULD, after wedge demo)

### 4.1 Service-Kind as First-Class Configuration

**REQ-LIBRARY-01.** Service kinds (matter types) are first-class definition rows in the substrate. Adding a new service kind does not require code changes per substrate invariant 12.

**REQ-LIBRARY-02.** Each service kind binds to five configurable aspects: intake questionnaire, document template(s), drafting prompt, attorney rules, and booking rules.

### 4.2 Questionnaire Library

**REQ-LIBRARY-03.** The attorney can upload a PDF or Word document and have it become a questionnaire template with parameterized variables, manually mapping fields to types and validation rules.

**REQ-LIBRARY-04.** The attorney can build a questionnaire from scratch through a UI form builder.

**REQ-LIBRARY-05.** Questionnaires are versioned. Existing matters retain their pinned version; new matters get the latest version by default.

### 4.3 Document Template Library

**REQ-LIBRARY-06.** The attorney can upload a document template (PDF or Word) and mark variable slots that bind to questionnaire field IDs.

**REQ-LIBRARY-07.** Templates are versioned. Drafted documents pin to the template version used.

### 4.4 Prompt Library

**REQ-LIBRARY-08.** Drafting prompts are versioned definitions. Prompts reference questionnaire field IDs and template variables explicitly.

**REQ-LIBRARY-09.** The attorney can edit prompts through a UI with a preview mode that shows what fields and variables resolve to for a sample matter.

### 4.5 Rules Library

**REQ-LIBRARY-10.** Attorney rules are firm-level constraints applied during drafting (jurisdiction, language, format, mandatory clauses, forbidden phrasings). The attorney edits rules through a UI.

**REQ-LIBRARY-11.** Rules are versioned and bound to service kinds.

### 4.6 Booking Rules ("Calendar" Tab)

**REQ-LIBRARY-12.** Each service kind has a configurable booking rule set: consultation length, buffer time before/after, availability windows specific to the service kind, lead time / minimum notice, maximum bookings per day, cancellation and reschedule policy.

**REQ-LIBRARY-13.** Booking rules are surfaced in the Calendar tab in the attorney app. The booking page reads the rules at render time per matter-type selection.

**REQ-LIBRARY-14.** Per-service-kind pricing is supported as a deferred field for future invoicing integration.

### 4.7 AI Assistant & Beta Feedback (added)

**REQ-ASSIST-01.** An attorney-facing AI assistant over the practice via MCP: matter summaries, "what's stalled," status-email drafts from matter history. Every assistant action is reasoning-traced.

**REQ-FEEDBACK-01.** A beta feedback affordance inside the assistant and on every app screen. Captures context automatically (route/screen, matter id, recent action, app version) plus the attorney's note. Stored substrate-native (feedback entity kind + feedback.submit action), tenant-scoped, queryable by the founder via MCP for triage with a status attribute (new/reviewed/planned/done).

---

## 5. Phase 2 — Workflow Expansion (SHOULD)

### 5.1 Multi-Member as First Library-Built Workflow

**REQ-WORKFLOW-01.** Multi-member NC LLC formation is built through the library layer as a configuration change — uploading the multi-member intake questionnaire, the multi-member OA template, the multi-member drafting prompt, and the matching attorney rules — without code commits.

**REQ-WORKFLOW-02.** Multi-member matter creation triggers auto-generation once configured.

### 5.2 Additional Document Auto-Generation

**REQ-WORKFLOW-03.** The attorney can add new document types beyond OAs and engagement letters by adding their templates + prompts + rules to the libraries. Initial candidates: NDAs, letters to opposing counsel, motions, amendments, trust and estate documents.

**REQ-WORKFLOW-04.** A single matter can produce multiple documents, each with its own draft / review / approve workflow.

**REQ-WORKFLOW-05.** Chained drafting workflows are supported — a draft's output can feed the prompt for a subsequent draft (open spec; for future detail).

### 5.3 E-Signature (moved to Phase 2)

**REQ-ESIGN-01.** Approved drafts can be sent for e-signature (provider TBD: DocuSign vs Dropbox Sign vs equivalent); signed documents land back on the matter with full provenance.

### 5.4 Client Portal, Ongoing Calls, Deadlines (added)

**REQ-PORTAL-01.** Post-engagement client portal: matter status view, secure messaging, client document uploads.

**REQ-CALL-05.** Ongoing-matter call capture: the Granola path extends beyond consultations to calls on active matters.

**REQ-DEADLINE-01.** Matter deadlines with worker-driven reminders (general deadlines; court-rules engines remain deferred).

---

## 6. Phase 3 — Clio Manage Replacement (COULD, mid-term)

### 6.1 Matter Management

**REQ-MATTER-01.** Matters have status, type, client, opening date, billing arrangement, governing law, and arbitrary attribute observations per invariant 7.

**REQ-MATTER-02.** Matters can have sub-tasks and projects organized hierarchically.

**REQ-MATTER-03.** Documents, communications, time entries, and tasks all attach to matters as relationships.

### 6.2 Time Tracking

**REQ-TIME-01.** The attorney can log billable and non-billable time entries against matters. Each time entry records description, duration, hourly rate (resolved from billing arrangement), date, and matter reference.

**REQ-TIME-02.** Time tracking supports timer mode (start/stop) and manual entry.

**REQ-TIME-03.** Time entries are append-only per invariant 14; corrections are new entries referencing the original.

### 6.3 Staff, Permissions, CRM, Documents, Communications, Co-Counsel

**REQ-STAFF-01.** Staff & permissions precede other Phase 3 features: multiple actors per tenant with scoped roles (paralegal vs attorney).

**REQ-CRM-01.** Prospects, referral sources, and leads are first-class entity kinds.

**REQ-CRM-02.** The CRM tracks referral source for every matter — who sent this client, what relationship, when.

**REQ-CRM-03.** Lead status tracking — prospect → consulted → engaged → matter active → matter closed → referral source for future leads.

**REQ-CRM-04.** The product surfaces "your top referral sources" and "matters by referral source" reports.

**REQ-DOC-01.** All documents (drafts, finalized, signed, client uploads, opposing-counsel documents) are first-class with version history, attached to matters.

**REQ-DOC-02.** Documents can be stored in Google Drive (primary, OAuth-attached) or natively in the product's storage (Supabase Storage).

**REQ-DOC-03.** Full-text search across all firm documents, scoped by tenant.

**REQ-COMM-01.** Matter-scoped communication threads — email, text, in-app notes — all attached to matters and queryable as a unified history (extends the Phase 0 Mail workspace).

**REQ-COMM-02.** Tasks within matters are entity kinds with status, due date, assigned actor, and parent matter reference.

**REQ-COMM-03.** Communications captured automatically when sent through the product (Gmail integration), and supports forwarding inbound communications for indexing.

**REQ-COUNSEL-01.** The attorney can share a specific matter with an attorney at another firm (different tenant) via a deliberate cross-tenant pathway per invariant 1.

**REQ-COUNSEL-02.** Co-counsel access is scoped — they see only matters explicitly shared, with permissions controlled by the originating attorney.

**REQ-COUNSEL-03.** Reasoning traces, matter history, and document drafts are shared with co-counsel by default within a shared matter; specific items can be marked privileged-to-originating-firm and excluded.

**REQ-COUNSEL-04.** Co-counsel actions on shared matters are captured with full provenance — both firms see the same audit trail.

**REQ-MIGRATE-01.** Clio data migration: import existing matters/contacts/documents for firms leaving Clio.

### 6.4 Deferred Clio-Equivalent Features (COULD)

- Conflict checking — search all prior and current matters for parties before accepting new matters
- Court date / deadline management — court-rules-aware scheduling
- Mobile app
- Reporting and analytics — productivity, AR aging, conversion rates, etc.
- Integration marketplace — QuickBooks, Outlook, Zoom, Slack

---

## 7. Phase 4 — Billing & Accounting (re-sequenced from Phase 3)

**REQ-BILL-01.** Invoices are derived from time entries + matter + fee structure. Generated as draft, reviewed by attorney, sent to client.

**REQ-BILL-02.** Supports hourly billing, flat fee, contingency, and hybrid arrangements per matter.

**REQ-BILL-03.** Tracks invoice state — draft, sent, viewed, paid, overdue — with payment events captured through the action layer.

**REQ-BILL-04.** Integrates with a payment processor (Stripe or LawPay or similar; decision pending). Client invoice view + pay in portal.

**REQ-TRUST-01.** Decision pending: build native trust accounting (three-way reconciliation, separate ledger, state-bar regulated) or integrate with a specialized tool and stay out of the regulated lane. ADR required.

**REQ-TRUST-02.** If built native, the trust ledger is a separate account context per matter, with deposit, disbursement, and reconciliation as distinct action kinds, each carrying full audit and intent.

**REQ-ACCT-01.** Firm operating accounting: QuickBooks integration vs native GL decision (the foundation's append-only events + periods support GL natively).

---

## 8. Phase 5 — Referral Marketplace (FUTURE, the moat)

**REQ-MARKET-00.** Gate before phase: firm onboarding (tenant provisioning + library setup for firm #2).

**REQ-MARKET-01.** Attorneys on the platform can route matters they cannot or do not want to handle to other attorneys on the platform, matched by practice area, jurisdiction, and prior relationship.

**REQ-MARKET-02.** Referrals are first-class — a referral has source attorney, destination attorney, matter type, status (offered, accepted, declined, completed), and outcome.

**REQ-MARKET-03.** Referral compensation is configurable per relationship — flat referral fee, fee split, or non-monetary (reciprocal credits).

**REQ-MARKET-04.** AI effectiveness as a derived property (per ADR 0028) aggregates across firms — what document types produce the best draft acceptance rates, what intake patterns predict matter success, what prompts produce drafts that need less attorney revision.

**REQ-MARKET-05.** Cross-firm signal is anonymized; individual attorney data is not exposed across firm boundaries except where explicitly authorized.

**REQ-MARKET-06.** Referral fee structure complies with each state's ethics rules (NC Rule 1.5(e) and equivalents). Disclosure is built into the referral flow.

**REQ-MARKET-07.** The platform does not engage in attorney advertising or matching that would constitute unauthorized practice or improper solicitation under any participating state's rules. ADR documenting this decision is required before any marketplace launch.

---

## 9. Cross-Cutting Requirements (MUST throughout)

### 9.1 Authentication & Identity

**REQ-AUTH-01.** Attorneys and staff authenticate via Google SSO through Supabase Auth.

**REQ-AUTH-02.** The client portal accepts anonymous intake submission. Accounts are implicit, indexed by email + phone.

**REQ-AUTH-03.** Sign-in is identity-only (base profile + email, no refresh token, no credential storage). ~~OAuth scopes are requested incrementally — additional scopes requested when each feature is first used.~~ **Superseded:** the post-login "Connect Google" requests the full feature scope set (calendar.events + gmail.send + gmail.readonly) in one consent rather than incrementally, so an attorney connects once and has calendar + full email. (Sign-in itself stays minimal-scope; only the explicit connect step grants the feature scopes.)

**REQ-AUTH-04.** Multi-account support is deferred — only the firm's primary Google account is in scope at launch (no secondary account merge).

### 9.2 Multi-Tenancy

**REQ-TENANT-01.** Every row in the substrate is tagged with `tenant_id` per invariant 1. Postgres RLS enforces tenant isolation.

**REQ-TENANT-02.** Cross-tenant access exists only through deliberate, separately-governed pathways (co-counsel sharing, marketplace referrals).

**REQ-TENANT-03.** A firm can have multiple staff actors within its tenant; permission scopes per actor are configurable.

### 9.3 Audit, Provenance & Reasoning

**REQ-AUDIT-01.** Every change has an action row with timestamp, actor, intent, source, and confidence per invariants 5, 9, 10.

**REQ-AUDIT-02.** Every agent action produces a reasoning_trace row capturing prompt, evidence, alternatives, conclusion, and confidence per substrate invariant 20.

**REQ-AUDIT-03.** Append-only event tables get no UPDATE or DELETE per invariant 14.

### 9.4 Reversibility & Governance

**REQ-GOV-01.** Every action declares an autonomy tier (autonomous, notify, approve, suggest) per invariant 22.

**REQ-GOV-02.** Every action has a reversibility path — directly reversible, requires reverse action, or gated as irreversible per invariant 11.

### 9.5 Integrations

**REQ-INT-01.** External integrations are typed sources per invariant 5 — `integration:granola`, `integration:google_calendar`, `integration:gmail`, etc.

**REQ-INT-02.** Integrations route writes through the action layer with full provenance.

**REQ-INT-03.** Webhook payloads are stored in `raw_event_log` and projected to substrate entities deterministically per invariant 13.

### 9.6 Security & Compliance

**REQ-SEC-01.** All credentials and secrets stored in Supabase Vault, never plaintext.

**REQ-SEC-02.** All integrations used by the firm are SOC 2 Type II at minimum (Granola, Anthropic, Google, Supabase).

**REQ-SEC-03.** Attorney-client privilege is preserved — privileged matter content is never used to train third-party models, never exposed cross-firm except through deliberate sharing.

**REQ-SEC-04.** Audio is not retained by the product (Granola handles deletion post-transcription).

**REQ-SEC-05.** Backup, encryption at rest, and incident response policies documented before any client beyond Juancito is onboarded (pinned to end of Phase 1).

### 9.7 Mobile & Responsive

**REQ-UX-01.** The attorney app and client portal are responsive — usable on phone for at-a-glance use cases.

**REQ-UX-02.** A native mobile app is deferred to post-Clio-parity.

### 9.8 Performance

**REQ-PERF-01.** Substrate operations are certified at ~26ms per primitive operation under no contention (measured in foundation certification; 50ms budget).

**REQ-PERF-02.** Drafting calls (Claude API) target under 30 seconds; drafting runs async via the worker runtime from Phase 0 (wedge lesson #2).

**REQ-PERF-03.** Client booking page renders availability in under 1 second from page load.

---

## 10. Out-of-Scope / Explicitly Deferred

- Native trust accounting (IOLTA) — decision pending build vs integrate (Phase 4)
- E-signature wiring — Phase 2 (stub only in Phase 0)
- SMS notifications — deferred; interface is provider-agnostic for later addition
- Real-time calendar push notifications (Google Calendar watch channels) — polish item; Phase 0 uses sync with sensible refresh
- Native mobile app — post-Clio-parity
- Conflict checking, court rules, court-date management — Phase 3+
- Multi-language support — Phase 3+
- Marketplace launch — Phase 5
- Replacing the underlying Claude model with a fine-tuned legal model — future, after the marketplace produces cross-firm signal

---

## 11. Open Decisions

1. **Trust accounting** — build native or integrate. Required for true Clio replacement. ADR pending (Phase 4).
2. **Multi-member intake form shape** — stripped-down (6–8 questions) confirmed pending; could also be free-text only.
3. **E-signature provider** — DocuSign, Adobe Sign, Dropbox Sign, or HelloSign (Phase 2).
4. **Payment processor** — Stripe or LawPay or other legal-specific provider (Phase 4).
5. **Document storage primary** — Google Drive (attached via OAuth) or Supabase Storage (product-native) (Phase 3).
6. **Marketplace fee model** — flat referral, fee split, reciprocal credits, or hybrid (Phase 5).
7. **RESOLVED:** exsto-law is a fresh clone of the certified foundation (v1.0.0) via /newplatform — its own repo and Supabase project. exsto-wedge is superseded: reference for lessons only, never a dependency.

---

## 12. Architectural Foundations (Reference)

The product is built on the Exsto substrate (certified foundation v1.0.0). The substrate's 23 Layer 1 invariants and Layer 2 primitives constrain implementation in ways that produce most of the cross-cutting requirements above for free. See `ARCHITECTURE.md` and the ADRs for detailed specifications.

Key architectural commitments that shape product behavior:

- **Substrate-with-clients.** UIs, agents, and integrations plug into the substrate via the operation core's adapters; the substrate persists, clients evolve.
- **Operation core with sibling adapters (ADR 0038).** No client touches substrate tables directly; all clients go through one operation core enforcing tenancy, append-only, provenance, and reasoning. MCP is the primary adapter; REST is a permitted second thin adapter over the same core — never a parallel CRUD layer.
- **Schema-as-data.** Every kind of thing is a row in a definition table — new matter types, document types, prompt types, rule types added through the library layer, not through code.
- **AI effectiveness as a derived property.** Not separately tracked. Computed from actions, reasoning traces, judgments, and outcomes.
- **Append-only history.** Nothing is overwritten or deleted. Corrections are new rows referencing what they correct.
- **Money (ADR 0044).** Monetary amounts are decimal strings in jsonb with `(amount, asset_ref)`; assets are entities. Applies from Phase 4 billing onward.

---

*Maintain in `docs/product/05_PRODUCT_REQUIREMENTS.md` going forward.*
