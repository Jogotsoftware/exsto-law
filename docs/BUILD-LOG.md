# exsto-law — Hardening v3 BUILD-LOG (Manager)

Authoritative record of what is **actually live** in `jfcarzprfpoztxuqykoe` vs merely merged.
Manager owns this file. Workers do not edit it.

_Last updated: 2026-06-18 · main `2a56f77`_

## Ground truth (verified against live prod this session)

| Check | Result |
|---|---|
| Vertical ledger max | **0044** ✅ (next free `0045`, leases below start here) |
| Security advisors | **0 lints** ✅ |
| `intent_kind` coverage | 100% (0 null) ✅ |
| Dormant kinds (WIRE targets) | `mail.send`=0, `mail.ingest`=0, `esign.send`=0, `esign.sign`=0, `invoice.issue`=0, `invoice.send`=0, `draft.generate`=0 fires ⟶ **these are the round's job** |
| Real fires | `intake.submit`=2, `booking.create`=2, `draft.merge`=1, `draft.approve`=1, `legal.meeting.assign`=1 |

### ⚠️ Corrections to the master doc (workers must note)
1. **Granola is now CONNECTED** (Joe completed OAuth) — doc says "still API-key & disconnected." S1: the API-key path is already replaced; the remaining work is the **duplicate-row cleanup** (a stale `granola/disconnected` AND `google/disconnected` row both exist alongside the connected ones).
2. **Connections live:** `anthropic/connected`, `google/connected (+1 stale disconnected dup)`, `granola/connected (+1 stale disconnected dup)`, `perplexity/disconnected`. Two dup rows for S1 to clean, not one.
3. **Entity count = 9** (doc says ~5). +3 are a Manager verification booking ("Deploy Verify (delete me)" matter/contact/questionnaire) — kept as the **S5 baseline receipt** (a clean booking chain, no FK error). The rest is seed.

## Already-shipped overlaps (workers MUST NOT re-do / will collide)

The prior round's tail merged just before v3. Three catalog items are **already done on `main`** — reconcile, don't duplicate:

| Catalog item | Worker | Status | PR |
|---|---|---|---|
| **#7 Public Intake actor** (booking FK fix) | S5 | ✅ **DONE** — `/api/client/mcp` was defaulting to a non-existent actor `…0000-0004`; fixed to the seeded Public Intake `…0001-0005`. Booking chain now fires clean (live receipt: matter `M-MQJTMFMT`). **S5 inherits a working actor path — focus on availability engine + firm rules + confirmation.** | #75 |
| **#14 Templates nav** | S2 | ✅ **DONE** — `/attorney/templates` tab live (list/create/edit/archive via `legal.template.*`). **S2: extend, don't rebuild; reconcile with the WYSIWYG template work.** | #73 |
| **Research surface** (Perplexity) | S1/S6 | ✅ **DONE** — matter-page Research panel (`legal.research.ask/list`). S1's job is the Perplexity **connection activation** (still `disconnected`), not the UI. | #74 |

Also live from the tail: branded HTML email kit (`src/email/`, wired into the notification engine + Contract B) — **S3 builds the deep email client on top of this, not from scratch**; e-sign webhook fail-closed hardening (#72). The app now runs under RLS as `authenticated` (`SUBSTRATE_DB_ROLE`) — **relevant to S9**: app-traffic isolation is already enforced; S9 proves multi-tenant isolation + RBAC on top.

## Leases (disjoint; block anything outside its range)

S1 `0045–0047` · S2 `0048–0052` · S3 `0053–0055` · S4 `0056–0058` · S5 `0059–0061` · S6 `0062–0064` · S7 `0065–0068` · S8 `0069–0071` · S9 `0072–0075` · S10 `0076–0078`

## Contracts (owners) — watch signatures hold

A creds/probe (S1) · B `enqueueClientEmail` (S3) · C feature/nav registry (S2) · D1 `launchCompose` (S3) / D2 `launchScheduler` (S4) · E op-core · F money decimal · G service/workflow+booking block (S2) · H `renderTemplate` (S2) · I questionnaire schema (S2) · J doc action-bar registry (S6) · K rates (S7) · L settings-panel registry (S2) · M `getBusyIntervals` (S4). Hot seams: **G** (S5+S6 read), **M** (S5 reads), **D1/D2/K/L** (S2 renders against S3/S4/S7).

## Open items — CLOSED by Joe (2026-06-18)
1. **Tenancy model (S9): FIRM = TENANT, staff = users within it.** The firm is one tenant; attorneys/paralegals are actors/users under it sharing matters & clients; RBAC governs permissions. S9 must prove (a) ≥2 *firms* isolate (tenant A cannot read tenant B), (b) a non-owner role with a restricted permission is enforced. Per-user isolation is explicitly rejected. (Note: app-traffic already runs RLS-enforced as `authenticated` via `SUBSTRATE_DB_ROLE` — S9 builds provisioning + RBAC on top, no in-place core edits → foundation-upgrade request if core change needed.)
2. **Review-queue contents (S6): EVERYTHING — drafts + 'Ask Attorney' flags + new intake submissions.** The queue is the attorney's unified inbox of items needing attention: generated/merged drafts pending review, questionnaire 'ask attorney' flags, AND new intake submissions awaiting triage. #17 (select/sort/batch-execute) must operate across all three item types, not just drafts. Manager will verify the queue surfaces all three with live receipts.

## Per-worker status
| Worker | Lease used | PR | Receipts reproduced | Contract conformance | Gaps |
|---|---|---|---|---|---|
| S1–S10 | — | — | — | — | not started (no PRs open) |

## Activation checklist (Joe)
Anthropic ✅ · Google ✅ · **Granola ✅ (newly connected)** · Perplexity key/tier ⛔ · Google Maps billing+key ⛔ · OpenSign host+creds ⛔
