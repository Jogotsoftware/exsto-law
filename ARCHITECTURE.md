# Exsto Architecture v2.0

**Operating document for the founder. The constitutional reference for every decision made about the substrate from this point forward.**

---

## Layer 0: What this system is

Exsto is a system of record. Not a system of opinion, not a tool that produces analysis, not a workflow engine. A system of record. Its job is to hold what is true, what was true, what is believed, who believes it, with what confidence, when it was learned, where it came from. The substrate does not have its own opinions. It does not edit history. It does not silently change. It does not hide what's known. Trust in the substrate comes from this commitment being absolute.

Exsto unifies operational and judgmental data. Most enterprise systems separate operational state (CRM, ERP) from analytical state (warehouse, BI) from communication (email, Slack) from human judgment (notes, opinions). Exsto refuses this separation. Operational state, communication, judgment, and outcomes all live in the same substrate, modeled with the same primitives. This is the architectural choice that makes AI agents able to reason across the full context of a business, rather than from one sliced view of it.

Exsto is substrate-with-clients, not application-with-database. Clients never touch the substrate tables directly; they reach it through one **operation core** — the action and query layer that enforces tenancy, append-only history, provenance, and reasoning capture — and that core is exposed through sibling adapters. MCP is the primary adapter; a REST/OpenAPI adapter is permitted as a thin sibling over the same core, never as a parallel layer with its own SQL (ADR 0024, ADR 0038). AI clients, UI surfaces, integrations, future agents we have not anticipated, all plug in. The substrate is not coupled to any specific client, protocol, model vendor, UI framework, or workflow engine. The substrate persists. Clients evolve.

These three commitments are the system's nature. Every architectural decision below serves them.

## Layer 1: How everything works

Twenty-three invariants govern every primitive in the substrate. These are not features. They are properties that every fact, every event, every operation in the substrate inherits. Violating any of them is a foundational bug.

**1. Tenancy.** Every row in every table has a tenant_id. Every query is scoped to a tenant. Row-level security at the database layer enforces it. There is no "global" data. There is no cross-tenant view except through deliberate, separately-governed pathways.

**2. Temporality.** Every fact has a time. State that has duration uses valid_from and valid_to. Events use occurred_at and recorded_at. Nothing exists outside time. Nothing overwrites. Nothing is just "current" without "and was previously something else."

**3. Time precision.** Every temporal value carries an explicit precision indicator: exact_instant, second, minute, hour, day, week, month, quarter, year, range, approximate, or unknown. The substrate distinguishes "Q3 2024" from "September 15, 2024" structurally. Agents reasoning about timing must respect precision.

**4. Identity.** Everything has a UUID. Identities are stable across schema migrations, tenant changes, mergers, and renamings. The identity of a thing is independent of its current state, name, or attributes. Identity assertions link records that refer to the same entity; merges are non-destructive.

**5. Provenance.** Every fact has a source. Every value knows where it came from: source system, source record, ingestion job, or asserting actor. Provenance is structurally enforced at write time, not policy-suggested. Facts without provenance cannot enter the substrate.

**6. Confidence.** Every fact has a confidence score from 0.0 to 1.0. Most directly observed facts are 1.0. Inferred, partial, or contested facts are less. The substrate handles uncertainty as a first-class property. Queries return confidence alongside values.

**7. Knowability.** Every attribute observation carries an explicit knowability state: observed, observed_null, never_observed, withheld, inapplicable, pending, stale, or computation_failed. The substrate distinguishes "we don't know" from "we know there's nothing" from "we're not allowed to see this." Agents querying receive knowability state alongside values.

**8. Assertion polarity.** Facts can be positive (X is true) or negative (X is not true, or no X exists). Negative facts are first-class, not just absences. The substrate can record "this deal has no champion" as a positive assertion, distinct from "we don't know if this deal has a champion."

**9. Auditability.** Every change has an action_id pointing to who took the action, when, why, and through what authorization. The audit trail is the structural consequence of how writes happen. There is no write path that bypasses the action layer.

**10. Intent.** Every action carries structured intent: correction, reflection, adjustment, override, exploration, enforcement, automatic_sync, or unknown. Intent distinguishes "the rep updated the amount because they made an error" from "the rep updated the amount because of a renegotiation."

**11. Reversibility.** Every operation has a path back. Most are directly reversible. Some require explicit reversal operations (unmerging an identity, restating a closed period). A few are gated as effectively-irreversible (period close after audit, certain destructive operations with explicit consent). The substrate's default is "this can be undone."

