# exsto-law Roadmap

AI-native legal practice platform on the Exsto substrate. Pacheco Law Firm = tenant zero.
Fresh build on the certified foundation; exsto-wedge is reference for lessons, never a dependency.
Source of truth for build sequencing. Each phase ends with a hard stop: verify → PRs → report → await founder go.

## Phase 0 — The Wedge
- Anonymous intake, 3 service kinds: NC LLC single-member / multi-member / "something else" catch-all
- Gated booking on REAL Google Calendar (Pacheco account); the calendar event IS the attorney's primary notification
- REAL Granola integration: webhook → raw_event_log → call_session + transcript entities; no audio retention
- AI drafting (single-member only): OA + engagement letter from questionnaire + transcript; reasoning_trace per call; NC-law rules. Multi-member + catch-all → manual workflow + attorney email
- ASYNC drafting via worker runtime (never inline)
- Attorney review: dashboard, matter detail, draft review with provenance badges + confidence; approve/revise/reject; inline edits = new document_version rows
- CALENDAR & MAIL WORKSPACE: full in-app visibility and management of the attorney's calendar (create/edit/cancel, round-trip sync with Google) and client-related Gmail (read/reply/compose in-app, matter-scoped threads, client-mail only)
- One-click integration connection UX: Connect Google Calendar / Connect Granola from a settings screen; visible health, reconnect path, no developer steps
- Email notifications (Gmail API, existing OAuth): attorney on manual-workflow matters + draft completion; prospect confirmations. NO SMS in Phase 0
- REAL auth: Google SSO (Supabase Auth) for attorney; public-intake system actor for anonymous portal
- Demo seed + preflight scripts; ?demo_user= bypass gated to non-production
- UI: Clio-style conservative — left sidebar (Dashboard, Matters, Review, Calendar, Mail, Settings), clean tables, muted navy/gray, shadcn/ui legal theme

## Phase 1 — Library Layer + AI Assistant
- Service kinds as configuration, five bindings each: questionnaire (PDF/Word upload → parameterized, or UI builder), document templates with variable slots, drafting prompts with preview, attorney rules, booking rules (Calendar tab: length, buffers, windows, lead time, daily caps)
- All versioned; matters pin versions; templates move from repo files to substrate content rows
- AI ASSISTANT: attorney chat over the practice via MCP — matter summaries, "what's stalled", status-email drafts from history
- BETA FEEDBACK: feedback button inside the assistant + every app screen. Captures context automatically (route/screen, matter id, recent action, app version) + Juan Carlos's note. Stored substrate-native: feedback entity kind + feedback.submit action, tenant-scoped, queryable by the founder via MCP for triage (status attribute: new/reviewed/planned/done)
- GATE (end of phase): production-readiness docs (backup, encryption, incident response) before any client beyond Juan Carlos

## Phase 2 — Workflow Expansion + E-Signature + Client Portal
- Multi-member LLC as first library-built workflow (config only, no code)
- New document types via libraries (NDAs, amendments, opposing-counsel letters, trust/estate); multiple docs per matter, each with its own review loop; chained drafting (draft output feeds next prompt)
- E-SIGNATURE (provider TBD: DocuSign vs Dropbox Sign): approved drafts out for signature; signed docs land on the matter
- CLIENT PORTAL (post-engagement): matter status view, secure messaging, client document uploads
- Ongoing-matter call capture (Granola path extended beyond consultations)
- Matter deadlines + worker-driven reminders

## Phase 3 — Clio Replacement Core
- Staff & permissions FIRST: multiple actors per tenant, scoped roles (paralegal vs attorney)
- Matter management: subtasks, hierarchy, attachments-as-relationships
- Time tracking: timer + manual; append-only corrections
- CRM: referral sources, lead pipeline (prospect → consulted → engaged → active → closed → referrer), top-referrer reports
- Document management: storage decision (Drive vs Supabase Storage), full-text + hybrid search
- Matter-scoped communications: Gmail capture, unified history (extends Phase 0 Mail workspace)
- Co-counsel cross-tenant sharing with privilege controls
- CLIO DATA MIGRATION: import matters/contacts/documents (adoption gate for firms leaving Clio)
- Deferred tail: conflict checking, court-rules deadlines, reporting, mobile app

## Phase 4 — Billing & Accounting
- Invoicing from time entries + fee structures (hourly/flat/contingency/hybrid); invoice states with payment events
- Payment processor (Stripe vs LawPay); client invoice view + pay in portal
- Trust accounting decision: native IOLTA (three-way reconciliation, separate ledger) vs integrate — ADR required
- Firm operating accounting: QuickBooks integration vs native GL (foundation's append-only events + periods already support GL)

## Phase 5 — Referral Marketplace (the moat)
- GATE before phase: firm onboarding (tenant provisioning + library setup for firm #2)
- Cross-firm referrals matched by practice area/jurisdiction; status lifecycle; configurable compensation (flat/split/reciprocal)
- Anonymized cross-firm AI effectiveness (derived, per ADR 0028)
- State-bar compliance ADR (NC 1.5(e) + equivalents) before launch

## Lessons from exsto-wedge (binding on this build)
1. Stubs leak — build real integrations (Granola, Calendar, auth) from day one; stub assumptions creep into callers.
2. Inline drafting blocks the attorney — async via worker from the start.
3. Templates-as-repo-files = engineer-only editing — acceptable in Phase 0 only; keep the loader interface library-ready for Phase 1.
4. public-intake system actor for anonymous portal writes — settled pattern, reuse.
5. ADRs without executable tests protect nothing — the vertical ships its own test suite.
6. Vertical migrations NEVER touch the core namespace; verticals/legal/ + apps/legal-* convention (ADR 0029).
7. Demo seed + preflight scripts earned their keep — maintain them.
8. "Done" is a database query, not a status message — verify-on-DB discipline applies.

## Autonomy protocol
- Runs with --dangerously-skip-permissions. Blast radius = this repo + this Supabase project only; foundation, exsto-dev, and other clones are out of bounds.
- Branch protection on main: PRs only; founder merges. Autonomy ends at the merge button.
- Phase boundary = hard stop: verify, open PRs, report, await go. Never roll into the next phase.
- Money = the only mid-phase stop: any new billable resource, subscription, plan upgrade, or purchase requires founder approval first. Existing API keys/projects are pre-approved. No SMS providers in Phase 0.
- Secrets scoped to this project only.
