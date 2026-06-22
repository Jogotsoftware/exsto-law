# ADR 0045: Matter lifecycle as data — a stage/transition graph the engine reads, not hardcodes

## Status

Proposed. Gates the "editable service Workflow" project for exsto-law (beta feedback
`c518a178`, `bf16d226`: "the workflow configured on a service should correspond to
the actual workflow a matter runs, and be editable"). Foundation-level because it
finally uses `workflow_definition.states`/`transitions` for their declared purpose,
and because any vertical with a multi-step process (Huber AR dunning, a corporate
deal flow) inherits the same lifecycle engine. Implemented in staged PRs (see
*Implementation notes*); no behavior changes until an attorney edits a lifecycle.

## Context

A "service" is a `workflow_definition` row (ADR 0032: matters are entities; a service
is the configuration a matter is opened against). The table has carried `states` and
`transitions` jsonb columns since migration 0008 — the substrate's intended home for
a state machine. In the legal vertical today:

- **`states` is empty (`[]`) and is never read.** Confirmed across the whole repo.
- **`transitions` is a flat config bag**, not a transition graph: it holds `route`
  (`auto`/`manual`), `generation_mode`, `documents`, `cost`, `intake_schema`,
  drafting `prompts`, and `document_templates`. (This repurposing predates this ADR
  and is left intact — see *Consequences → The `transitions` config bag*.)
- **The matter lifecycle is entirely procedural.** Status values
  (`inquiry → intake_submitted → consultation_booked → consulted → in_review →
  approved → …`) are scattered string literals written by individual action
  handlers (`matter.open`, `booking.create`, `call.ingest`, `draft.generate`/`merge`
  → `in_review`, `draft.approve` → `approved`). There is no canonical list, no
  graph, no validation that a transition is legal.
- **The two levers branch an *implicit* path.** `route === 'auto'`
  (`api/granolaIngestion.ts`) decides whether a transcript auto-enqueues drafting;
  `generation_mode` (`api/generateDraft.ts`) decides *how* a document is produced.
  Neither is represented as an editable stage graph.
- **The UI invents its own three-step model.** `deriveMatterSteps` (`matters/[id]/
  shared.tsx`) shows `intake | consultation | document` derived from the *presence*
  of related entities, not from status — so the attorney-visible "workflow" and the
  status the engine actually writes are two unrelated things.

This is exactly the drift hard rule 8 (configuration is data, not code) exists to
prevent: a new service's lifecycle cannot be defined without writing handler code,
and the same lifecycle can never be shown, edited, or reasoned over as data. The
product goal (AI-native business software where the operator configures the
process) is impossible while the process lives in `if (route === 'auto')`.

Two questions must be settled before an editable Workflow tab can exist:

1. **Where does a matter's lifecycle live as data**, given `transitions` is already
   an overloaded config bag?
2. **How does the engine drive off that data** without changing how any existing
   matter behaves on day one, and without letting an edit yank the rug out from a
   matter that is already in flight?

## Decision

### 1. The lifecycle is an ordered stage graph stored in `workflow_definition.states`

We reclaim the `states` column (empty today, the substrate's intended home) for an
**ordered array of stage objects, each carrying its own outgoing transitions**. The
graph is self-contained in `states`; the legacy `transitions` config bag is left
untouched (no collision, no migration of the bag).

```jsonc
// workflow_definition.states
[
  { "key": "intake_submitted", "label": "Intake submitted",
    "client_label": "Intake received", "entry": true,
    "advances_to": [
      { "to": "drafting", "gate": "automatic", "when": "questionnaire_present" }
    ] },
  { "key": "drafting", "label": "Drafting",
    "client_label": "Preparing your documents",
    "advances_to": [
      { "to": "in_review", "gate": "automatic", "on": "draft.completed" }
    ] },
  { "key": "in_review", "label": "Attorney review",
    "client_label": "Under attorney review",
    "advances_to": [
      { "to": "approved", "gate": "attorney", "via": "draft.approve" }
    ] },
  { "key": "approved", "label": "Approved",
    "advances_to": [
      { "to": "sent_for_signature", "gate": "attorney", "via": "document.send" }
    ] },
  { "key": "sent_for_signature", "label": "Sent for signature",
    "advances_to": [
      { "to": "completed", "gate": "system", "on": "esign.completed" }
    ] },
  { "key": "completed", "label": "Completed", "client_label": "Completed",
    "terminal": true }
]
```

A stage is `{ key, label, client_label?, entry?, terminal?, advances_to[] }`. An edge
is `{ to, gate, when?|on?|via? }`. Stable `key`s are the matter_status values already
written today, so existing matters and the new graph speak the same vocabulary.

### 2. Four gate kinds generalize `route` (and absorb the implicit branch)

Every edge declares **who or what advances it**:

| gate | who advances | example |
|------|--------------|---------|
| `automatic` | the worker/system, when the edge condition holds | intake → drafting (auto route) |
| `attorney`  | an attorney action | in_review → approved (`draft.approve`) |
| `client`    | a client action | intake → consultation_booked (`booking.create`); sent → signed |
| `system`    | an external callback | sent_for_signature → completed (`esign.completed`) |

`route` stops being a special case: **auto vs. manual is just whether the
intake→drafting edge is `automatic` or `attorney`.** A "manual" service has an
attorney-gated drafting edge; an "auto" service has an automatic one. `generation_mode`
stays orthogonal — it is *how* the `drafting` stage produces a document, not *when*
the stage is entered, so it remains per-document config in the `transitions` bag.

### 3. The engine reads the graph; the action layer still owns every write

A small, pure resolver (`packages/primitives` or `verticals/legal/src/lifecycle`)
exposes: `stagesFor(def)`, `currentStage(matter)` (= the `matter_status` attribute),
`allowedTransitions(matter, def)` (edges from the current stage filtered by gate +
condition), and `isAutomatic(from, to, def)`. Three call sites stop hardcoding:

- **Worker** (`granolaIngestion`/draft enqueue): "auto-draft?" becomes "is there an
  `automatic` edge out of the current stage?" instead of `route === 'auto'`.
- **Status writes** (the existing `matter_status` attribute writes through action
  handlers — hard rule 1 unchanged): an advance is **validated against the graph**
  (the target must be reachable from the current stage via an edge the actor's role
  is allowed to fire). No raw status strings outside a defined edge.
- **UI** (`deriveMatterSteps`) and **client portal labels** render from `states`
  (`label`/`client_label`) instead of the invented three-step model and the
  hardcoded `STATUS_LABELS` map — so what the attorney configured *is* what shows.

Status is still a `matter_status` entity_attribute written only by action handlers.
This ADR adds a data-defined **guard and vocabulary**, not a new write path.

### 4. Editing is a new version; in-flight matters bind to the version they opened under

`workflow_definition` is already versioned (`version`, `valid_from`, `valid_to`).
Editing a lifecycle **creates a new version** (next `version`, `valid_from = now`,
prior row's `valid_to = now`) through the action layer + a `configuration_change`
row — never an in-place `UPDATE` of a live row's `states` (ADR 0017 config-version
binding; hard rule 3 append-only spirit). A matter records the
`workflow_definition` version it was opened against at `matter.open`; the engine
resolves *that* version for the matter's whole life. New matters get the latest.
An edit can never reroute a matter that is already moving.

### 5. Backfill makes day one a no-op

A migration computes each existing service's `states` from the current hardcoded
path, parameterized by its `route`: the auto/manual choice flips one edge's gate;
the rest of the path (intake → drafting → in_review → approved → …) is the known
sequence. Until an attorney edits, the engine driven by backfilled data reproduces
today's behavior exactly. An invariant test asserts data-path == hardcoded-path for
every seeded service before the engine is allowed to read the data (PR3).

## Consequences

**Configuration becomes data (hard rule 8 satisfied)**
- A service's lifecycle is editable, inspectable, diffable, and versioned. Defining a
  new service's process needs no handler code — the original promise of `states`.
- The attorney-visible workflow and the engine-driven status are the same artifact;
  the feedback's "should correspond" holds by construction.

**Inherited by every vertical**
- Huber (AR dunning), corporate deal flow, etc. get a lifecycle engine, not a fresh
  pile of status literals. The gate kinds are domain-agnostic.

**Safety**
- Versioning + per-matter binding means edits are forward-only and never disturb
  in-flight matters (ADR 0017). Backfill + the equality invariant mean the cutover
  ships with zero behavior change.

**The `transitions` config bag**
- This ADR does *not* unwind the legacy repurposing of `transitions` for service
  config; it sidesteps it by putting the graph in `states`. The wart is documented,
  not fixed. A future ADR may move the config bag to a dedicated column; out of scope
  here (would touch every service read path for no user-facing gain right now).

**Cost / risk**
- Three engine call sites move from literals to a resolver; mistakes there change how
  matters progress. Mitigated by: staged rollout, the shadow-data equality invariant
  before flip, and the lifecycle-validity invariants (single `entry`, no orphan
  stages, a `terminal` reachable from `entry`, every edge `to` exists, every gate in
  the allowed set).
- A lifecycle read resolves a (cached) version per matter; negligible against the
  50ms primitive budget.

**Obligations**
- New status values must be added as stages in `states`, never as new literals in a
  handler. Advancing a matter must go through an edge; ad-hoc status writes are a
  regression. The editor's `set_lifecycle` action must reject invalid graphs.

## Implementation notes

Staged so each PR is independently safe and reviewable; the engine reads data only
after the equality invariant is green.

1. **ADR (this) → Accepted on sign-off.**
2. **Data + backfill + read resolver + invariants (shadow).** Migration backfills
   `states` for every service from `route`; pure resolver + lifecycle-validity
   invariant tests; engine still hardcoded. Assert data-path == hardcoded-path.
3. **Engine read-path flip.** Worker auto-draft check, status-advance validation, UI
   `deriveMatterSteps`, and client portal labels read `states`. Gated behind the PR2
   equality invariant. Bind matter → workflow version at `matter.open`.
4. **Editor (Workflow tab) + `legal.service.set_lifecycle` action.** Validates the
   graph, writes a new `workflow_definition` version through the action layer +
   `configuration_change`; extends `checkServiceCompleteness` to lifecycle validity.
   This is the user-facing deliverable that resolves `c518a178`/`bf16d226`.
5. **Polish.** Client portal labels fully data-driven; version-binding edge cases;
   docs/pattern entry for "defining a vertical's lifecycle as data."

New action kinds (schema-as-data, `kind.define`): `legal.service.set_lifecycle`
(intent `adjustment`/`configuration`). No new tables. Invariants land in
`tests/invariants/` (graph validity, version binding, append-only edit) per hard
rule 10; verified against the live DB per hard rule 12 before any "done".