**12. Schema-as-data.** The schema itself is queryable. Entity kinds, attribute definitions, relationship kinds, workflow definitions, and permission scopes are all rows in tables. The system can introspect itself. There is no "code that knows the schema" separate from "data describing the schema."

**13. Projection determinism.** Projections from raw_event_log to normalized state are deterministic. Given the same raw events and the same mapping rules, the same normalized state emerges. No randomness, no current-time dependencies, no external lookups in projection logic. This is what makes replay possible, migration tractable, and audit trustworthy.

**14. Append-only events.** Events are immutable. Once recorded, they don't change. Corrections are new events that reference what they correct, not edits to old events. Event tables have no UPDATE or DELETE in normal operation; only INSERT.

**15. Hybrid logical clocks.** Every event and fact carries a hybrid logical clock value combining wall-clock time with a logical counter. This guarantees causally-related events are ordered correctly even when wall-clock time is imprecise across distributed writes.

**16. Read consistency.** Query sessions specify consistency requirements. The substrate guarantees read-your-writes plus monotonic reads as defaults: an agent that wrote a fact sees that fact in subsequent reads, and reads in a session never go backward in time. Strong and snapshot consistency available when explicitly requested.

**17. Configuration version binding.** Operations bind to configuration versions at start. In-flight operations complete with their bound configuration version while new operations get the current version. Configuration changes do not race with running processes.

**18. Cryptographic event chains.** Events are hash-chained. Each event's content_hash includes the hash of the prior event in its chain. Tamper-evidence is structural. Per-tenant configurable; signatures optional but supported for high-stakes events.

**19. Causality as queryable graph.** Causal claims are first-class facts. "Actor A claims event X caused outcome Y" is a row in causal_claim, with its own provenance and confidence. The substrate supports navigating causal graphs for explanation and counterfactual reasoning.

**20. Reasoning capture.** When agents take actions, their reasoning is captured structurally: evidence considered, alternatives evaluated, conclusion selected, confidence in conclusion. Reasoning is queryable, auditable, and accumulates as substrate intelligence over time.

**21. Contestation tracking.** When facts conflict, the conflict itself is a first-class observation. Contestations have status (active, acknowledged, adjudicated, resolved) and resolution attribution. Agents querying potentially-conflicting data see the contestation state alongside the data.

**22. Governance gradients.** Every action has an autonomy tier (autonomous, notify, approve, suggest). Every action_kind has a default tier. Every actor has scopes. Every operation passes through governance. The four-tier system is structurally enforced, not policy-applied.

**23. Extensibility.** The substrate supports adding new entity_kinds, new attribute_kinds, new relationship_kinds, new workflows, new permission scopes, and new integration mappings without code changes. Customers extend the substrate to their domain through configuration. The substrate's value as a substrate depends on this property being absolute.

These twenty-three invariants are the substrate's foundation. They cannot be violated. They cannot be added later without rebuilding. They are what every primitive inherits.

## Layer 2: The primitives

The substrate models reality through a small set of primitive concepts. Each primitive obeys all twenty-three layer 1 invariants. Primitives compose to express any business reality customers need to model.

### Core primitives

**Entity.** Anything that persists. Customers, deals, contacts, companies, projects, documents, periods, anything. An entity has a stable id, a kind that can change over time (entity_kind_assignment), and attributes. Entities are the nouns of the substrate.

**Entity kind definition.** The schema for an entity kind. System-defined kinds (deal, account, contact, person, period, document, location) ship with the substrate. Tenant-defined kinds extend it. Kinds inherit from parent kinds. Kinds carry capability flags indicating what behaviors apply (supports_temporal_state, supports_judgment, supports_outcomes, requires_period).

**Attribute.** A typed value about an entity, with provenance, confidence, knowability, and validity period. Stored as entity_attribute rows. Each attribute references its definition (attribute_definition) which specifies type, validation, defaults, and constraints. Attributes are append-only with valid_to closing prior values when new ones are written.

**Attribute definition.** The schema for an attribute kind on an entity kind. Specifies type (text, number, boolean, date, datetime, enum, reference, json, money, computed), validation, requirements, indexing, PII status, and (if computed) the computation specification. Tenant-scoped; tenants can extend system-defined attributes with their own.

**Relationship.** A connection between two entities, typed by relationship_kind, with temporal validity and provenance. Relationships are first-class facts, not just foreign keys. They carry the same invariants as attributes.

