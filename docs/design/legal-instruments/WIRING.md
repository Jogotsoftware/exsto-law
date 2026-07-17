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

## WP-C · Review queue + reader ★ flagship

- [ ] WIRED: batch select + select-all + batch disposition bar; Begin-review sequential ("n of m", auto-advance)
- [ ] WIRED: column sorts, kind filter, search; Download PDF/Word; Send-via-email; Approve/Reject/Request-revision
- [ ] WIRED: reasoning-trace drawer ("Matter context"); proportional letter page + DRAFT watermark; regenerate modal
      with skills picker
- [ ] BUILD: interactive AI-revision tracked-changes loop — prompt (+ suggestion chips) → inline redline (red
      strikethrough deletions / green underline insertions) → Accept all / Edit revision / Discard; Accept
      materializes as version n+1 (append-only preserved)
- [ ] BUILD: client column + sort in the queue
- [ ] CONFLICT (Joe): batch approve/reject bar (richer than comp's Begin-review-only)

## WP-D · Services + service editor

- [ ] WIRED: settings (EN/ES client copy, route/generation selection, booking fieldset, consultation toggle/length)
- [ ] WIRED: questionnaire (token binding, types, required, add-from-library, save-to-library)
- [ ] WIRED: AI-review tab (auto-review + redline toggles, prompt slot chips, skills chips); workflow tab; billing
      tab; Edit-with-AI rail
- [ ] ADAPT: route/generation dropdowns → comp's segmented pill toggles
- [ ] VERIFY: "New service" button → wires to the build wizard (D8)

## WP-E · Templates gallery + editor

- [ ] WIRED: Tiptap toolbar (font/size/B/I/U/H1-3/align/lists/signature-line/page-break); merge-fields panel
      (7 types, required, click-insert); sample-data preview; letter-page canvas; AI draft modal
- [ ] BUILD: gallery cards with proportional page thumbnails (today: table; drop extra columns per D6)
- [ ] BUILD: side-by-side preview (today: toggle replaces canvas)
- [ ] BUILD: persistent inline AI-edit bar with working shimmer (today: modal + "Drafting…")
- [ ] BUILD: strikethrough toolbar button

## WP-F · Billing — fully WIRED, pure restyle

- [ ] Unbilled groups / per-entry checkboxes / select-all / Generate invoice
- [ ] Reported-payment verify ("Verified — mark paid") / Dismiss, explorer + screenshot links
- [ ] View (PDF) / Mark paid / Send per invoice; firm default + client rates + service fixed fees

## WP-G · Settings → rail-routed sections

- [ ] WIRED: booking rules (days/hours/buffer/notice/lengths/copyable public link); AI usage (cards, daily chart,
      by-model); integrations connect/disconnect + last-checked; invoice config (color/columns/logo/live preview);
      firm view/edit; Stripe connect/refresh/disconnect; Zelle + crypto editor
- [ ] BUILD: split long scroll into rail-routed sections (Integrations / Firm details / Invoice template /
      Email signature / Booking rules / Users & roles / Payments / AI usage)
- [ ] BUILD: integration favicon logos + 4 coming-soon tiles (LexisNexis, Westlaw, PACER, Fastcase — disabled)
- [ ] BUILD: firm logo surfaced in Firm details card
- [ ] BUILD: "Standard client agreement" card (engagement terms: version/updated/signed-by + edit + send-via-eSign)
- [ ] BUILD: .docx invoice-template upload with merge fields
- [ ] BUILD: Stripe manage panel (payout account / schedule / fee / balance / open-dashboard via Stripe API)

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
