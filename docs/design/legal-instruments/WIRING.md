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

## WP-B · Matters list + matter detail — SHIPPED (B1 + B2)

- [x] WIRED: notes (add/list/retire); Actions menu (draft email / schedule / log time / log expense / add fee) —
      restyled to the comp li-mat-* chrome; NotesSection gained an additive `variant="card"` (CRM's plain usage
      unchanged)
- [x] WIRED: portal thread + inline reply; merged timeline; matter calendar embed — "This week" wraps the existing
      WeeklyCalendar unchanged; Portal messages restyled to comp bubbles
- [x] WIRED: generated-doc actions (PDF / Word / email-link / open review); tasks (due, billing, signature stepper)
      — folded into the comp kebab menu; billing/signature chips now actually render (billingMode/hours/feeAmount
      were captured on create but never shown before this WP)
- [x] BUILD: "New task" + "Close matter" in Actions menu — New task opens the new comp TASK MODAL (Tasks tab,
      `?new=1`); Close matter (danger-styled) routes to the workflow's complete_matter stage window, and is
      OMITTED (no dead control) on matters whose workflow has no such stage (e.g. legacy/no-workflow matters)
- [x] BUILD: per-matter Emails card on Activity — `legal.mail.threads` now accepts an optional `matterEntityId`
      (extends the existing tool/handler, no parallel path); row click deep-links into Mail (`?thread=`, new);
      "Draft email" reuses `launchCompose`. Verified live: real Gmail threads, correctly matter-filtered (proven
      via direct MCP call + UI render, 8 rows). Note: Gmail search latency can run ~5–10s on a cold call — real
      external API time, not a bug.
- [x] BUILD: client/attorney actor icons on timeline — the substrate has no client-vs-attorney signal on
      `legal.matter.history` (client portal actors are provisioned as `actor_type='human'`, same as attorney
      actors — see `clientPortalActor.ts`), so a human actor here reads as Attorney (honest for THIS feed); the
      real client/attorney split lives in Portal messages, which already has it (`PortalMessage.author`). System
      and AI/agent actors get their own icons too (agent was text-only before).