**Relationship kind definition.** The schema for a relationship type: source kind, target kind, cardinality, directionality, optional inverse. Tenant-extensible.

**Event.** Something that happened. Events have an event_kind, a primary entity, secondary entities, payload, occurred_at and recorded_at times with precision, hybrid logical clock, source attribution, and a hash chain for tamper evidence. Events are immutable.

**Event kind definition.** The schema for an event type: payload structure, primary and secondary entity expectations, whether this event represents a state change or pure observation, immutability tier.

**Judgment.** Human or agent qualitative assessment about an entity. Has a judgment_kind, value typed by the kind, confidence, judging actor, supporting evidence (event references), reasoning, and decay function. Judgments are temporal and superseded rather than overwritten.

**Judgment kind definition.** The schema for a judgment type: about which entity kind, value type (rating, enum, text, structured), decay function, half-life.

**Outcome.** A realized result for an entity, with kind, occurred_at, structured outcome data, and asserted causal links to predicting events and judgments. Outcomes are how the substrate captures the validation signal that makes it valuable for AI.

**Outcome kind definition.** The schema for an outcome type: about which entity kind, polarity, terminal status, required outcome data fields.

**Action.** Every change to the substrate. Has an action_kind, performing actor, intent, reasoning trace reference, autonomy tier at execution time, target entities, and effects. Actions are the universal audit trail. Every write is an action.

**Action kind definition.** The schema for an action type: default autonomy tier, affected entity and attribute kinds, reversibility, reverse action kind, required evidence, authorization scopes.

**Actor.** Who or what performs actions. Kind: human_user, system, agent, integration, external_human. Actors have capability scopes, identifiers in external systems, and active/inactive status with effective dates.

**Period.** A time interval with kind, start and end dates, parent period (for hierarchies), and status (open, closed, restated). Financial entities reference periods explicitly. Period close is an explicit gating mechanism.

**Period kind definition.** The schema for a period type: calendar quarter, fiscal year, monthly close, sales period, custom. Includes fiscal year start month and applicable entity kinds.

### Identity and ingestion primitives

**Identity assertion.** A fact that two entities are the same (or different, or related). Has assertion kind (same_as, different_from, related_to), confidence, evidence, asserter, and supersession. Identity is managed through assertions, not destructive merges.

**Source record link.** Tracks every external record's link to its canonical entity, with status (active, disconnected, deleted_in_source). Persists forever. Survives integration disconnection. Enables cross-system reconciliation through tech stack changes.

**Raw event log.** Append-only, immutable, schemaless storage for every API response and inbound payload received. The substrate's bedrock. Projection workers derive normalized state from raw events. Re-projection from raw events is always possible.

**Integration mapping.** Versioned, time-bounded rules for translating source schemas to canonical schemas. Per-tenant, per-source-field. Includes transformations declared in a constrained DSL. Identifies which fields are identity anchors, relationship anchors, or contain PII.

**Authoritative source designation.** For attribute kinds, scoped to filters, declares which source system is canonical for which entities under which conditions. Resolves cross-system conflicts deterministically.

**Conflict resolution rule.** Per attribute kind, specifies how to handle write conflicts: source priority order, human override windows, conflict strategies. Configuration data, not code.

### Workflow and governance primitives

**Workflow definition.** A bounded state machine: states, transitions, conditions on transitions, actions on state entry, participating entity kinds, state ownership by permission scope. Versioned, instance-bound at workflow start.

**Workflow instance.** A specific in-flight workflow against specific entities. References its bound workflow_definition version. Tracks current state, history of transitions, and outstanding actions.

**Trigger definition.** Declarative rules: event kind plus filter expression produces an action proposal. Autonomy tier overrides allowed. Triggers are configuration data; no code changes required to add or modify.

**Notification route definition.** Declarative routing of triggered notifications to recipients via specified channels using specified templates. Configuration data.

**Permission scope definition.** Named collections of permissions: which action kinds, which entity kinds, which attribute kinds, with optional row-level filter expressions. Scopes are configuration data. Scopes assigned to actors via actor_scope_assignment with temporal validity.

**Approval request.** Multi-actor, multi-step approval lifecycle distinct from single-action governance. Has approval logic (all, any, majority, sequential), required approvers, current status, expiration, and resolution. Approval responses are individual records.

**Policy definition.** Versioned rules with explicit binding strategy (at_start, at_evaluation, always_current). In-flight processes bind to policy versions; new processes get current versions. Policies cover expense rules, approval matrices, pricing, commissions, access rules.

