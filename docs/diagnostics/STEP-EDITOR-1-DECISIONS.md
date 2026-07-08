# STEP-EDITOR-1 — lossless step-editor round-trip + edit config in place

**Date:** 2026-07-08 · **Branch:** `step-editor-1` · **Migration:** none (frontier stays 0119)

## The bug (verified live)

`workflow_definition de68d039 v5` (NC Will Drafting) is a clean, valid 5-stage graph:
`client_intake → generate_will → review_send_will → client_response → complete`, where
`generate_will → review_send_will` is an **automatic** edge carrying `on: document.generated`
(#308's gate-transition vocabulary: an automatic/system edge REQUIRES an `on` event), and
`client_response` is an `invoke_capability` step carrying `action.config.capability_config`.

Both manual step editors mangled this saved graph:

- **Per-matter editor** (`WorkflowEditor.tsx`) rebuilt EVERY outgoing edge as
  `{ gate: <catalog default>, via: 'legal.matter.advance' }`. For `generate_will` the catalog
  default gate is `automatic`, so the rebuilt edge was `{ gate: 'automatic', via: … }` with **no
  `on`** → `validateLifecycle` (correctly) rejected it (`"automatic edge but names no 'on' event"`).
  Net effect: **no workflow containing an automatic edge could be edited/saved at all.** It also
  silently rewrote every edge's gate + `via`/`on` for edges it didn't invalidate.
  - Note on the brief's "phantom duplicate generate_document node": the builder maps rows 1:1 — it
    injects/duplicates no node. The observed corruption is entirely the edge rebuild (dropped `on` +
    rewritten gate/trigger). The regression test asserts exactly one `generate_document` survives.
- **Service editor** (`services/[serviceKey]/workflow/page.tsx`) dropped every stage's
  `action.config` in `graphToSteps`, so `client_response` round-tripped back as a **configless**
  `invoke_capability` step — its `capability_slug` + `capability_config` gone. Valid but semantically
  broken (the runtime can no longer resolve the capability).

The validator is #308 working as intended; the fix is in the EDITORS, not the validator (untouched).

## NEW-E — lossless round-trip

An outgoing edge belongs to its **source** step. On save we now PRESERVE that step's original edge
(`on`/`via`/`gate`/`when`) and only re-point its `to` at whatever step now follows it in array order.
A freshly-added step (no saved edge) gets a valid default synthesized from the catalog gate
(attorney/client → `via`; automatic/system → a sensible `on`). Round-tripping an unchanged valid
graph is the identity.

- Per-matter: extracted the rebuild into a pure, dependency-free `buildMatterGraph` in
  `matters/[id]/workflowGraph.ts` (self-contained structural types so it's unit-testable without TSX).
- Service: extracted `graphToSteps`/`stepsToGraph` (+ helpers) into `workflow/workflowBuilderModel.ts`
  and added `config` to the builder model so `action.config` is carried through verbatim.

## NEW-G — edit step config in place

Config now lives with the step that consumes it:

- **`invoke_capability` steps** (the review rubric, the "request materials" message) — the attorney
  edits `action.config.capability_config` string values ON the step, in BOTH editors. This round-trips
  because NEW-E preserves `action.config`.
- **`generate_document` steps** — the service editor surfaces the drafting-instructions editor ON the
  step (per document kind), reading/writing the SAME service-level prompt store
  (`legal.service.prompt.get/update`) the Prompt tab uses. The per-matter editor edits the on-stage
  `documents` (docKind/label); drafting instructions are service-level, so they are NOT editable
  per-matter (correct scoping).

**Reported (needs its own pass):** the separate service **Prompt tab** is left intact. Drafting
instructions are stored per-`(serviceKey, documentKind)`, not as stage config, so fully consolidating
the Prompt tab onto the generate step (removing the tab) would be a data-model + UX change — a
separate session. This session makes the step config editable + authoritative from the step, as the
brief's minimum bar requires.

## Acceptance (tests/vertical/step-editor-roundtrip.test.ts — 10 tests, real @exsto/legal validator)

- **A** — `buildMatterGraph(v5)` `toEqual(v5)` and validates; service `stepsToGraph(graphToSteps(v5))`
  `toEqual(v5)` and validates. No drift, exactly one `generate_document`, `on: document.generated`
  intact.
- **B** — reorder (review ahead of generate) and add (a `manual_task`) both save VALID graphs; the
  automatic edge keeps its `on`; a new step gets a valid default edge.
- **C** — editing a capability step's `capability_config` message is reflected after save in both the
  service round-trip and the per-matter rebuild.
- **D** — both editors round-trip losslessly (per-matter + service-level). Prompt-tab consolidation
  reported as a separate pass (above).

Validator unchanged and still rejects invalid graphs (capability-runtime tests stay green). No
migration; frontier 0119.
