---
slug: firm-admin.author-workflow
name: Author a Service Workflow
practice_area: firm-admin
description: Compose a service's step-by-step lifecycle from the attorney's described real-world process — using only the closed STEP_ACTION_KINDS and GATE_KINDS, linear, attaching only real document templates — and deliver it as a propose→approve card.
when_to_use: Applied by firm-admin.build-service (and on its own) when building or changing the workflow for an EXISTING service — turning how the attorney actually delivers the work into the matter lifecycle. Loaded as a discipline, not usually invoked directly by the attorney.
user_invocable: false
---

## Purpose

Turn the attorney's real-world process into the service's matter lifecycle — the ordered steps a matter moves through, and who advances each one. You compose the graph ONLY from the platform's closed catalog, keep it linear, attach only document templates that actually exist, and deliver it as a proposal the attorney approves. The live workflow is written only on their approval — never by you directly.

Apply `firm-admin.platform-discipline`: this is propose→approve, agent-sourced, reasoning-traced, honest-confidence, catalog-constrained.

## Before you begin

- **The service must already exist**, and its **templates must already be authored**, because steps attach documents by the template's real `templateEntityId`. This is why workflow comes AFTER the service shell and the templates in the build order.
- **You only MODIFY existing services.** You never create a service from this skill.
- **Call `get_workflow_context` FIRST.** It returns the closed step-action catalog (kind, label, description, defaultGate, blocking), the closed gate set, the service's CURRENT lifecycle (null if none yet), and the firm's available document templates with their ids. Compose ONLY from what it returns — never invent a step kind, a gate, or a template id.

## Step 1: Interview the real process

Map the attorney's words to steps. Ask how the work actually flows with `ask_build_question` — what happens first, then what. Let their answer drive the graph; do not impose a generic flow.

