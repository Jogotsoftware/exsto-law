# ADR 0009: Every change goes through the action layer

## Status
Accepted

## Context
A system of record must answer "what changed, who changed it, why, when, on whose authority." Without a uniform answer, audits become forensics.

The standard approach is database-level audit triggers: every change to substrate tables is captured in a parallel audit table by a trigger. This works for catching the change but loses context. The trigger sees the new row; it does not see the user's intent, the reasoning, the autonomy tier, the action that grouped multiple writes into one logical operation.

For Exsto, the audit story has higher stakes. AI agents will be writing to the substrate. Their actions need to be auditable not just at the row level but with reasoning, alternatives considered, and explicit autonomy tiers. The audit log is also where the AI feedback loop draws signal.

## Decision
Every change to substrate state goes through the action layer. The action layer is application code in `packages/substrate`, not a database trigger.

An action is created before any substrate modification. The action row captures:
- `action_kind`: what kind of change this is (declared as data via `action_kind_definition`)
- `actor`: who is doing it (typed: human, integration, agent, system)
- `intent_kind`: why (correction, reflection, adjustment, override, exploration, enforcement, automatic_sync, unknown)
- `autonomy_tier`: under what oversight model (autonomous, notify, approve, suggest)
- `reasoning_trace_id`: link to a `reasoning_trace` if one applies
- `effects`: what rows the action created or modified (recorded after the fact)

Direct writes to substrate tables (entity, entity_attribute, relationship, event, judgment, outcome, identity_assertion, etc.) bypassing the action layer are forbidden in application code. This is enforced by:

1. RLS policies that allow writes only when a trusted action context is set
2. Code review and patterns
3. A future static check (lint or test) that flags direct DML on substrate tables

Workers and migrations are explicit exceptions, with their own audit conventions.

## Consequences

What's now easier:
- Audit. The action log is the single source of truth for "what happened."
- AI accountability. Agent actions carry reasoning and autonomy tier inline.
- Replay and reconstruction. Re-deriving substrate state from actions is possible.
- Governance enforcement. The action layer evaluates autonomy tier and can block writes that exceed authorization.

What's now harder:
- Every write incurs an action create. Action creation is fast (a single insert) but non-zero. Profiled and within budget.
- The action layer is a chokepoint. It must be performant and correct. Tests are extensive.
- Bulk operations need batched action handling. A single import of 10,000 rows is one logical action with 10,000 effects, not 10,000 actions.

## Alternatives considered

**Database triggers for audit.** Rejected: cannot capture intent, autonomy, or reasoning. Triggers see effects, not causes.

**Application-layer logging without enforcement.** Rejected: relies on developer discipline. A bypass somewhere in the codebase is undetectable until something breaks.

**Event sourcing as the only model (no current-state tables).** Considered: this is essentially what the event log already provides. We use both: events are the source of truth, current-state tables are derived. The action layer sits above both, generating events and triggering projections.

**Audit as an opt-in per table.** Rejected: opt-in audit is the wrong default for a substrate. Every change is auditable by construction.