- [x] BUILD: in-place Send invoice on matter Billing tab — `legal.invoice.issue` already accepts an optional
      `matterEntityId` (same call the Overview workflow's BillStep makes), so this is a real issue+send in place,
      no dashboard hop. Verified live end-to-end: fee → Send invoice → moved from Accrued to Invoiced, status
      "sent", real invoice number.
- [x] VERIFIED: "New matter" button — a manual create flow already existed (`legal.matter.open` via the existing
      `NewMatterModal`); kept and restyled, no WP-L dependency needed.
- [x] RESOLVED (Joe's founder decisions, both applied): task checkbox = HYBRID — list rows get a real done/undone
      checkbox (disabled for signature tasks, gated by the review flow instead); the task detail page gained the
      4-state status select it was missing (status editing had lived only in the list before this WP). Uploaded-doc
      menu = FULL comp set (Edit/View → View, Download Word, Download PDF, Email) with REAL server-side conversion
      — new `.../documents/[versionId]/extract` (JSON text) and `.../convert-word` (returns the .doc directly)
      routes, reusing the same extractor `legal.document.review.run` already uses and the same markdown→HTML
      drafts use; PDF-native uploads download as-is, everything else round-trips through extraction. AI review
      kept as a 5th item (real, pre-existing capability the comp doesn't show).

Deferred (explicitly out of scope, not forgotten): the comp's service-subline edit pencil is DROPPED — there is no
`matter.update`-type capability to edit a matter's summary/service today (only `legal.matter.set_workflow` /
`set_owner` / `set_company` exist), so it would be a dead control; simpler wins. If that capability ships later,
wire the pencil then.

Found + fixed along the way (not scope creep — both are real capabilities this WP touches directly): a raw
`fetch()` to the matter-documents upload route never forwarded the dev-only `x-actor-id`/`x-tenant-id` shim
(unlike `callAttorneyMcp`), so local `?demo_user=` upload testing always 401'd; same fix applied to the new
extract/convert-word client calls and to View/Download Word (now fetch+Blob downloads instead of plain `<a href>`
navigations, so the dev shim reaches them and the real filename survives). Production is cookie-only and
unaffected either way.

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

## WP-E · Templates gallery + editor — SHIPPED (branch li/wp-e-templates)

- [x] WIRED: Tiptap toolbar (font/size/B/I/U/H1-3/align/lists/signature-line/page-break); merge-fields panel
      (7 types, required, click-insert); sample-data preview; letter-page canvas; AI draft modal
- [x] BUILD: gallery cards with proportional page thumbnails (today: table; drop extra columns per D6)
- [x] BUILD: side-by-side preview (today: toggle replaces canvas)
- [x] BUILD: persistent inline AI-edit bar with working shimmer (today: modal + "Drafting…")
- [x] BUILD: strikethrough toolbar button

### WP-E decisions (binding)

- **AI draft modal retired, not restyled.** The old `legal.template.ai_draft`-backed
  "Draft with AI" modal (list-view entry + in-editor button, with model/skill pickers and a
  reference-file attach) is gone. The persistent inline bar is the ONE AI entry point once a
  draft is open — it drafts (empty body) or revises (non-empty body) via `legal.template.ai_enhance`,
  streamed the same way the per-service editor's "✨ AI" panel already worked
  (`lib/templateAiStream.ts`). It is a strict capability superset of the old draft-only flow (bar
  keeps the reference-document attach via a paperclip icon button; model/skill pickers are dropped —
  comp has no equivalent control, "simpler wins"). The "New template" chooser (scratch / clone /
  from questionnaire) is untouched, per instruction.
- **Merge-fields panel is always-on**, not a togglable "Fields" section — matches the comp's
  permanent right rail. The old body-inline "Insert a field" collapsible palette is replaced by a
  "Standard fields" quick-insert strip in the same rail.
- **App-only meta row** (Type / Document kind) sits below the header — the comp's static demo has
  no control for these, but they're real template metadata (not view-only), so they're kept, not
  dropped. Paper size (Letter/Legal) and Font-size view prefs ARE dropped: they were
  never-persisted localStorage-only preferences with no comp equivalent, superseded by the shared
  fixed-size `DocumentSheet` `editor` page every other WP already uses.
- **Card kebab menu** (small overflow button per card) carries "Edit in window" and "Retire" —
  the comp's card is a single "open the editor" click target with no equivalent, so these two
  pre-existing actions needed a new (small, non-comp) home.

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

## WP-H · Calendar — SHIPPED (branch li/wp-h-calendar)

- [x] WIRED: Day/Week/Month(+List) views; prev/next/today; create/edit modal + matter binding; drag
      create/move/resize; Google events (read-only + assign-to-matter); per-event menu; firm categories —
      restyled to `li-cal-*`; all regression-walked live (views, drag-create, matter/contact/personal
      create, assign-to-matter still present in the agenda)
- [x] BUILD: full-page legend — `li-cal-legend` row above the grid: one dot per live firm category
      (`legal.calendar.categories.get`, data-driven, not hardcoded) + the two fixed entries the comp's
      demo data hardcodes (Google event #9AA4B8, Task due #1F9E8F — new `--li-cal-teal` token, the one
      comp color with no firm-category equivalent)
- [x] BUILD: task-due events in the feed — new query `listDueTasks` (`verticals/legal/src/queries/tasks.ts`,
      reuses the existing `TASK_SELECT` firm-wide instead of per-matter) + new read-only MCP tool
      `legal.task.list_due({fromDate, toDateExclusive})`; rendered teal in the all-day strip / month cells
      / List view (badge row) / day-agenda; click → `/attorney/matters/{id}/tasks/{taskId}`. Verified live:
      created a real task with today's due date, chip rendered + click navigated to the task.
- [x] BUILD: right-click context menu incl. Duplicate — comp-exact 3-item menu (Edit event / Duplicate /
      Delete) via a pencil icon OR right-click on any APP-OWNED grid event (matter consultation or
      contact/personal meeting); Duplicate calls the SAME existing create action
      (`legal.booking.create_for_matter` / `legal.meeting.create`) at the same time — no new capability.
      Verified live: duplicated a personal block, got two overlapping events, deleted both via the menu
      and via the modal's Delete button.
- [x] BUILD: side-by-side lanes for overlapping events (replaces cascading inset) — ported the comp's exact
      `layout()` algorithm (pairwise-overlap group → equal-width columns) into `layoutTimed`. Verified live
      with a duplicated event: both blocks render as two equal-width side-by-side columns.
- [x] BUILD: seed default categories (Consultation / Follow-up / Court / Internal) as firm-category rows —
      `legal.calendar.categories.get` now also returns `configured: boolean` (was the read ever persisted,
      vs. just the in-memory starter defaults); the Calendar page seeds a REAL row via the EXISTING
      `legal.calendar.categories.set` the first time it sees `configured: false`. `DEFAULT_CALENDAR_CATEGORIES`
      recolored to the comp's exact legend hex so the seeded row and the comp match pixel-for-pixel.
      Verified live: fresh tenant load → `configured` flipped `false → true`, row confirmed via direct MCP call.
- [x] CONFLICT (Joe) RESOLVED — **keep, restyled**: List view (`li-cal-list`) and all drag interactions
      (create/move/resize) fully preserved, restyled to the comp's card language.

### Deviations (documented, not unilateral cuts)

- The comp's Event modal shows an editable Title input; no capability exists to rename an existing
  consultation or meeting (no `legal.meeting.update`-title action), so Title is a disabled/read-only field
  when editing (same "don't fake a dead control" call WP-B made for the service-subline pencil). Title stays
  editable at CREATE time for contact/personal events (unchanged existing behavior).
- The comp's modal has no end-time/duration control (its demo assumes a fixed length). Added a compact
  Duration select (common presets + the event's actual value if it's a non-preset drag-created length) —
  required for the create/reschedule actions, which need a real end time.
- A plain click on a contact/personal grid event now opens the edit modal (previously a dead end — no
  matter to deep-link to); matter-consultation clicks still navigate to the matter (WIRED, unchanged) —
  editing those is via the pencil/right-click, matching the comp's own split between click-to-navigate and
  a dedicated edit affordance.
- Found, not fixed (pre-existing, out of WP-H scope): `legal.booking.cancel`/`reschedule` resolve "the"
  Google event for a matter via `matterGoogleEventId` (latest-wins), not a specific booking instance. Since
  a matter consultation is architecturally a singleton per matter, Duplicating one and then cancelling a
  specific copy can leave an earlier duplicate's Google-side event orphaned (the substrate side always
  reflects the latest booking correctly; only the external Google artifact can go stale). Contact/personal
  meetings have no such issue (each is its own `calendar_event` id, cancelled precisely). Not fixed here —
  it's a characteristic of the existing singleton booking model, not a WP-H regression, and WIRING directed
  Duplicate to use the existing create action as-is.

## WP-I · Mail — SHIPPED (branch li/wp-i-mail)

- [x] WIRED: Gmail thread list, search, open-ingests, reply/compose that send, matter attachments, signature,
      matter tags — restyled to the comp's two-pane inbox (`li-mail-*`); regression-verified live: real Gmail
      threads open with formatted HTML bodies, `?thread=` deep link from the matter Emails card still works,
      compose/reply/attachments/signature unchanged underneath
- [x] BUILD: Portal chat as second tab — aggregates every matter's existing portal thread into one cross-tenant
      list. No parallel messaging path was forked: the detail pane and inline reply reuse the SAME
      `legal.matter.thread_get` / `legal.matter.message_post` the matter Activity tab's Messages card already
      calls; the only new surface is the list itself, a new read `legal.matter.portal_threads`
      (`listPortalThreads` in `clientMessaging.ts`) that projects the same `communication_thread`/`_message`
      rows `getMatterThread` does, aggregated across matters instead of scoped to one. Verified live: a reply
      typed in the Mail tab posted, appeared instantly in the Mail bubble thread, AND appeared in that same
      matter's own Activity → Portal messages card (same thread, proven via direct read-back) — the CONFLICT
      below is resolved BY this: auto-association (every portal thread is already matter-scoped by construction)
      makes a manual "file to matter" control meaningless, so none was built.
- [x] BUILD: unread counts on both tabs. Email = Gmail's own `UNREAD` label (`gmail.ts` now returns
      `unread: boolean` per thread from `labelIds`, already fetched in `format:'metadata'`); opening a thread
      calls a new best-effort `markThreadRead` (`threads.modify` removing `UNREAD`, gated on the `gmail.modify`
      scope every "Connect Google" already grants) — verified live end-to-end: badge went 2→1 on open, and
      **survived a full page reload**, proving the label was actually cleared server-side, not just an
      optimistic UI flag. Portal = **honest heuristic, recorded here per the brief**: there is no attorney-side
      portal read-marker in the substrate today, so unread = count of client messages sent after the attorney's
      own last reply on that matter's thread. Replying clears it (proven live: badge 1→0 after the reply
      round-trip above); merely opening the thread does not, since the heuristic has no read-state to flip. If a
      real read-marker is added later, swap `listPortalThreads`'s `unread_counts` CTE — the tool/UI contract
      (`unreadCount: number` per thread) doesn't need to change.
