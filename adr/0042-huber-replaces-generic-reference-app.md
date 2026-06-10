# ADR 0042: Huber is the proof-of-life vertical; it replaces the generic task/notes reference app

## Status

Accepted. Amends `docs/product/02_LAYER_0-2_DEFINITION_OF_DONE.md` (the "reference
app" section and DoD item 7). Supersedes the requirement for a generic, multi-user
task-and-notes reference app as the substrate's dogfood.

## Context

The Layer 0–2 DoD names a **generic reference app** — a multi-user task-and-notes
app used daily by the founder (and his fiancée) — as the dogfood and smoke test:
the thing that exercises every invariant and every primitive in real use before the
substrate is declared done (DoD item 7). That choice dates from when the build
sequence was "substrate → generic dogfood → customers," and the dogfood's job was
to find substrate gaps in real use without entangling a customer.

Two things have changed since:

1. **The substrate is independently proven.** The foundation now has the operation
   core, both adapters (MCP + REST), the worker runtime, a reproducible bootstrap,
   the skill library, a green invariant suite (33/33), a passing clone test, and a
   clean adversarial audit (`docs/FOUNDATION_CERTIFICATION.md`). The structural
   guarantees the reference app was meant to shake out are verified by tests and the
   audit, not only by daily use.

2. **A real vertical is ready to be the dogfood.** Huber (AR/credit) is a concrete,
   committed engagement with a real read model (aging/exposure), real ingestion
   (invoices, payments), real multi-user operation, and real stakes. Building a
   *separate* generic task/notes app now would mean maintaining a second,
   throwaway surface whose only purpose is to exercise primitives that Huber will
   exercise harder and for real.

A generic task/notes app and a real customer vertical are both Layer-3 consumers of
the same substrate. The substrate does not care which one sits on top — by design
(ADR 0038, the operation core). So the question is purely which dogfood gives the
most honest signal per unit of effort, and the answer is the one with real users,
real data, and real consequences.

## Decision

**Huber is the substrate's proof-of-life vertical, replacing the generic
task/notes reference app.** DoD item 7 ("the reference app runs end-to-end…") is
satisfied by Huber running end-to-end on the substrate, not by a separate generic
app.

Concretely:

- Huber is built as a Layer-3 vertical (`verticals/…` + `apps/…`) on the **same
  substrate**, in a private fork, exactly as ADR 0029/0030 prescribe — no substrate
  changes to make a feature work (anything generalizable is considered for upstream
  merge).
- The dogfood obligations transfer to Huber: it must exercise tenancy, temporality,
  provenance, knowability, append-only history, the worker runtime (a real
  time-based job, e.g. a dunning reminder), role/permission scoping, the activity
  feed/audit trail, and the AI-effectiveness primitives (reasoning trace →
  judgment → contestation), in real multi-user use.
- The substrate is **not** blocked on a generic reference app. The clone test +
  invariant suite + adversarial audit + Huber's real use are the proof.

This does **not** change the substrate's customer-agnostic posture. Huber-specific
code lives in Huber's fork at Layer 3; the foundation stays vertical-neutral. Huber
is the *first* dogfood, not the *only* possible one — a future generic reference app
may still be built if a vertical-neutral demo is wanted, but it is no longer a gate.

## Consequences

**Better signal**
- The dogfood now has real users, real data, and real consequences, which surfaces
  substrate gaps a synthetic task app never would (concurrency on shared accounts,
  contested facts that matter, projection/aging read models — see ADR 0041's
  revisit trigger for invariant 13).

**Less throwaway work**
- No second, disposable surface to build and maintain solely to tick a DoD box.

**Obligation / watch-out**
- The dogfood must not silently pull substrate changes into the foundation to make
  a Huber feature work. The hard rule stands: concepts become kinds, operations
  become MCP tools, the app calls an adapter — never the DB, never a substrate edit
  (CLAUDE.md hard rule 1; `exsto-new-vertical`). If Huber genuinely needs a
  substrate capability, that is a deliberate, separately-reviewed upstream change,
  not a Layer-3 convenience.
- Because Huber is in a private fork, the "exercises every invariant" evidence must
  be captured deliberately (a checklist mapping Huber features → invariants), since
  it will not live in the public foundation repo.
