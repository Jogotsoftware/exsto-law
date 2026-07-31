# exsto-law — Project Status

**Purpose of this file:** a single, self-contained snapshot of the product for use OUTSIDE this repo — specifically, Joe pastes this into Claude web (or a fresh Claude Code session with no prior context) to get accurate help drafting the next prompt for Claude Code. It has no access to the codebase, so this file needs to say everything relevant on its own.

**Keep it current.** This is a living document, not an append-only log — when something here ships, gets fixed, or changes, EDIT this file in place (update the section, don’t just add a new dated bullet at the bottom). Last updated: 2026-07-30.

---

## 1. What this is

exsto-law is an AI-native legal practice platform, currently built for and run by Pacheco Law Firm (a real single-attorney/small firm — "tenant zero"). It's meant to eventually replace tools like Clio: matter management, client intake/booking, AI-drafted documents, e-signature, billing, a client portal, and a conversational AI assistant that can both help run the practice and (via a "service builder") let the attorney configure new service offerings without a developer.

**Architecture, one paragraph:** the whole platform sits on "the Exsto substrate" — a Postgres database with strict invariants (tenant-isolated via RLS, append-only event history, every fact has provenance/confidence/time-precision, bitemporal). New business concepts (a "kind" of entity, attribute, relationship, event, workflow step, capability, etc.) are added as DATA ROWS in definition tables, not as new code/tables/enums — "schema as data." All writes go through an action layer (never raw SQL from app code); MCP is the primary client interface exposing ~337 operations. The one real product on this substrate today is the `legal` vertical (`verticals/legal/`) with its UI in `apps/legal-demo` (Next.js — hosts both the attorney app at `/attorney/*` and the client portal at `/client/*` in the same app). A background worker (on Render, not Netlify) drains async jobs (AI drafting, notifications, capability auto-run).

**Multi-tenant status:** the platform supports multiple firms (tenants) technically, but Pacheco Law is the only REAL, live tenant today. A second real firm has not yet been onboarded — several hardcoded "tenant-zero" assumptions are known to exist in places (flagged repeatedly across the codebase as "2nd-firm hazard").

---

## 2. What's built and live (major systems)

This list is at the level Claude web needs — "this exists and works," not file-level detail.