**ASK the gate per step — never assume.** For EACH step, ask the attorney who advances it with an `ask_build_question` whose choices are the four gates: `automatic` (the system advances it), `attorney` (an attorney action advances it), `client` (a client action advances it), `system` (an external event advances it — payment, e-sign, filing). Each step's gate comes from the attorney's answer, not from a silent default. (The table below lists each step kind's *natural* default only as a fallback hint when the attorney genuinely has no preference — always ask first.)

## Step 2: Map each real step to a catalog STEP_ACTION_KIND

Use ONLY these step-action kinds (the closed `STEP_ACTION_KINDS` catalog). Each has a natural default gate:

| kind | what it does | default gate | blocking |
|---|---|---|---|
| `view_intake` | client fills the intake questionnaire; attorney reads answers | `client` | yes |
| `view_consultation` | shows the consultation (Granola) summary; informational | `attorney` | no |
| `invoke_capability` | runs a registered platform capability as a step — **drafting is authored this way** (the `document_generation` capability), as are AI review (`ai_document_review`), client materials (`request_client_materials`), e-signature (`esignature`), client emails (`email_generation`), and transcript extraction (`transcript_extraction`) | the capability's `default_gate` | yes |
| `review_send_document` | attorney reviews → approves → sends the document to the client | `attorney` | yes |
| `approve_send_invoice` | attorney approves the invoice; it auto-sends to the client | `attorney` | yes |
| `await_payment` | holds the matter until the invoice is marked paid | `system` | yes |
| `manual_task` | a free-form to-do the attorney checks off (anything outside the above) | `attorney` | yes |
| `complete_matter` | closes the matter; terminal step | `system` | no |

If the attorney describes a step that isn't one of the standard kinds, use `manual_task` — do NOT invent a kind. An informational step (e.g. a consultation) should be `blocking: false` so it never holds the matter up.

**Never author `generate_document` — it is deprecated and the validator rejects it.** A drafting step is an `invoke_capability` stage running the `document_generation` capability: copy that capability's `stepTemplate` from `get_workflow_context` verbatim and fill `action.config.capability_config` (the real `template_entity_id` of the firm template it drafts, and `generation_mode`: `ai_draft` or `template_merge`).

## Step 3: Pick the right gate for each edge

Every outgoing transition has a `gate` — who or what advances it. Use ONLY the closed `GATE_KINDS`:

- `automatic` — the worker/system advances when the condition holds (name it in `on`). Use for a drafting step (`invoke_capability` running `document_generation`) that fires as soon as intake is in.
- `attorney` — an attorney action advances it (name the action in `via`, e.g. a draft approval). Use for review/approve steps.
- `client` — a client action advances it (name it in `via`, e.g. booking/intake submit, a signature). Use after a `view_intake` step.
- `system` — an external callback advances it (name it in `on`, e.g. payment received, e-sign completed). Use for `await_payment`.

Map the real-world "who moves this forward?" answer to the gate. A step where the attorney waits on the client → `client` gate; where they wait on an outside event (state filing, signature, payment) → `system` gate.

## Step 4: Keep it LINEAR

The workflow MUST be linear — this is enforced by the validator and it will reject a non-linear graph:

- Exactly ONE entry stage (`entry: true`).
- Exactly ONE reachable terminal stage (`terminal: true`, no outgoing edges) — typically `complete_matter`.
- Every non-terminal stage has EXACTLY ONE outgoing edge (`advances_to` with one transition). No branching, no fan-out.
- Stage `key`s are stable snake_case and unique; each edge's `to` points at a real stage key.

## Step 5: Attach documents by real templateEntityId only

Templates bind two different ways, by step shape:

- **Drafting steps** (`invoke_capability` running `document_generation`) bind their template via `action.config.capability_config.template_entity_id` — NOT via `documents[]` and NOT via `docKind`. One drafting step, one template, one real id.
- **`review_send_document` steps** attach the document they review via the `documents[]` array, referencing an EXISTING firm template by `templateEntityId` from `get_workflow_context`. (A service-bound template may instead be referenced by `docKind`.)

Either way: never an invented id, never a made-up document. This is why templates are authored before the workflow — there must be a real id to bind.

## Step 5a: E-signature — only where a document is signable

An e-signature step is an `invoke_capability` stage running the `esignature` capability, and it composes in exactly ONE place: **right after the step(s) that produce and approve a document whose template declares `signature.required`** — the drafting stage (`invoke_capability` running `document_generation`), optionally followed by its `review_send_document` review stage (the usual shape, since only an APPROVED document is ever sent for signature). The validator rejects anything else — never an e-sign step on an unsigned document, never free-floating.

- Gate is `system`; the edge advances `on: esign.completed` (all signers finished). The step sends the latest APPROVED version of the preceding step's document and parks the matter until every signer signs.
- If the attorney wants a signature on a document whose template does not declare it, fix the TEMPLATE first (`signature: { required: true, signer_roles: ['client', ...] }`), then compose the step.
- If the matter produces several documents, pin which one with `capability_config.document_kind`.

## Step 5a-bis: Email and transcript-extraction steps — the comms blocks

- **Client email** — an `invoke_capability` stage running the `email_generation` capability: the machine drafts the email from the matter facts, the client's FULL history (including archived matters), and the attorney's `capability_config.purpose` (what the email should say); the draft lands in the review queue and **approving it is what sends it** — so the stage's edge is gate `attorney`, advancing `via: draft.approve`. Optional config: `mode: 'template'` + `template_entity_id` (exact firm-library id) for a deterministic canned send; `recipient_role` defaults to `client`. Compose it wherever a service should TELL the client something (documents ready, what happens next, a request explained). Nothing reaches the client unapproved.
- **Transcript extraction** — an `invoke_capability` stage running the `transcript_extraction` capability: distills the matter's consultation transcript into notes (a summary + extracted facts/action items) that feed the client's assembled memory. Extracted facts are AI output, so the stage parks at the `attorney` gate — the attorney reviews the notes and advances `via: legal.matter.advance`. Optional `capability_config.instructions` focuses the extraction. Compose it right after a consultation step.

## Step 5b: Declare billing and completion — every workflow states both

The validator REJECTS a workflow that produces documents but declares no billing, and a workflow whose terminal stage is not a completion step. Ask the attorney and declare both:

- **Billing is a forced CHOICE — default ONE billing point.** Ask "when does the client get charged?" and declare exactly the model the attorney picks:
  - *Per-document fees, accrued on approval* — the fee for each document accrues the moment the attorney approves it in the review queue. Declare them on the billing card (`propose_cost` with `document_fees`, one amount per document kind); the workflow itself needs no extra step.
  - *One invoice mid-matter* — add `approve_send_invoice` (and usually `await_payment`) to the graph where the invoice goes out. The invoice collects the fees accrued so far; it is a billing point, not an extra charge.
  - *At completion* — the service's flat fee (`propose_cost`, fixed) accrues when the matter completes; no document fees, no invoice step. For a document-producing service, get this billing approved BEFORE proposing the workflow — the validator requires a visible declaration (fees, an invoice step, or an already-set flat fee). An HOURLY service that produces documents still needs an invoice step: hourly time accrues nothing by itself.
  - *A deliberate split* — more than one of the above ONLY when the attorney explicitly chooses it. Declaring both a per-document fee and a flat service fee charges the matter TWICE; the validator surfaces a split-billing WARNING on the card — relay it and confirm intent, never let a double-bill emerge silently.
  A document-producing workflow with NO billing declaration is invalid — the matter would produce work nobody ever bills. **Every workflow/cost card states the total per-matter charge the composed billing produces** (platform-computed); read it back to the attorney if it isn't what they said.
- **Completion** — the terminal stage MUST be a `complete_matter` step. Completing the matter accrues the service's completion fee (if the service declares one) and archives the matter (archived, never deleted).

## Step 6: Propose — never write live

When the graph is complete and valid, deliver it by calling `propose_workflow`. This does NOT save anything: it captures the proposal as an approval card. The graph is validated (structure + closed action-kind vocab + linear-only + referenced template ids must exist); if validation fails it returns the errors — fix them and propose again. Include a one-paragraph `summary` (the WHY — what this workflow does and what changed) and your honest `confidence` (0–1, never 1.0); both are recorded as the reasoning trace when the attorney approves. The live version is written ONLY when the attorney approves the card.

Your chat reply after a successful propose is ONE short sentence pointing them to the card — never the steps in prose.

**Revisions are surgical, and you never characterize them yourself.** When the attorney asks for a change, re-emit the SAME graph — same stage keys, same labels, same configs, same messages — with exactly the requested change. The platform computes and shows what actually changed vs the live workflow on the card; never claim "only X changed" in your summary (the computed read-out will expose it), and never rename, reword, or "improve" anything the attorney didn't ask about.

## Example mapping

> Attorney says: "Client fills out the intake, we have a consult, then I draft the operating agreement, review and send it, invoice them, and once they pay I close the matter."

```
1. intake          view_intake          gate: client     → 2   (blocking)
2. consultation    view_consultation    gate: attorney   → 3   (blocking:false)
3. draft           invoke_capability    gate: automatic  → 4   [document_generation]
4. review_send     review_send_document gate: attorney   → 5   [doc: OA templateEntityId]
5. invoice         approve_send_invoice gate: attorney   → 6
6. payment         await_payment        gate: system     → 7
7. done            complete_matter      gate: system     (terminal)
```

The draft step's `action` is `document_generation`'s `stepTemplate` from `get_workflow_context`, copied verbatim with the placeholders filled — e.g.:

```json
{
  "kind": "invoke_capability",
  "config": {
    "capability_slug": "document_generation",
    "capability_config": {
      "template_entity_id": "<the OA template's real entity id>",
      "generation_mode": "ai_draft"
    }
  }
}
```

## What this skill does not do

- It does not invent step kinds or gates — it composes from the closed `STEP_ACTION_KINDS` / `GATE_KINDS` returned by `get_workflow_context`.
- It does not branch — the lifecycle is strictly linear, one entry, one terminal.
- It does not attach imaginary documents — only real `templateEntityId`s from the firm library.
- It does not write the live workflow — `propose_workflow` captures a card; the attorney's approval is the only write.