- [x] CONFLICT (Joe) RESOLVED — no manual "file email to matter" control: auto-association (Gmail: known
      client-contact address match; Portal: threads are matter-scoped by construction) already covers it; a
      manual override would be a control with no gap to fill.

## WP-J · CRM — SHIPPED (branch li/wp-j-crm)

- [x] WIRED: clients/contacts lists + detail pages + portal invite — restyled to the comp's underline tabs,
      header (title + count + primary New button), search + "N shown", grid table (avatar-initials + name,
      status chip with dot, sortable-header carets), client detail (avatar tile + h1 + status chip, Email/
      Schedule/Edit actions, 4 stat cards, Contacts card with Main badge, Matters card with status-dot rows),
      contact detail (kv info card, Portal access card, Matters list). New family `li-crm-*` appended at the end
      of globals.css.
- [x] ADAPT: status filter-in-header-column pattern — the STATUS column header is now the comp's uppercase
      `<select>` (`li-crm-statusfilter`), shared by both tabs via the new `CrmListTable` component
      (`components/CrmListTable.tsx`). Clients previously had no status concept at all (only contacts did, via
      `crmBucket`); Contacts previously had a separate four-way tab strip (All/Active/Prospective/Prior) above
      the table instead of a header filter — both are now the one comp pattern. Column sorting (click header,
      caret flips/dims) is real client-side sort, not decorative — neither list had sort before this WP.
