# WIRING.md — Legal Instruments redesign: control-by-control matrix

Audited against `origin/main` @ c26b3ae (2026-07-16, three code audits). This is the **closed scope list** and the
**acceptance checklist** for every work package. Full plan: `~/.claude/plans/i-just-dropped-a-lexical-koala.md`.

## Conventions

- **WIRED** — exists today; restyle only. The WP must prove it still works after restyle (regression gate).
- **BUILD** — comp shows it, app lacks it (or comp hardcodes it as a demo); build it for real, same style.
- **ADAPT** — exists with a different presentation; reshape to the comp's pattern.
- **VERIFY** — believed to exist; confirm during the WP and reclassify if not.
- **CONFLICT** — app is *richer* than the comp; Joe decides keep-vs-cut **before** the WP starts. No unilateral cuts.
- New discoveries get added HERE first (triaged BUILD/CONFLICT), never improvised mid-PR.
- Check items off (`[x]`) only after the WP's wiring walk passes on the running app.

## Shell (PR 2)

- [ ] WIRED: top-bar search (matters/clients/contacts) in expanding comp style
- [ ] WIRED: notifications popover, unread badge, auto-mark-seen
- [ ] BUILD: real notification feed — draft-ready / booking / invoice-paid / signature-complete events (today: only
      resolved-feedback items) + "Mark all read" button
- [ ] BUILD: documents included in search scope
- [ ] Rail: hover-expand (0.3s cubic-bezier), pin persisted (localStorage), gold active bar, Libraries + Settings
      subgroups, user block, "Legal Instruments" wordmark + BETA shimmer badge
- [ ] `MODULE_AREAS` gating preserved; every nav destination reachable; relabels Dashboard→Home,
      Questionnaires→Intake Forms

## WP-A · Home dashboard

- [ ] WIRED: embedded week calendar (live Google+app feed), Recently booked, share-booking-link button
- [ ] BUILD: matters TABLE with date-sort toggle + status filter dropdown (today: status tabs)

## WP-B · Matters list + matter detail

- [ ] WIRED: notes (add/list/retire); Actions menu (draft email / schedule / log time / log expense / add fee)
- [ ] WIRED: portal thread + inline reply; merged timeline; matter calendar embed
- [ ] WIRED: generated-doc actions (PDF / Word / email-link / open review); tasks (due, billing, signature stepper)
- [ ] BUILD: "New task" + "Close matter" in Actions menu (close routes to complete-matter workflow step)
- [ ] BUILD: per-matter Emails card on Activity (Gmail threads already auto-associate — filter by matter)
- [ ] BUILD: client/attorney actor icons on timeline (today only AI/system badged)
- [ ] BUILD: in-place Send invoice on matter Billing tab (today links out)
- [ ] VERIFY: "New matter" button — manual create flow; if absent, wire to assistant create-matter (WP-L)
- [ ] CONFLICT (Joe): task checkbox (comp) vs 4-state status select (app)
- [ ] CONFLICT (Joe): uploaded-doc menu — download+AI-review today vs comp's full Edit/Word/PDF/Email

## WP-C · Review queue + reader ★ flagship — SHIPPED (branch li/wp-c-review)

- [x] WIRED: select + select-all; Begin-review sequential ("n of m", auto-advance, prev/next). Batch disposition
      bar CUT (see CONFLICT below).
- [x] WIRED: column sorts (matter/client/kind/generated), kind filter, search; Download PDF/Word; Send-via-email;
      Approve/Reject.
- [x] WIRED→ADAPTED: reasoning trace is now the inline **Matter context** panel (comp), not a drawer; proportional
      letter page on the shared `DocumentSheet` (variant `full`) inside `DocumentCanvas` + gold DRAFT watermark for
      unapproved versions. Standalone "Regenerate draft…" + skills picker are subsumed by the AI-revision flagship
      for documents (kept only for email drafts, which retain their async `legal.email.draft` regenerate).