- **Public booking + intake funnel** (`/book/{slug}`) — multi-tenant-aware (resolves firm by slug), collects service selection, questionnaire answers, mailing/business address, preferred contact method, offers bilingual (English/Spanish) intake where a service supports it.
- **Matter lifecycle / workflow engine** — services are built from a graph of steps (intake, drafting, review, e-sign, billing, etc.); matters advance through their bound workflow automatically or on attorney/client action. Workflow steps can invoke "capabilities" (reusable executable building blocks — e.g. AI document review, request client materials) that auto-run on stage entry.
- **AI drafting** — questionnaire answers + call transcript (via Granola integration) feed a templated AI drafting pass per document type; produces a reviewable draft with a reasoning trace, confidence, evidence.
- **Attorney review & approval** — draft review UI with inline edits (new versions), approve/reject/revise; a unified attorney **Task Queue** aggregates everything "awaiting me" (reviews, workflow steps, to-dos) in one place.
- **E-signature** — full native e-sign (not a 3rd-party product): send any approved document (or an arbitrary uploaded PDF) for signature, drag-and-drop field placement per signer role, multi-signer support including attorney countersigning, pre-signed attorney signature blocks, open-ended signer chains (add another signer mid-flow), guided signing UX in the portal, executed-copy delivery via email (Resend).
- **Client portal** — matter status, secure messaging, document upload/download, e-sign, online invoice payment, returning-client sign-in.
- **CRM** — clients/contacts with Overview/Documents/Activity tabs (aggregated across all of a person's matters), opposing-party/contact concepts still limited (see gaps below).
- **Templates & merge tokens** — a template-authoring system with a classified merge-token system (CLIENT-supplied / ATTORNEY-supplied / SYSTEM tokens) so the questionnaire, the AI drafting prompt, and the document body stay conceptually aligned; an editable engagement-letter template library (default + custom per firm).
- **Service builder (conversational, chat-driven)** — an attorney can describe a new service in chat and the AI proposes: intake questionnaire, document template(s), pricing/billing, and a workflow graph, each requiring explicit attorney approval before going live. Gated behind a feature flag (`LEGAL_BUILD_WIZARD`), currently enabled.
- **Billing** — invoice generation, manual payment recording (Zelle/crypto), and **Stripe Connect Express online payments are built and merged but still in TEST MODE only** — going fully live needs real platform Stripe keys, Connect approval, webhook registration (see Known Gaps).
- **Firm settings** — rates/pricing (firm-wide default + overrides), booking rules (hours/buffers/lead time), firm profile/branding, standing attorney signature.
- **AI assistant (chat)** — a conversational assistant embedded throughout the attorney app and the client portal, backed by a direct Anthropic API integration (not MCP) with its own tool surface (~24 attorney tools, 9 client-portal tools) plus a substrate-seeded "skills" system (~110 runtime skills) it can load contextually.
- **Users & roles** — multiple staff per firm with scoped roles (attorney/paralegal/standard), separate from client-portal user accounts.
- **Integrations live in production:** Google Calendar, Granola (call transcription), Anthropic (AI), Resend (transactional email), Stripe (test mode).

---

## 3. Recently shipped (last ~30 merged PRs, most recent first, all on `main`, no open PRs as of 2026-07-30)

- MULTI-PARTY-1 — services involving multiple parties work end to end: the repeating intake group is now config-driven (each service declares its own per-person fields, including the email that makes someone signable), captured people become real matter contacts (`matter_contact`, now readable by the CRM), and a signature role can expand into one signature block + one signature request per actual party instead of a static count (#509)
- SB-FIX-1 — four service-builder defects fixed (#508)
- DOC-RENDER-2 — a draft's persisted per-document font now reaches every reader (share link, e-sign signing pane, executed copy), matching review + PDF; first pass of the one-modal-per-concern audit landed as `docs/diagnostics/MODAL-AUDIT.md`; the leaked markup stored in the prod Operating Agreement template was healed through the action layer (#505)
- Untrack Netlify CLI link state, gitignore `.netlify/` (#504)
- DOC-RENDER-1 — fixed the raw-markup leak (two bugs: a display-side plain-text stripper, and the template editor's save path persisting chip markup) and unified every document surface onto the shared `DocumentSheet` (#503)
- Open-ended signer chains — add another signer mid-envelope (#502)
- Service-scoped signers collect-at-intake (#501)
- Attorneys can pre-sign their own signature block in a template (#500)
- Chatbot/builder "awareness gap" logging discipline added to CLAUDE.md + `docs/design/assistant-actions/INVENTORY.md` (#499) — see §5 below, this is now a standing process
- Signable sessions surfaced in the Task Queue, saved-signature prefill (#498)
- Tabbed template rail + drag-and-drop signer field bindings for e-sign (#496)
- Client mailing/business address + preferred contact captured at sign-up (#495)
- Matter status now always derived from the live workflow (fixed a stale-status-chip bug) (#492/#494)
- Task Queue unified from the old Review Queue + added Workflow Step/To-Do sources (#489/#491)
- Bilingual (English/Spanish) document offering at the service level (#490)
- Engagement letters as an editable template library + per-client override (#487/#488/#493)
- CRM Documents + Activity tabs on client/contact records (#484)
- Combined e-sign gate modal + real rendered agreement document (#485/#483/#474)
- Users & Roles split into two tabs + portal user tiers (#475)
- Various e-sign hardening (portal authz, PDF-flip fix, guided signing, countersigner, executed-copy email) (#470–#482, several PRs)

---

## 4. Known gaps and open work

### 4a. From a live attorney-testing pass this week (2026-07-24, building a multi-member LLC service end to end)

These are real, reproduced gaps found by using the product, not a code guess:

1. ~~**Multi-member/multi-party intake capture is missing.**~~ **FIXED 2026-07-30 (MULTI-PARTY-1, PR #509).** The repeating intake group (`members_repeater`) existed but the booking form ignored its configured `memberFields` and rendered a hardcoded LLC-member row, so a service could never ask for other members' emails; and nothing turned captured people into contacts. Now: the member row is config-driven (each service declares the per-person sub-fields it needs), `matter.open` creates each captured person as a real `client_contact` and links them to the matter via the existing `matter_contact` relationship, the CRM contact↔matter traversals read that link (it had been write-only, so party contacts showed no matters), and the builder's `propose_questionnaire` now *requires* a repeating group with per-person name + email for any service that can involve more than one person. Proven in the Pacheco tenant: a 3-member intake produced 3 linked contacts, each showing the matter on their CRM record.
2. **Service-builder wizard loses its place.** Revising a questionnaire after a later step (billing) was already approved caused the wizard to lose track of where it was in the build.
3. **Template and questionnaire drift out of sync.** Adding/changing an intake field doesn't automatically add the matching merge token to the associated document template.
4. **No subtle way to restart/quit the builder wizard mid-build.** Needs an elegant, low-key control (not a jarring Cancel button) — design not yet chosen.
5. ~~**No dynamic per-signer signature blocks.**~~ **FIXED 2026-07-30 (MULTI-PARTY-1, PR #509).** A template e-sign role can now be marked "one signature request per party" (`repeatPerParty`). The template author writes ONE execution block using the role's key; when the matter is drafted — the moment the party count is actually known — that block is replicated per party with indexed markers, so the attorney reviews and approves the real N signature blocks, and sending expands the role into one signature request per party resolved from the matter's linked contacts. The builder can propose this shape itself and is explicitly told not to hardcode member_1/member_2 roles or pick a static fallback. Proven in the Pacheco tenant: 3 members → 3 signature blocks in the approved document → 3 resolved recipients on the e-sign step.
6. **The workflow's e-sign step has no real in-place UI.** Asking "where do I add the signature spots" sends the attorney to a totally separate, disconnected e-sign composer page requiring manual re-entry of everyone as a recipient, instead of a pop-out modal pre-wired with the matter's contacts and the approved document.
7. **STANDING RULE — jurisdiction/governing-state must always be an intake question by default**, not something the builder only notices and flags conditionally per template.
8. ~~**Template rendering is broadly poor.**~~ **FIXED 2026-07-27 (DOC-RENDER-1, PR #503).** The raw-markup leak turned out to be two separate bugs, and *not* the ones assumed: generation was never emitting broken HTML — the stored body was valid, and the malformation came entirely from a thumbnail helper that stripped markdown characters and printed the body as text. Separately, the template editor's *save* path was persisting TipTap's chip markup instead of `{{token}}`. Both fixed. All document surfaces (builder card, template gallery, service Templates tab, e-sign signing pane, executed-copy review, client-portal engagement gate, share link, review reader) now render through the shared `DocumentSheet`, with a new `DocumentThumb` for cards and a new `fit` variant for readers in a narrow column; the competing `.doc-paper` / bespoke-thumbnail CSS families were deleted so the drift can't recur.

### 4b. Two standing architecture principles that came out of the same testing pass (apply to ALL future work, not just the items above)

- **Reusable pop-out modals.** Document approval, document editing, document review, template editing, e-sign, workflow editing, and intake-form editing should each be ONE reusable modal component used identically everywhere it's needed — never a second bespoke editor built for a new page. A 1-by-1 audit of every current modal against this rule hasn't been done yet.
- **Prompt/context settings hierarchy.** Universal AI-generation rules (e.g. "never invent a value," "documents should look professional," "always use my letterhead") should live in a chat-editable Settings area organized by AI capability (document generation, review, etc.) — NOT inline in the per-service/per-document prompt box, which should hold only genuinely service-specific instructions. That same settings area should also hold one persistent context `.md` file per USER and one per TENANT (firm), analogous to how Claude Code itself keeps user- and project-level memory files — also chat-editable.

### 4c. Chatbot/builder capability gaps (from the codebase-side audit, `docs/design/assistant-actions/INVENTORY.md`)

The AI assistant only knows what its own tool schemas expose — it does not automatically learn about new functionality just because it shipped. As of the last audit, roughly 117 of ~130 attorney-actionable write operations have no chat path at all (the entire CRUD surface for matters/clients/billing/calendar/etc. must still be done by clicking through the UI, not asked for in chat). Specific known-stale items: the Task Queue isn't chat-visible; the engagement-letter library has no chat wrapper; bilingual service toggling can't be set from chat; per-role e-sign field bindings can't be authored from chat; there's still a dead-end for "e-sign a PDF with no matter" (`prepare_envelope`). Full detail lives in that file's §1–§6 if a session needs to dig in.

### 4d. Two audits requested but not yet started

- **Full UI cleanup** — a screen-by-screen walkthrough of the entire product (booking link → client portal → attorney platform) looking for bad buttons and ugly/inconsistent screens.
- **Full functionality audit** — a whole-platform, user-driven walkthrough testing whether every shipped feature actually works end-to-end (distinct from the AI-capability audit above — this one isn't AI-specific).

---

## 5. Standing process note (so Claude web understands why some of this looks "self-aware")

There is now a rule in this repo's `CLAUDE.md`: whenever a PR ships new functionality that the AI assistant or service builder should plausibly know about, the shipping session must either wire it in immediately (if cheap) or log a dated gap entry so the next chatbot-focused session has a queue instead of re-discovering it from scratch. That's why the gaps above are unusually well-itemized — it's a deliberate discipline, not incidental documentation.

---

## 6. Roadmap (priority order, Joe's own words, 2026-07-24)

**Biggest immediate gap: billing isn't fully live yet** (Stripe is built, test-mode only).

**Immediate:**
- Domain changes (email sending domains need fixing — see recent-functionality note below)
- Get billing fully live
- Capture documents from emails and attach to matter/client automatically
- Opposing attorneys/contacts as a first-class concept
- Co-counsel / referral tracking / multi-attorney firms
- Billable time tracking (Clio-style)
- Trust accounting / Plaid integration
- Litigation deadlines & reminders

**Mid-term:**
- Legal research / case-law source integrations
- Owned call rooms & transcripts (currently dependent on Granola)
- Full accounting module
- An "AI workspace"

**End game:**
- Clio migration wizard
- Agents for filing / government interactions
- True self-serve, client-created services
- Owned/specialized inference models
- Referral marketplace with attribution tracking
- AI voice intake/assistants
- Mobile "matter companion" app (litigation-focused)
- Marketing/lead-gen engine
- Blockchain trust accounting

**Recent functionality that specifically needs a testing/polish pass** (separate from the roadmap above — these already exist but aren't done):
- Emails/confirmations — fix sending domains and button/link correctness; every email needs to link into portal sign-in; needs a full walkthrough of every email
- Client portal — needs a full functional walkthrough AND a UI polish pass
- E-sign workflow UI — needs full polish
- Task Queue — needs UI polish for sign-related tasks
- Chatbot — needs to catch up to current platform functionality (see §4c)
- Client/contact record documents+activity+billing tabs — needs UI polish
- Intake — needs UI polish

**Ongoing pillars (no finish line, should just keep getting better):**
- The capabilities library structure (how reusable AI/workflow building blocks are catalogued)
- AI assistant agency, accuracy, and overall capability
- Client portal functionality and UI

---

## 7. How to use this file with Claude web

Paste this whole file into a Claude web conversation when drafting a prompt for Claude Code. It should be enough on its own to explain: what the product is, what already works, what's known-broken, and what's next — without Claude web needing repo access. If a prompt you're drafting depends on something not covered here (exact file paths, precise current behavior), that's a sign the actual Claude Code session should investigate the live code before acting — this file is deliberately a summary, not a substitute for reading the code.