- [x] VERIFY resolved, split by tab: "New client" — a real manual create flow already existed
      (`legal.client.create`, ClientsPage's inline form); kept, restyled into a Modal (matching the WP-B
      NewMatterModal pattern — the shared Modal primitive itself isn't comp-restyled until WP-M), same round
      trip (create → route to the new client's detail page). "New contact" — VERIFIED ABSENT: there is no
      `legal.contact.create` tool anywhere in the MCP surface; contacts only ever arrive via intake (booking,
      questionnaire, matter open), never a manual attorney-authored record. Per "no dead controls," the
      Contacts tab does NOT get a New button — this is a real reclassification of the WIRING item (VERIFY →
      confirmed not present), not an oversight.

### Data + deviations found while restyling (not scope creep — all real, all in the CRM read path this WP touches)

- The comp's Clients table shows a WEBSITE column and a STATUS chip that don't correspond to anything in the
  client data model (no website attribute exists anywhere in the substrate for clients; clients had no status
  concept at all before this WP). Per "simpler wins" / no-fabrication: WEBSITE is dropped, and STATUS is now a
  real derived field — `verticals/legal/src/queries/client.ts` extends `listClients`/`getClient` to compute
  `crmBucket` via the exact same `deriveCrmBucket(matterStatuses)` contacts already use (three-way Active/
  Prospective/Prior split off the client's matters), so "status" reads identically everywhere in the CRM rather
  than inventing a second vocabulary. `lastActivityAt` mirrors contacts.ts too (latest matter creation, else the
  client's own createdAt). In the dropped WEBSITE column's place, the Clients table gets a real substitute
  column: the main contact's name (`mainContactName`, one additional correlated subquery) — kept because the
  comp visibly uses that slot to show "who to talk to," and it's genuinely free data (already resolvable via the
  existing `client_main_contact` attribute), not fabricated.
- Contact detail gained a header "Email" button (comp shows one; the app didn't). Wired to the same `launchCompose`
  (Contract D) the Client detail page already used identically — a real, proven, working flow, not a new one.
- Client detail's action row (Email/Schedule/Edit) and Contact detail's Portal-access invite were all VERIFIED
  already real and working (`launchCompose`, `launchScheduler`, `legal.client.update` via the existing inline
  edit form, `legal.contact.invite_to_portal`) — none omitted, all kept and restyled only.
- NotesSection on Client detail is not in the comp's CRM screens at all, but it's real, substrate-backed
  capability (not a stub) — kept per the WP-C precedent ("AI review kept... real, pre-existing capability the
  comp doesn't show"), housed in its own `li-crm-panel` rather than dropped or left unstyled.
- Found, not fixed (pre-existing, predates this WP, out of a restyle WP's scope): `listClients`'s `matter_count`
  subquery counts all `matter_of` relationships regardless of the matter entity's own `status`, while
  `getClient`'s matters query filters `AND e.status = 'active'` — so a client whose matters include an archived/
  non-active entity shows a higher count in the list than the number of rows in its own detail panel (verified
  live: one seed client showed "5 matters" in the list, 2 in its own detail + stat card). Both queries were
  already like this before WP-J; this WP only added new columns alongside the existing count logic, it didn't
  touch it. Flagging for a future data-consistency pass, not fixing here.

### Verification (2026-07-17, live app, `?demo_user=juan-carlost`, Playwright)

Both tabs, search ("a" narrowed 24→20 contacts), status header-filter (Active → 21/24 shown, header reads
"ACTIVE"), column sort (asc/desc flips the leading row), row → client/contact detail, client detail actions
(Email/Schedule/Edit all present and correctly disabled without a main-contact email), 4 stat cards, Contacts
panel with Main badge, Matters panel → real click-through to `/attorney/matters/{id}` (verified with href
inspection + network trace, not just a screenshot), contact detail kv card + Portal access card, portal invite
button fired for real (`legal.contact.invite_to_portal`, success alert rendered), New client round trip (modal →
create → routed to the new client's own detail page, name confirmed on page), "New contact" absent (0 matches
for the button) on the Contacts tab as expected. Dev-environment Supabase pooler 500s (EMAXCONNSESSION) were hit
several times during the walk — pre-existing, unrelated to this WP's queries (traced to `withSuperuser`/
`actorIsActive` session verification, not `legal.client.*`/`legal.contact.*`); retried and passed on the retry
each time, consistent with prior WPs' notes on this environment.

## WP-K · Intake Forms + Questions — SHIPPED (branch li/wp-k-intake)

- [x] BUILD: visual card galleries with proportional form thumbnails + status badges (today: table / list cards)
- [x] Per D6: NO usage counts; drop today's Feeds column

Intake Forms (`app/attorney/questionnaires/page.tsx`): the table became a
`li-int-grid` of cards (`repeat(auto-fill, minmax(240px,1fr))`), each a
`DocumentSheet variant="thumb-form"` mini rendering of the REAL form — icon +
decorative title bar, then each real field (first four) as a proportional
label bar (width from the real label's length) + input box — plus name,
status badge, and a `meta` line of `N questions` only (no usage counts, no
Feeds column; both are still real data, still editable inside the
questionnaire, just not shown as gallery chrome). Card click keeps today's
"Edit" behavior (opens the existing inline draft editor — the gallery hides
while a draft is open, mirroring WP-E); a per-card kebab menu carries "Edit
in window" (the modal) and "Archive", the WP-E precedent for pre-existing
actions with no comp equivalent. "New intake form" keeps the existing create
flow. Service-bound intake forms (read-only here, edited in the service
builder) are now cards too, whole-card `Link`s to the service questionnaire.

Questions (`app/attorney/questions/page.tsx`): the list became the comp's
card-list row pattern (`li-int-row`) — icon tile, question label, type +
`{{token}}` `TokenChip`, edit/archive icon actions — reusing the SAME
`li-int-*` family (one CSS family for the WP, per instruction). The inline
edit form (`QuestionRow`) is untouched, still swaps in place per row exactly
as before. Service-embedded questions (read-only, "Edit in service") are a
second `li-int-list` block with a link-button per row. "New question" kept.

### WP-K decisions (binding)

- **Status badge source.** The comp's Active/green-dot vs Draft/gray badge
  needed a REAL signal, not a fabricated one. Library questionnaires are
  always "Active": the list query already filters `entity.status = 'active'`
  (archived ones never reach this page), so every card in the library group
  is a live, usable form — there is no other draft/active flag on
  `questionnaire_template`. Service-bound forms follow the service's own
  `isActive` — the one real live/disabled signal this app has for an intake
  form. This is a from-scratch mapping (comp's own datum was a demo
  placeholder), documented here per README rule 4.
- **Screenshot vs interactive comp — found, not followed.** The reference
  screenshot `screenshots/intake.png` shows a plain row-list (icon, name,
  green/gray status dot, "N questions · used by N services" text, one pencil
  icon) — NOT a card gallery. The interactive `legal-instruments.dc.html`
  disagrees with its own screenshot: it has a dedicated
  `<!-- ===== INTAKE FORMS (GALLERY) ===== -->` section with full
  `DocumentSheet`-style thumbnail card markup, and its state wiring
  (`showIntakeForms: active === 'questionnaires'`) is what actually renders
  when a user navigates there — the row-list markup nearby
  (`simpleData('questionnaires')`) is dead code for that route, only reached
  via `showSimple` for `requests`/`questions`. Per README rule 1 ("the comp
  is the [dc.html] spec, not inspiration") and the explicit WP brief
  ("visual card galleries with proportional form thumbnails"), this WP built
  the gallery in the dc.html and treated `intake.png` as a stale capture
  predating that revision. Flagging for the record; not a unilateral
  reinterpretation since the brief was independently explicit about the
  gallery.
- **Gallery hides while the inline draft editor is open.** Previously both
  the table and an open draft-edit form rendered simultaneously (a
  pre-existing quirk — no `!draft` gate). Gated the gallery/header behind
  `!draft`, matching the WP-E templates precedent (gallery swaps for the
  editor). Same state, same functions, just not double-rendered; the error
  banner was hoisted above both branches so it still shows while editing.
  This is the only behavior change beyond the visual restyle.
- **No `questions.png` screenshot exists** in the comp assets; the Questions
  card-list pattern was built directly from the `.dc.html`'s `showSimple` /
  `simpleRows` markup (the same markup the intake.png-style row previously
  used), per the WP brief's explicit pointer to that pattern.

### Verification (2026-07-17, live app, `?demo_user=juan-carlos`, Playwright)

Gate order: `pnpm format && pnpm lint && pnpm typecheck && pnpm build &&
pnpm test:unit` all green (206/206 unit tests), then `apps/legal-demo`'s own
`npx next build` green (all 76 routes, including both restyled pages,
compiled/prerendered with no errors). Dev walk (`next dev -p 3111`, no
pooler 500s hit this run — retry wrapper was in place, unused):

- Intake Forms: 13 cards rendered from real data, each with a real
  `DocumentSheet` thumb-form thumbnail (47 field-boxes total across 13
  cards, capped at 4/card); status badges a real mix of Active/Draft; meta
  lines confirmed `"N questions"` only (no `"used by"`/`"used in"` text
  anywhere, no `<table>`, no "Feeds" text on the page). Card click → real
  "Edit questionnaire" editor opened with the card's actual data (verified
  "Lease Review Intake" card's 2 field bars matched its real fields, Landlord
  name / Monthly rent, in the opened editor). "New intake form" → real "New
  questionnaire" flow. Kebab menu → "Edit in window" + "Archive" both
  present and clickable.
- Questions: 142 rows across the bank + service-derived section (24 bank +
  118 service-embedded), every row showing a type + a real gold
  `{{token}}` chip (142/142). Edit icon → inline `QuestionRow` form opens
  in place (existing behavior, unchanged). "New question" → same inline
  create form. Service-derived section present with working "Edit in
  service" link-buttons (118, all pointing at their real service).
- No console or page errors during the walk. Screenshots saved to
  `scratchpad/wp-k/` (01 gallery, 02 card→editor, 03 new-intake-form, 04
  kebab menu, 05 questions list, 06 edit action, 07 new-question, 08
  service-questions section).

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

## WP-N · eSign (feature build) — SHIPPED

- [x] BUILD: envelopes list at `app/attorney/esign/page.tsx` — stat cards (Action needed / Out for signature /
      Completed), filter pills with counts (All / Action needed / Out for signature / Completed / Declined),
      table (DOCUMENT w/ icon + `matter · doc` subline / SIGNERS names + `n of m signed` / STATUS chip / SENT /
      UPDATED). Backed by the real read `legal.esign.envelopes_list`.
- [x] BUILD: envelope detail at `app/attorney/esign/[envelopeId]/page.tsx` — signers & sequential-routing card
      (order badge, avatar, name/title/email, per-signer status chip + channel + signed-at, routing footer),
      DocumentSheet preview with a SIGN-HERE block per signer, and the real actions Resend / Void /
      Download-executed. Reuses the `legal.esign.status` data path (getEnvelopeStatus, extended with matter /
      documentKind / sentAt / bucket / signer key).
- [x] BUILD: restyled four-step prepare wizard (Document → Signers → Fields → Review, step dots, "Envelope sent"
      confirmation) — comp chrome over the EXISTING `PrepareSignature` logic (anchor/field/send mechanics
      unchanged). Used by both `/attorney/sign/prepare/[versionId]` and the signature-task window.
- [x] BUILD: eSign rail item after Review (module-gated key `e-sign`; `MODULE_AREAS['e-sign'] =
      ['/attorney/esign']`). All new reads/writes go through the operation core (MCP tools over `submitAction` /
      query helpers — no direct DB from app code).

### New operation-core surface (the exact tools/actions added)

- **`legal.esign.envelopes_list`** (read, `esignAttorneyTools.ts` → `listEnvelopes(ctx)` in `api/esign.ts`): every
  envelope in the tenant, newest first, with signers, document, matter, signed progress, and a derived `bucket`.
  One tenant-scoped query over `signature_envelope` entities joining `envelope_of → document → draft_of → matter`
  and a `jsonb_agg` of the `request_of` signer children. No new substrate kinds (read only).
- **`legal.esign.resend`** (write → `resendEnvelope(ctx, envelopeId)`): re-notifies the signer(s) whose turn is
  currently active (delivered | opened) on a `sent` envelope by re-running the existing `notifyDelivered` path
  (re-queues the same secure link / portal nudge through `queueNotification` → `submitAction`). Refused on
  completed / declined / voided / pending_dispatch. **No new action kind** — it reuses the notification-queue write.
- **`legal.esign.void`** (write → `voidEnvelope(ctx, envelopeId)` → action `esign.void`): NEW real capability
  (migration `0167_esign_void.sql` adds action `esign.void` id `…1013-…e6` + event `esign.voided` id `…1014-…e7`;
  handler in `handlers/esign.ts`). Sets `envelope_status = 'voided'` and closes every open signer request
  (`signer_status = 'voided'`); `assertSignerTurn` + `buildSignable` now treat `voided` as terminal so a stale
  link can no longer sign. Send-authz-gated (`assertCanSendOnMatter`). Refused once completed / declined / voided.
- **Download executed copy**: the existing executed-artifact path — `getEnvelopeStatus` surfaces
  `executedDocumentVersionId` (a `document_version` with `metadata.executed`); the detail fetches its body via
  `legal.draft.get` and renders the PDF client-side through `downloadAsPdf(..., { status: 'executed' })`. No new
  backend.

### "Action needed" classification rule (mirrors the comp's firm-blocked semantics)

Each envelope is classified into one bucket (`classifyEnvelope` in `api/esign.ts`):

- `completed` = `envelope_status` completed · `declined` = declined · `voided` = voided.
- Active (`sent` | `pending_dispatch`): **`action_needed`** iff it has a currently-active signer (status
  `delivered` or `opened`) whose `signer_key` is `attorney` or `firm` — i.e. the envelope is blocked waiting on
  the FIRM's own signature slot (the key the prepare flow / templates assign to the firm). Otherwise **`out`**
  (waiting on a client / external signer). This mirrors the comp's "Action needed" = blocked on the FIRM as
  closely as the data allows; if no envelope uses a firm key, Action needed is naturally 0.

Stat cards + filter pills use exactly the comp's five surfaces (All / Action needed / Out for signature /
Completed / Declined). **`voided`** is a real terminal state added by the Void control that the comp doesn't
model: a voided envelope shows a grey "Voided" chip and is reachable via **All** (excluded from the four named
buckets/cards — it is not a client-signature outcome). Nothing is hidden or relabeled.

### Deviations / notes

- The comp's list "New envelope" opens a document-picker modal; our prepare flow is entered per approved document
  (`versionId`), so "New envelope" routes to **Review** (the real document-selection surface where "Send for
  signature" launches the wizard) rather than duplicating a cross-matter picker. The wizard's step-1 "Document" is
  the confirm of the already-chosen document.
- No stubs / no dead controls: Resend, Void, and Download-executed are all real operation-core paths (Void is a
  newly-built real action, not a stub). Verified live (juan-carlos, port 3113): rail item present; list shows 10
  real envelopes with correct stats (0 / 5 / 5) and filters; completed detail Download → `legal.draft.get` 200;
  Resend on a NEW test envelope → 200 + re-notify; Void on that same NEW test envelope → 200, envelope + signer
  both `voided`, `esign.voided` event recorded. No real pending envelope was voided.

## WP-M / WP-O / WP-P

- [ ] M: modal & primitive sweep (task/event/upload/editor modals, chips, tables) to comp language
- [ ] O: not-in-comp surfaces styled by analogy — requests, import, task detail, RunnerReview, WorkflowEditor, auth
- [ ] P: admin console (operator-only, last)
