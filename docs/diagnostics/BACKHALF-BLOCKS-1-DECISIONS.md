# BACKHALF-BLOCKS-1 — Decision log

Branch: `backhalf-blocks-1` (isolated worktree, based on origin/main @ 5757a06).
Frontier verified: vertical migration **0119** is the tip (`0119_tenant_public_slug.sql`).
**No new migrations. No new kinds.** All action/event kinds this session wires already exist.

## D1 (WP1) — "approve accrues" reconciled to the EXISTING billing ledger event

The brief's acceptance #1 asks for `legal.matter.add_fee` on approve. Ground truth from the
code (root-cause rule: *wire the existing machinery, don't build parallel machinery*):

- The canonical billing ledger event is **`document_fee.recorded`** (read by
  `queries/billing.ts`, the billing page, invoice.ts). `legal.matter.add_fee` is the *manual*
  action and it simply **emits `document_fee.recorded`** (`handlers/fee.ts:135`).
- Auto-accrual on approve **already exists**: `handlers/draft.ts` →
  `accrueDocumentFeeOnApproval` emits `document_fee.recorded` directly (the in-handler idiom;
  a handler never nests a `submitAction` for `legal.matter.add_fee`). It is already idempotent
  per `(matter, document_kind)`.

So the accrual path is correct and present. The reason **no fee accrues in prod** is two-fold:
1. the service (`nc_will_drafting`) declares **no** `transitions.document_fees`, so the accrual
   hits its "no amount declared" branch and **silently returns** (the lie), and
2. no service declared billing at all (WP2).

**Decision:** keep `document_fee.recorded` as THE accrual event (do not add a parallel
`legal.matter.add_fee` call). Fix the silent branch: when a document is approved and the
service declares no fee for that kind, record an **observation** (`document_fee_not_declared`)
instead of returning silently. Acceptance #1 is satisfied by a `document_fee.recorded` row on
the matter (the same event `legal.matter.add_fee` writes) — the acceptance query targets that.

## D2 (WP2) — billing + completion DECLARED on the workflow

- **Completion** is a graph fact: the workflow must **end in a `complete_matter` terminal
  stage**. `validateProposedLifecycle` gains this check (exact-path error, template-check
  style). The terminal step, when reached/driven, fires `legal.service.complete` (accrues the
  service completion fee via `handlers/fee.ts`) **and** `entity.archive` on the matter
  (archived, never deleted — the same core action `capunify-prod-setup` uses for stranded
  matters). Exposed via Contract W `complete`.
- **Billing declaration** is: EITHER per-document fees (`transitions.document_fees`,
  accrue_on_approve, WP1) AND/OR an explicit `approve_send_invoice` step in the graph. A
  workflow that **produces documents** (a `generate_document` or `invoke_capability`
  document_generation step) but declares **neither** is rejected. `validateProposedLifecycle`
  loads the service's `document_fees` (by serviceKey) to answer this.
- `nc_will_drafting` is re-authored to carry a document fee for the will and it already ends in
  a `complete_matter` terminal.

## D3 (WP3) — client accept + attorney skip

- **Client accept:** the dormant `legal.client_request.accept` action is wired to ALSO advance
  the matter's client gate. Its handler (`handlers/clientRequest.ts`) resolves the related
  matter (`client_request_of`) and calls `dispatchClientDelivery(matter,
  'legal.client_request.accept')`. `legal.client_request.accept` is **added to the CLIENT gate
  vocabulary** (`gateTransitions.ts`) and the pinning unit test. A client-review stage whose
  client edge is `via: 'legal.client_request.accept'` then advances when the client accepts.
  (Reuses an existing action kind — no new kind, no migration. Decision-logged per brief.)
- **Attorney skip:** Contract W `skip` submits `legal.matter.advance` with `gate: 'client'` and
  the client edge's `to`, as the **attorney** actor (a human MAY fire a client gate;
  `handlers/workflow.ts` only blocks humans from system/automatic gates), plus an
  `observation` (`client_step_skipped_by_attorney`). Rejected when the current stage has **no
  client edge** (validate: skip only applies to client-gated stages).

## D4 (WP4) — regenerate supersedes

Contract W `regenerate` enqueues **`legal.capability.run`** (off-request; no LLM in-request)
with a `regenerate` flag + `changeNotes`. The worker path bypasses BOTH idempotency guards for
a deliberate regenerate: the `capability.invoked` (matter,stage) guard **and**
`draftAlreadyExists`. `changeNotes` ride the producer's `guidance` input (WHAT to draft) — they
**cannot** reach the output/trace format (WP5 owns the format). Prior draft versions are
retained (append-only); regenerate produces the next version.

## D5 (WP5) — drafting-prompt trace-contract hardening

`validateDraftingPrompt` currently checks only the three mustache slots. A config prompt missing
the fenced output/trace contract silently dead-letters every `ai_draft` (the June 20 → Jul 9
outage class). Fix: on save, **validate AND auto-append** the output/trace contract when absent;
and make the worker parse **default missing evidence to `[]`** so a bare prompt still yields a
parseable draft. Receipt: a deliberately bare prompt on a throwaway service still drafts.

## D6 — acceptance fee amounts (demo values, Joe can retune in Settings)
- `nc_will_drafting` document fee: **$350.00** (`document_fees.last_will_and_testament`,
  service v10). Its pre-existing fixed service cost ($1000) still accrues at completion —
  the two are separate declared fees (document fee on approve + service fee on complete);
  if Joe wants approve-only billing, clear the fixed cost in Settings → the service.
- `capunify_reuse_demo_operating_agreement`: $200.00 OA document fee (demo service).
- Receipt clone `nc_will_drafting_copy`: $100.00 (throwaway).

## D7 — regenerate job vs. function receipts (deploy dependency)
The regenerate WORKER branch (legal.capability.run `{regenerate:true}`) ships in this PR;
the deployed Render worker only gains it when the PR merges + deploys. Acceptance #4 was
proven by running the worker-side function (`regenerateStageDocument`) locally against
prod — the exact code the worker handler dispatches to. A regenerate job enqueued BEFORE
the worker deploy would be claimed by the old worker and run as a plain
`invokeCapabilityForMatter` (idempotent skip — harmless no-op, no double-draft). Post-
deploy, the queue path is end-to-end.

## Open / risks
- **Post-deploy re-verify:** curl the four Contract W endpoints on the deployed site and
  run one regenerate through the REAL queue path (enqueue → deployed worker → v-next).
- **Portal Accept UI:** the accept endpoint/action is live; the portal button + which
  services' client edges switch `via` to `legal.client_request.accept` is the runner
  session's UI turf + a product decision per service (an accept edge replaces the
  message/upload edge on a linear graph).
- **nc_will_drafting client edge** still advances via `client.message.post` (unchanged —
  deliberately not switched under the runner session's feet).
- Firm-admin skills re-seed to prod (seed-firm-admin-skills.ts, reads the updated .md
  doctrine) — run at merge time so tool and skill move together.
