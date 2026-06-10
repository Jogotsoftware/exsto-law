# ADR 0022: Governance gradients control AI autonomy

## Status
Accepted

## Context
AI agents will be acting on the substrate. Some actions are safe to take autonomously (suggest a tag). Others require notifying a human after the fact (edit a deal's stage). Others require approval before action (delete an entity). Others can only be proposed, requiring a human to enact (send an external email).

Without an explicit autonomy model, the choice between autonomous and supervised action is buried in code. Adding a new agent or a new action requires reasoning about authorization from scratch each time.

For Exsto, autonomy needs to be configurable per tenant, per actor, per action kind. A VC firm may want their AI to autonomously update internal notes but require approval for any external communication. A different tenant may have different preferences.

## Decision
Every action has an `autonomy_tier`. The set:

- `autonomous`: the actor can take the action without notification or approval
- `notify`: the actor takes the action but the relevant humans are notified after
- `approve`: the actor must request approval before the action can take effect
- `suggest`: the actor can only propose; a human must enact

Autonomy tier is determined per `(actor, action_kind, tenant)`. The default tier is configured per `action_kind_definition`. Per-actor overrides allow specific agents to have higher or lower autonomy than the default.

The action layer evaluates autonomy at action submission. Actions at `autonomous` tier proceed. Actions at `notify` tier proceed and emit notifications. Actions at `approve` tier create an `approval_request` and pause; on approval, the action proceeds. Actions at `suggest` tier create a suggestion record and stop; a human must enact via a separate action.

Autonomy tiers are queryable. "Show me all actions taken autonomously by agent X" is a query. "Show me all approvals pending" is a query.

Tier escalation: an autonomous-tier action that hits an unexpected condition (low confidence, contested input) can escalate itself to a higher tier ("I would normally do this autonomously, but I want approval here because of X").

## Consequences

What's now easier:
- AI safety. Autonomy is structural, not implicit.
- Configuration. Tenants control how their agents behave.
- Audit. Every action's autonomy tier is recorded, enabling "what did agents do without oversight" queries.

What's now harder:
- Every action_kind requires an autonomy default. The action layer enforces this.
- Approval workflows have UI requirements. Surfaces for "review pending approvals" exist by Layer 0-2 done.
- Tier conflicts (an actor's override conflicts with a tenant's policy) need resolution rules. Default is the more restrictive tier wins.

## Alternatives considered

**Boolean autonomy (autonomous yes or no).** Rejected: too coarse. The four tiers track real distinctions.

**Per-action manual decisions.** Rejected: doesn't scale. Defaults per action_kind with overrides is the right shape.

**Authorization as RBAC.** Rejected: RBAC handles "can this actor do this thing." Autonomy tier handles "under what oversight model." They are orthogonal: an actor authorized to do something might still need approval.

**Autonomy decided by AI agent itself.** Considered. An agent could choose its own tier based on confidence. This is what tier escalation supports, but the default tier is set by configuration so a buggy agent cannot grant itself autonomy.
