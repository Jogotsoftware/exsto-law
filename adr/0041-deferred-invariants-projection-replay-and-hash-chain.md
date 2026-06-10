# ADR 0041: Invariants 13 (projection/replay) and 18 (hash-chain computation) are deliberately shallow — scope, rationale, and revisit trigger

## Status

Accepted. Records, explicitly, the two Layer-1 invariants whose enforcement is
intentionally partial in the foundation, so that "shallow" is a documented
decision with a trigger — not a silent gap. Companion to the foundation
certification (`docs/FOUNDATION_CERTIFICATION.md`).

## Context

The Layer 0–2 Definition of Done lists 23 invariants and says none are deferred.
That is true at the level of **schema and structural guarantee**: every invariant
has its tables, columns, and (where applicable) triggers/RLS in place, and the
invariant suite is green. But two invariants have a meaningful gap between
"structurally present" and "fully computed/exercised," and the certification
process required naming them precisely rather than letting them pass as fully
realized.

The foundation's reason to exist is the **append-only, bitemporal, provenance**
core — and that core is fully enforced (the adversarial audit proves edits to
sealed rows and append-only tables are blocked for every role). Invariants 13 and
18 are additive guarantees layered on top of that core; both can be completed later
without schema rework, because their substrate is already in place.

### Invariant 13 — projection determinism from raw events to normalized state

**What exists.** `raw_event_log` (append-only, hash-chain columns reserved), the
event/action primitives, the worker runtime (`workers/runtime`) with a dispatcher,
retry/backoff, dead-letter, and tenant binding, and the determinism rules in
`docs/patterns/projection-worker.md` + ADR 0013.

**What is shallow.** There is **no built projection/replay engine**: no
materialized projection tables maintained by a worker, and no re-projection path
that rebuilds normalized state from `raw_event_log` and asserts byte-identical
output. The determinism *contract* is documented and the runtime that would host a
projector exists; the projector itself, and a test that replays events twice and
diffs the result, do not.

**Why deferred.** A projection engine is only meaningful against a real ingestion
source and a real read model. The foundation's reads are computed directly from the
bitemporal primitives (current-state/as-of/history queries), which already give
correct, deterministic answers without a separate projection layer. Building a
generic projector now would be speculative — it would encode assumptions about a
read model that the first real vertical (Huber) will actually define. Premature
generalization here is exactly the Layer-4 tech-debt the DoD warns against.

### Invariant 18 — cryptographic event chains (per-tenant configurable)

**What exists.** Append-only LOG tables (`action`, `event`, `raw_event_log`,
`reasoning_trace`, …) carry HLC columns and **reserved hash-chain columns**, and
the append-only/seal triggers (migrations 0017/0018) make the rows structurally
immutable — no role, including owner/`service_role`, can UPDATE or DELETE a
recorded log row (proven in `docs/ADVERSARIAL_AUDIT.md`, A6/A7/A13).

**What is shallow.** The hash chain is **not computed or verified**. The reserved
columns are not populated with a per-row `prev_hash`/`row_hash`, and there is no
function that walks a tenant's chain and verifies it is unbroken. Tamper-evidence
today comes from the **triggers and grants** (you cannot edit history in the first
place), not from a cryptographic chain that would detect an edit made by bypassing
the database (e.g. at the storage layer, or by a future BYPASSRLS path).

**Why deferred.** The DoD itself scopes signature verification as "per-tenant
opt-in, off by default" and lists "cryptographic event chain signature
verification" as out of scope for Layer 0–2 (schema and hashing present, signing
deferred). The structural immutability the triggers provide is the load-bearing
guarantee for every current threat model (an attacker operating through the
adapters or any SQL role). The cryptographic chain defends a *different* threat —
out-of-band tampering with the physical storage — which is not in the foundation's
threat model and is better designed against the real storage/backup topology of a
deployment.

## Decision

Both invariants ship **structurally complete but computationally shallow**, as
documented above. This is recorded as a deliberate decision, not an oversight. The
invariant suite continues to assert the structural guarantees (append-only, seal,
RLS, schema-as-data); it does **not** assert a working projector or a populated
hash chain, and must not be read as doing so.

The shallow surfaces are labelled at their source:

- `docs/patterns/projection-worker.md` states the engine is not built.
- The hash-chain columns are reserved (documented in the migration that defines
  them) and `QUESTIONS.md` #6 tracks the open question.
- `docs/FOUNDATION_CERTIFICATION.md` lists both as the named, bounded gaps.

## Revisit trigger

Complete each invariant when — and not before — its triggering condition arrives:

- **Invariant 13 (projection/replay):** the first vertical that needs a **derived
  read model maintained from an event stream** (e.g. Huber AR/credit: an
  aging/exposure projection rebuilt from invoice + payment events). At that point,
  build the projector as a worker handler, add a re-projection command, and add a
  replay-determinism test that diffs two rebuilds. The worker runtime is ready to
  host it.

- **Invariant 18 (hash chain):** the first tenant with a **regulatory or contractual
  tamper-evidence requirement** that the structural guarantees do not satisfy
  (i.e. a need to detect out-of-band storage tampering, not just to prevent
  in-band edits). At that point, populate `prev_hash`/`row_hash` on insert via the
  action layer and add a `verify_chain(tenant)` function + test. Make it per-tenant
  opt-in, as the DoD specifies.

Until those triggers arrive, completing either invariant would be building against
imagined requirements — which the architecture explicitly rejects.

## Consequences

**Honest**
- No invariant is silently "done" when it is partial. A reader of the certification
  knows exactly what is enforced (structure) vs. computed (projection bytes, chain
  hashes).

**Bounded risk**
- The deferral does not weaken the core. History is immutable *today* via triggers
  and grants; the deferred work adds detection of a threat (out-of-band tampering)
  and a capability (re-projection) that no current consumer needs.

**Obligation**
- The revisit triggers are real commitments. The first vertical that hits either
  condition must complete the corresponding invariant as part of that work, not
  defer it again. This ADR is where that obligation is recorded.
