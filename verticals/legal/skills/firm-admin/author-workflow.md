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
| `generate_document` | produces a draft from the step's template(s) + intake answers | `automatic` | yes |
| `review_send_document` | attorney reviews → approves → sends the document to the client | `attorney` | yes |
| `approve_send_invoice` | attorney approves the invoice; it auto-sends to the client | `attorney` | yes |
| `await_payment` | holds the matter until the invoice is marked paid | `system` | yes |
| `manual_task` | a free-form to-do the attorney checks off (anything outside the above) | `attorney` | yes |
| `complete_matter` | closes the matter; terminal step | `system` | no |

If the attorney describes a step that isn't one of the standard kinds, use `manual_task` — do NOT invent a kind. An informational step (e.g. a consultation) should be `blocking: false` so it never holds the matter up.

## Step 3: Pick the right gate for each edge

Every outgoing transition has a `gate` — who or what advances it. Use ONLY the closed `GATE_KINDS`:

- `automatic` — the worker/system advances when the condition holds (name it in `on`). Use for a `generate_document` step that fires as soon as intake is in.
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

A step that hands the client a document (`generate_document`, `review_send_document`) attaches it via the `documents[]` array, referencing an EXISTING firm template by `templateEntityId` from `get_workflow_context` — never an invented id, never a made-up document. (A service-bound template may instead be referenced by `docKind`.) This is why templates are authored before the workflow: there must be a real id to bind.

## Step 6: Propose — never write live

When the graph is complete and valid, deliver it by calling `propose_workflow`. This does NOT save anything: it captures the proposal as an approval card. The graph is validated (structure + closed action-kind vocab + linear-only + referenced template ids must exist); if validation fails it returns the errors — fix them and propose again. Include a one-paragraph `summary` (the WHY — what this workflow does and what changed) and your honest `confidence` (0–1, never 1.0); both are recorded as the reasoning trace when the attorney approves. The live version is written ONLY when the attorney approves the card.

Your chat reply after a successful propose is ONE short sentence pointing them to the card — never the steps in prose.

## Example mapping

> Attorney says: "Client fills out the intake, we have a consult, then I draft the operating agreement, review and send it, invoice them, and once they pay I close the matter."

```
1. intake          view_intake          gate: client     → 2   (blocking)
2. consultation    view_consultation    gate: attorney   → 3   (blocking:false)
3. draft           generate_document    gate: automatic  → 4   [doc: OA templateEntityId]
4. review_send     review_send_document gate: attorney   → 5   [doc: OA templateEntityId]
5. invoice         approve_send_invoice gate: attorney   → 6
6. payment         await_payment        gate: system     → 7
7. done            complete_matter      gate: system     (terminal)
```

## What this skill does not do

- It does not invent step kinds or gates — it composes from the closed `STEP_ACTION_KINDS` / `GATE_KINDS` returned by `get_workflow_context`.
- It does not branch — the lifecycle is strictly linear, one entry, one terminal.
- It does not attach imaginary documents — only real `templateEntityId`s from the firm library.
- It does not write the live workflow — `propose_workflow` captures a card; the attorney's approval is the only write.