### Temporal and structural primitives

**Hierarchy definition.** Named hierarchies (reporting, cost_center, geography, project_breakdown). Multiple hierarchies per entity kind allowed. Hierarchies are first-class, not parent_id columns.

**Hierarchy membership.** An entity's position in a specific hierarchy at a specific time. Same entity can occupy different positions in different hierarchies simultaneously.

**Collection definition.** Sets of entities with identity. Static (explicit membership) or dynamic (criteria-based). Cohorts, segments, watchlists. Collections can have their own attributes and relationships.

**Ownership assignment.** Which actor owns which entity, with kind (primary, secondary, reviewer, approver_for) and temporal validity. Distinct from role assignment (job role) and permission scope (authorization). Captures specific accountability for specific entities.

**Role definition and role assignment.** Roles are named positions with default permission scopes. Role assignments tie persons to roles in organizational units, with reporting relationships and temporal validity. Captures the lifecycle of human positions in organizations.

**Commitment.** A time-bound obligation: SLA, milestone, deadline, promise. Has due_at, threshold_at (for early warning), fulfilled_at, breach status, and consequences on breach. Enables proactive management of future obligations.

**Communication thread.** A series of related messages between actors about entities. Threads have kind (email, slack, sms, call_series, meeting_series), participants, related entities, and lifecycle status. Messages are events that reference threads.

**Stakeholder position.** Structured capture of a stakeholder's role and position on a decision: champion, economic_buyer, influencer, blocker, neutral, with stance (strongly_favorable through opposed) and influence estimate. Specific enough to deserve its own primitive over generic judgments.

### Document and content primitives

**Content blob.** Content-addressed storage. Hash-identified, deduplicated, versioned. Contains the actual bytes of documents, attachments, exports.

**Document version.** A specific version of a document entity, referencing a content blob, with version number, currency status, change summary, and authorship. Document version history is queryable and immutable.

### Configuration and capability primitives

**Configuration change.** Every configuration modification is a first-class auditable record. Captures before value, after value, change reason, blast radius (how many entities affected), reversal status, and authoring actor. Configuration history is queryable.

**Migration job.** Schema and data migrations as first-class operations. Captures kind (schema evolution, tech stack change, reclassification, data correction), affected entity kinds, status lifecycle, and reversal plan.

**Schema migration.** Specific event log for canonical schema changes: when an entity kind, attribute kind, or relationship kind was added, modified, or deprecated. Enables answering "when did this attribute exist" historically.

**System capability registry.** Materialized snapshot of what the substrate currently supports for a tenant: all entity kinds, attribute definitions, relationship kinds, action kinds, workflow definitions, integrations. Single source of truth for any client (UI, agent, external) asking "what's possible right now?"

**Substrate capability metric.** Quality, coverage, freshness, and consistency metrics queryable as data. Schema present from v1; computation deferred until customer use cases require.

**Substrate known issue.** Manually or automatically flagged data quality concerns: scope, severity, detection time, resolution status. Enables agents to hedge appropriately when querying affected domains.

### Reasoning and verification primitives

**Reasoning trace.** When agents take actions, their reasoning is captured: prompt, evidence considered, alternatives evaluated, selected conclusion, confidence, summary. Linked to the action it produced. Reviewable by humans, queryable for analysis, learnable from over time.

**Causal claim.** Asserted causal relationships between events, actions, judgments, and outcomes. Has cause and effect entities, claim kind (necessary, sufficient, contributing, preventing, enabling), asserter, confidence, reasoning, and supporting evidence. The substrate's structured causality graph.

**Fact contestation.** Conflicts between facts as first-class observations. Contesting facts identified, contestation kind (value, temporal, identity), status (active through resolved), resolution attribution. Detected automatically at ingestion when conflicts arise; resolved through review queue or rule-based logic.

**Access log.** Read-side audit. Every query that touches data records who accessed what, with what authorization, for what purpose. Voluminous; partitioned and compressed. Required for compliance in regulated industries.

**Purpose definition.** Declared purposes for data access (compliance review, customer service, analytics, agent task). Schema present in v1; enforcement deferred until specific compliance use cases require.

### Action primitives

**Subscription.** An actor's expressed interest in being notified about specific events affecting specific entities. Configuration data. Distinct from notification routing (which is rule-based system response) and from access logs (which is post-hoc).

