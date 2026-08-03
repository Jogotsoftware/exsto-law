# ESIGN-STEP-1 — trace of the "dead e-sign workflow step" report

**Date:** 2026-08-03. **Tenant:** Pacheco Law (`ae5530a1-05c7-4241-a38e-79bd186c1bbb`, slug `pacheco`), prod (`jfcarzprfpoztxuqykoe`).

**Report under investigation (2026-07-24 founder walk):** a workflow step labelled
"Members sign, then attorney countersigns / Esign · automatic" is a dead end; asked
"where do I add the signature spots?", the assistant sent the attorney away to the
standalone `/attorney/esign/compose` page. The work item drafted from that report
assumed (a) the `esignature` capability is contracted-but-unbuilt, (b) the step has
no in-place UI, (c) the builder composed a workflow against a nonexistent capability
and nothing caught it. **All three premises are false.** This file records what the
live DB actually shows.

## Verdict

Nothing is broken in the founder's service, the capability registry, or the
validators. The "dead end" was real as an *experience* but its cause was:

1. **The step never ran.** No matter has ever been opened on the multi-member LLC
   service (zero `workflow_instance` rows for `multi_member_llc_operating_agreement`,
   any version — verified 2026-08-03). The founder was mid-BUILD, not mid-matter:
   at build time there is no step window yet, and signature *fields* belong on the
   template (TemplateEsignPanel, #496), not on a step. The assistant answered "where
   do I add signature spots" from the standalone composer page the founder was
   already on (`page_context.path = /attorney/esign/compose` in every `assistant.turn`
   of that session) instead of pointing at the template's e-sign panel — an
   assistant-guidance gap, now logged in `docs/design/assistant-actions/INVENTORY.md` §6.
2. **The live workflow is correctly composed.** `multi_member_llc_operating_agreement`
   v10 (active, 2026-07-24 13:44 UTC): intake → `document_generation` →
   review_send —`draft.approve` (attorney gate)→ **signatures
   (`invoke_capability` / `capability_slug: esignature`, `document_kind:
   operating_agreement`)** —`esign.completed` (system gate)→ close_matter. The
   `esignature` slug resolves to the real handler
   (`capabilityRuntime.ts:94` → `runEsignatureCapability`, live since ESIGN-BLOCK-1).
   Versions 1–8 of the same definition (all deprecated, created over ~14 minutes in
   the same session) have empty `states` — build-session churn, not runtime hazard.
3. **The "duplicate capability" is a stale request row, not a seeded duplicate.**
   `send_document_for_e_signature` (entity `60802f3f-0a0b-44da-937d-7bf766e83d3e`,
   created 2026-07-20 17:42 UTC) has `capability_status: 'requested'` — it is the
   builder's own capability-request flow (`requestCapability`, api/capabilities.ts),
   filed during the *single-member* LLC build **while Pacheco's capability catalog
   was still unseeded** (the known B3.1 finding recorded in
   `demo/seed-capabilities.ts`'s header). The builder couldn't see `esignature`
   because, for that tenant on that day, there was nothing to see. The catalog was
   seeded later (Pacheco now carries the full contract set). Retired 2026-08-03 —
   see Ops below.

## The two guards the work item asked for already exist (proven live)

**Authoring** — `validateProposedLifecycle` (api/workflowAuthoring.ts:558-585) loads
the registry for any graph containing `invoke_capability` and refuses, in plain
English: unknown slug, non-`available` status (catches `requested` and
`deprecated`), non-`step_invocable`, and config-schema violations. Run 2026-08-03
against the live Pacheco tenant:

- graph naming `totally_made_up_capability` →
  `ok: false — stage "sign" references unknown capability "totally_made_up_capability"`
- graph naming `send_document_for_e_signature` (then status=requested) →
  `ok: false — … not available (status=requested)` + `… not step-invocable`

`proposeWorkflow` runs this validator before anything is persisted, so an attorney
can never be shown an approvable card for a workflow that names a nonexistent or
non-live capability.

**Runtime** — `invokeCapabilityForMatter` (api/capabilityRuntime.ts:234-246) fails
an unknown slug with a recorded `capability_not_executable` failure, and the step
runner (`RunnerReview.tsx:224-233`) renders `capability_invoke_failed` /
`capability_run_stalled` / `capability_run_enqueue_failed` as an honest FAILED state
with "Run this step again". A step cannot park inert-and-silent on a bad slug.

## Registry sweep (all tenants, all workflow versions, live and deprecated)

Every `capability_slug` referenced by any `invoke_capability` stage in any
`workflow_definition` across all tenants resolves to a real runtime handler:
`document_generation`, `transcript_extraction`, `esignature`, `ai_document_review`,
`request_client_materials`, `email_generation`. **No orphan slugs.** One deprecated
Dev Firm graph (`nc_will_drafting` v6) has a null slug on a stage — deprecated,
unreachable, left as history (append-only).

## Ops performed (action layer, prod)

- `send_document_for_e_signature` → `status: deprecated` via `legal.capability.upsert`
  (`upsertCapability`), with a why-note appended to its `purpose` pointing at
  `esignature`. Verified by re-read: `deprecated`. No raw writes; entity retained
  (append-only supersession).

## Left open, deliberately

- **The single-member LLC service (v11, active) has no e-sign step at all** — the
  residue of the same 2026-07-20 unseeded-catalog gap (its signing was left as a
  manual attorney to-do; the request row's own purpose text says exactly this).
  Adding a signatures stage is a one-line workflow edit in the step editor, but it
  changes the founder's live service — his call, not a session's.
- **The auto-advance chain** (approve → auto-send to client → client approves →
  e-sign → send): the graph vocabulary already expresses every link (attorney
  `draft.approve` edge → `advanceInstanceOnApprove`; client-gated stages advance via
  `dispatchClientDelivery`; `esignature` auto-runs on stage entry and parks on the
  system gate until `esign.completed`). v10 as approved by the founder goes
  approval → signatures directly, with no client-approval leg in between — that is
  what he approved, not a missing feature. No code was added for this, per the
  "prove configuration can't do it first" rule: configuration can.