- [x] BUILD: interactive AI-revision tracked-changes loop — "Revise with AI" modal (prompt + 4 suggestion chips that
      run immediately) → GemShimmer "Drafting…" → inline word-level redline (red strikethrough deletions / green
      underline insertions) → Accept all / Edit / Discard. Real sync AI via new `legal.draft.revise`. See mapping.
- [x] BUILD: client column + sort in the queue (new `clientName` on `legal.draft.list_pending`).
- [x] CONFLICT (Joe, 2026-07-17, binding) RESOLVED — **cut to comp**: the queue's batch approve/request-revision/
      reject bar is removed. Selection feeds ONLY "Begin review →" (comp-exact band: "N selected · Clear · Begin
      review →"). Mirrored in the reader: the disposition set is Reject / AI revision / Approve (comp's three
      buttons); the app's richer Request-revision + standalone Regenerate + Compare-versions + Open-client-view are
      subsumed/cut per the comp+task toolbar spec. request_revision stays available via MCP for other surfaces.

### Append-only mapping (the flagship — as implemented, preview-then-persist)

- **Generate revision** → `legal.draft.revise` (new sync MCP tool): reads version n's markdown, asks Claude (via the
  existing `callClaudeDrafter` adapter) to redraft the WHOLE document under the instruction, records an append-only
  `reasoning_trace` (exsto-ai-operation, honest confidence < 1.0), and returns `{ revisedMarkdown, reasoningTraceId }`.
  It does **NOT** create a version — the revision is a proposal (comp: "Nothing is sent to the client — you review the
  redlines and accept or reject").
- **Redline view** → client computes a word-level diff of n vs the proposal (`lib/wordDiff.buildRedline`, extends the
  line-LCS to run-level; markdown normalized to readable prose for display only) and renders del/ins runs.
- **Accept all** → persists the proposal as version **n+1** via the EXISTING append-only `legal.draft.edit`
  (`document.edit`), note `AI revision: <prompt>`; reader navigates to n+1. Queue history shows both (append-only).
- **Discard changes** → drops the in-memory proposal; version n is untouched and NO throwaway version is written
  (cleaner than voiding a persisted n+1, and exactly the comp's model). The generation trace remains as an honest
  record that the AI reasoned.
- **Edit** → gold-bordered textarea prefilled with the revised markdown; **Accept edits** persists the edited text as
  version n+1 (or n+2 if a prior Accept already landed) via the same `legal.draft.edit`.
- Rationale for preview-then-persist over persist-on-generate: only accepted revisions become substrate versions
  (clean history, no reject-dance, queue never doubles during review), and every persist is the existing append-only
  edit path — faithful to the comp, which persists nothing until Accept.

## WP-D · Services + service editor — SHIPPED (branch li/wp-d-services)

- [x] WIRED: settings (EN/ES client copy, route/generation selection, booking fieldset, consultation toggle/length) —
      EN/ES now switched by a comp-style pill toggle (both languages still save together)
- [x] WIRED: questionnaire (token binding, types, required, add-from-library, save-to-library) — all existing logic
      preserved (drag reorder, allow_unknown/ask_attorney, members_repeater, per-question save-to-library, start/save
      library) inside the comp's row layout
- [x] WIRED: AI-review tab (auto-review + redline toggles, prompt slot chips, skills chips); workflow tab; billing
      tab; Edit-with-AI rail — the rail is a new chrome-level banner (layout.tsx) reusing the existing
      `exsto:assistant:prime` mechanism (same one the Workflow tab's "Build with AI" already used); billing's legacy
      "Edit in window" (BillingConfigModal, JSON-editor duplicate of the inline form, not in the comp) was cut —
      superseded by the new rail
- [x] ADAPT: route/generation dropdowns → comp's segmented pill toggles — done in the shared
      `ServiceSettingsFields` (so the wizard's `ServiceEditorModal` picks it up too)
- [x] VERIFY resolved: "New service" button — a real manual create flow already exists
      (`/attorney/services/new`, handled by the `[serviceKey]` layout's `isNew` branch); kept wired to it
      (restyled only). The build wizard is D8-gated (`LEGAL_BUILD_WIZARD` off) — not a real alternative today; no
      WP-L follow-up needed since the button isn't dead.
- Templates tab: cards are collapsed by default (comp) with a mini `DocumentSheet` thumbnail (`TokenChip`-rendered
  merge tokens from the live body) + field-count chip; "Open editor" expands the SAME existing rich-text editor
  in place (no separate template-editor route exists yet — that's WP-E's scope).
- Workflow tab: `WorkflowBuilder`'s `StepCard` restyled to the comp's numbered-tile + role-chip
  (client blue / attorney gold / system green) + Blocking badge + monospace trigger + doc chip; the deep
  edit-in-place `StepEditor` (opened via "Edit") keeps its existing form, unrestyled (not in the comp).
- CSS bug found + fixed while restyling: the base `button { padding: .55rem 1rem }` rule out-sizes a 28px
  fixed-width icon button and flex-shrinks its SVG child to 0 width (invisible icons) unless the icon-button class
  resets `padding: 0`; a bare `button.danger { background }` rule also outranks a single-class `.danger` modifier's
  background — both now fixed (`li-svc-iconbtn`, `li-svc-row-gear`), and every new hover rule on a real `<button>`
  carries `:not(:disabled)` so it wins over the global `button:hover:not(:disabled)`.

## WP-E · Templates gallery + editor

- [ ] WIRED: Tiptap toolbar (font/size/B/I/U/H1-3/align/lists/signature-line/page-break); merge-fields panel
      (7 types, required, click-insert); sample-data preview; letter-page canvas; AI draft modal
- [ ] BUILD: gallery cards with proportional page thumbnails (today: table; drop extra columns per D6)
- [ ] BUILD: side-by-side preview (today: toggle replaces canvas)
- [ ] BUILD: persistent inline AI-edit bar with working shimmer (today: modal + "Drafting…")
- [ ] BUILD: strikethrough toolbar button

## WP-F · Billing — fully WIRED, pure restyle

- [x] Unbilled groups / per-entry checkboxes / select-all / Generate invoice
- [x] Reported-payment verify ("Verified — mark paid") / Dismiss, explorer + screenshot links
- [x] View (PDF) / Mark paid / Send per invoice; firm default + client rates + service fixed fees

## WP-G · Settings → rail-routed sections

Founder decision (2026-07-17): "every settings tab still shares the same settings page instead of each having
its own page" — the eight settings sections are now REAL routed sub-pages
(`app/attorney/settings/<integrations|firm|invoice-template|signature|booking|users|payments|ai-usage>/page.tsx`),
not a single long scroll with anchors. `/attorney/settings` redirects to `/attorney/settings/integrations`. The
rail's Settings sub-items link directly to these routes (no more `?section=` query anchors); sub-active is a
pathname-prefix match.

- [x] WIRED: booking rules (days/hours/buffer/notice/lengths/copyable public link); AI usage (cards, daily chart,
      by-model); integrations connect/disconnect + last-checked; invoice config (color/columns/logo/live preview);
      firm view/edit; Stripe connect/refresh/disconnect; Zelle + crypto editor
- [x] BUILD: split long scroll into rail-routed sections (Integrations / Firm details / Invoice template /
      Email signature / Booking rules / Users & roles / Payments / AI usage)
- [x] BUILD: integration favicon logos + 4 coming-soon tiles (LexisNexis, Westlaw, PACER, Fastcase — disabled)
- [x] BUILD: firm logo surfaced in Firm details card (read from the invoice template config, the one place it's
      uploaded; "Replace logo" links to Settings → Invoice template rather than duplicating the uploader)

### G2 (deferred follow-up) — not built in WP-G

- [ ] "Standard client agreement" card (engagement terms: version/updated/signed-by + edit + send-via-eSign)
- [ ] .docx invoice-template upload with merge fields
- [ ] Stripe manage panel (payout account / schedule / fee / balance / open-dashboard via Stripe API)

## WP-H · Calendar

- [ ] WIRED: Day/Week/Month(+List) views; prev/next/today; create/edit modal + matter binding; drag
      create/move/resize; Google events (read-only + assign-to-matter); per-event menu; firm categories
- [ ] BUILD: full-page legend
- [ ] BUILD: task-due events in the feed
- [ ] BUILD: right-click context menu incl. Duplicate
- [ ] BUILD: side-by-side lanes for overlapping events (today: cascading inset)
- [ ] BUILD: seed default categories (Consultation / Follow-up / Court / Internal) as firm-category rows
      (config-as-data, no hardcoded kinds)
- [ ] CONFLICT (Joe): List view + drag interactions (richer than comp — presumably keep)

## WP-I · Mail

- [ ] WIRED: Gmail thread list, search, open-ingests, reply/compose that send, matter attachments, signature,
      matter tags
- [ ] BUILD: Portal chat as second tab (aggregate per-matter portal threads) + unread counts on both tabs
- [ ] CONFLICT (Joe): manual "file email to matter" control (auto-association already exists)

## WP-J · CRM

- [ ] WIRED: clients/contacts lists + detail pages + portal invite — restyle to comp tables/stat cards
- [ ] ADAPT: status filter-in-header-column pattern
- [ ] VERIFY: "New client" / "New contact" create flows exist and open comp-styled forms

## WP-K · Intake Forms + Questions

- [ ] BUILD: visual card galleries with proportional form thumbnails + status badges (today: table / list cards)
- [ ] Per D6: NO usage counts; drop today's Feeds column

## WP-L · Assistant + service builder ★ flagship

Superset rule — ALL current capability survives:
- [ ] history (builds/saved/matter threads), new chat, skills menu, attach (upload / matter doc), model select,
      question batches + Back, proposal cards opening REAL editors, prompt caching + retry, Thinking disclosure,
      `scopeForPath()` grounding + `exsto:assistant:prime`, markdown, feedback mode, persisted resize
BUILD (comp's hardcoded demos become real):
- [ ] empty-state starter cards: Draft a document (real, matter-grounded) / Summarize this matter / Create a new
      matter (guided chips → real matter via action layer) / Create a new service (→ real wizard)
- [ ] "Insert a template" attach option
- [ ] build-mode progress strip ("step n of 6", gradient segments, exit) mapped to REAL wizard phases
- [ ] proposal previews (facts / sections / proportional doc / workflow steps) rendered from real wizard payloads
- [ ] Publish = real enable step; post-publish View service / Share link (copies real `/book/{slug}` + "copied"
      confirmation) / Email link (mailto with real URL)
- [ ] comp FAB icon + gemstar/shimmer treatment; model picker as comp pill+menu listing only connected providers
- [ ] D8: `LEGAL_BUILD_WIZARD` ON in prod
- [ ] GATE: full conversation → published, bookable service, certified on the new UI before merge

## WP-N · eSign (feature build)

- [ ] BUILD: envelopes list — stat cards (Action needed / Out for signature / Completed), filter pills, table
      (document / signers / status / sent / updated)
- [ ] BUILD: envelope detail — sequential routing view, doc preview with SIGN-HERE blocks, Resend / Void /
      Download-executed
- [ ] BUILD: restyled 4-step prepare wizard (Document → Signers → Fields → Review) over existing `sign/prepare`
- [ ] BUILD: eSign rail item (module-gated); all new reads through the operation core

## WP-M / WP-O / WP-P

- [ ] M: modal & primitive sweep (task/event/upload/editor modals, chips, tables) to comp language
- [ ] O: not-in-comp surfaces styled by analogy — requests, import, task detail, RunnerReview, WorkflowEditor, auth
- [ ] P: admin console (operator-only, last)