This is the complete layer 2 primitive set. Roughly 40 primitives. Each obeys the 23 layer 1 invariants. Customers extend the substrate by defining new entity kinds, attribute kinds, and relationship kinds, all as configuration data within the existing primitive structure. New domains (inventory, manufacturing, field service, logistics, healthcare, and beyond) get added by composing primitives, not by changing the substrate.

## Layer 3: Compositions

Compositions are how primitives combine to express specific business concepts. These are not architectural commitments; they are how customers configure the substrate for their domain. Compositions are tenant-scoped, configurable, and freely changeable.

A "deal" is an entity with kind=deal, with attributes for stage, amount, expected close date, and others, related to a primary contact, an account, and a salesperson, with judgments about champion strength and deal health, with outcomes for closed_won or closed_lost, with stakeholder positions for each contact involved, with workflow instances for stage transitions, and with rubric evaluations gating those transitions.

A "purchase order" is an entity with kind=purchase_order, with attributes for amount, vendor, delivery date, and line items, related to a requesting employee, a vendor account, and an approving manager, with an approval request, a workflow for processing, and a linked encumbrance against the relevant budget.

A "patient" is an entity with kind=patient (defined by a healthcare-vertical tenant), with attributes for medical record number, demographics, and current care plan, with relationships to providers and care episodes, with classifications for PHI, with workflows for care coordination, and with outcomes for treatment results.

The substrate's value is that all of these compositions use the same primitives, obey the same invariants, and can be reasoned over by the same MCP-exposed tools. An agent that understands the substrate's primitives can operate in any domain a customer configures.

## Layer 4: Features

Features are what customers experience: the visual configuration UI, the workspace UI, the configuration agent, integrations, dashboards, agents. Features are built on compositions, which use primitives, which obey invariants, which serve the system's nature.

Features are constantly changing. The architecture below them is not.

## Operating principles

These principles guide every decision when the architecture document doesn't directly specify what to do.

**The foundation is sacred. The features are iterative.** If a decision affects layer 0, layer 1, or core layer 2 primitives, it gets thorough review. If it affects features, it ships and iterates.

**Configurability is a property of the data model. Configuration UIs are deferred per criterion.** Customers must always be able to configure the substrate. Whether they configure through visual UIs, JSON files, or AI agents is a feature decision that evolves over time.

**Stay general where the future is uncertain. Be specific where the present is clear.** New entity kinds and attribute kinds are added as needed. Workflow definitions are authored as customer needs surface. The substrate's primitives stay stable.

**Architecturally committed from day one. Built incrementally as we earn the right.** Every layer 1 invariant is in v1. Most layer 2 primitives are in v1. Some primitives are documented but deferred until customer need surfaces. The schema commitments protect the future without forcing premature implementation.

**No shortcuts on layer 1.** Provenance, temporality, source attribution, governance, these never get skipped to ship faster. Shipping faster by skipping layer 1 produces a product that cannot become what Exsto is meant to be.

## What is not in this architecture

Several things customers and engineers might expect to find are deliberately absent. Their absence is intentional.

**Specific feature implementations.** The visual configuration UI, the workspace UI, the configuration agent, the dashboard builder, these are features, not architecture. They are designed and built as separate work, with reference to this document.

**Domain-specific primitives for verticals beyond v1.** Inventory tracking, manufacturing primitives, field service primitives, healthcare-specific primitives, financial accounting depth beyond what v1 needs, these are documented as architectural commitments where they affect schema decisions, and otherwise added as new entity kinds and attribute kinds when customer demand surfaces them.

**Specific integrations beyond the v1 set.** The architecture supports adding any integration. Specific integrations for v1 and later phases are work items, not architecture.

**Performance optimizations.** Indexes, caching strategies, projection materialization, query plan tuning, these are operational concerns that get addressed as scale demands them. The architecture preserves the option to optimize without requiring premature optimization.

**Specific model vendor choices for AI components.** The substrate exposes one operation core through its adapters (MCP, and REST/OpenAPI as a sibling). Whichever models and clients connect through those adapters is independent of substrate architecture.

## Lockdown

This architecture is locked at v2.0 as of this writing. Future revisions follow a versioning discipline:

- Patch revisions (v2.0.1) for clarification and error correction
- Minor revisions (v2.1) for layer 2 primitive additions that arise from customer need
- Major revisions (v3.0) only if a layer 1 invariant changes, which should be near-impossible

The substrate is what this document describes. Construction follows.
