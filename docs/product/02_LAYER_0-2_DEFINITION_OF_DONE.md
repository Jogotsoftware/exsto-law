# Exsto Layer 0-2 Definition of Done

**The contract for what makes the substrate done. Customer-agnostic. Foundation-first.**

---

## Purpose of this document

This document specifies what gets built before any customer engagement. The substrate is Layer 0 (philosophical commitments), Layer 1 (the 23 invariants), and Layer 2 (the primitives). When all of this is in place, customer modules can be built on top without rebuild risk.

This document replaces the prior MVP scope doc, which assumed Idea Fund Partners as customer zero and scoped against a pipeline review workflow. The build sequence is now substrate first, dogfood second, customers after that. No customer-specific work appears in this scope.

The architecture document (ARCHITECTURE.md v2.0) governs *how* things are built. This document specifies *what* is built first. Together they define the substrate.

## Build order

1. Layer 0-2 to definition of done. This document.
2. Reference app. Personal task and notes app. Multi-user with the founder's fiancée. Daily use until it surfaces no new substrate gaps.
3. Customer engagements (Huber AR/credit modules, IFP, others). These happen in private forks. Customer-specific code lives in Layer 3 of the fork. Anything generalizable gets considered for upstream merge.
4. Layer 4 (visual configuration UI, configuration agent, agent-built UI surfaces). Built on a substrate that has been battle-tested in two customer verticals.

The substrate ships when it is done. No external deadline pressure on Layer 0-2.

## In scope for Layer 0-2

### Layer 0 commitments

Three commitments encoded structurally throughout the substrate:

1. **System of record.** Exsto holds what is true, when it became true, who said so, with what confidence. It does not edit history. It does not silently change. It does not hide what is known.
2. **Unified operational and judgmental data.** Operational state, communication, judgment, and outcomes live in the same substrate, modeled with the same primitives.
3. **Substrate-with-clients.** The substrate exposes itself through MCP. UIs, agents, integrations, future surfaces all plug in. The substrate persists. Clients evolve.

### Layer 1: all 23 invariants

Every invariant from ARCHITECTURE.md v2.0 is implemented and enforced from the first migration onward. None are deferred.

1. Tenancy with row-level security
2. Temporality with valid_from / valid_to / occurred_at / recorded_at
3. Time precision indicators
4. Stable identity via UUIDs and identity assertions
5. Provenance on every fact
6. Confidence on every fact
7. Knowability state on every attribute
8. Assertion polarity (positive, negative, absent)
9. Auditability via the action layer
10. Intent on every action
11. Reversibility paths declared per action kind
12. Schema-as-data (definition tables queryable like any other data)
13. Projection determinism from raw events to normalized state
14. Append-only event tables
15. Hybrid logical clocks for causal ordering
16. Read consistency model with session-level guarantees
17. Configuration version binding for in-flight operations
18. Cryptographic event chains (per-tenant configurable)
19. Causality as queryable graph
20. Reasoning capture for agent actions
21. Contestation tracking as first-class observation
22. Governance gradients (autonomous, notify, approve, suggest)
23. Extensibility via configuration data, not code changes

Each invariant has a test suite that fails when the invariant is violated. Each invariant has an ADR documenting why it exists and what it costs.

### Layer 2: the 7 core primitives plus their definition registries

Core primitives:

1. Entity
2. Attribute
3. Relationship
4. Event
5. Judgment
6. Outcome
7. Action

Each core primitive has a paired definition registry (entity_kind_definition, attribute_definition, relationship_kind_definition, event_kind_definition, judgment_definition, outcome_definition, action_kind_definition). The registries are how new kinds get added: insert a row, not a code change.

### Layer 2: additional primitives required for the substrate to function

Identity and ingestion primitives:

- identity_assertion
- source_record_link
- raw_event_log
- integration_mapping
- authoritative_source_designation
- conflict_resolution_rule

Workflow and governance primitives:

- workflow_definition
- workflow_instance
- trigger_definition
- notification_route_definition
- permission_scope_definition
- approval_request
- approval_response
- policy_definition

Temporal and structural primitives:

- period
- period_kind_definition
- hierarchy_definition
- hierarchy_membership
- collection_definition
- ownership_assignment
- role_definition
- role_assignment
- commitment
- communication_thread
- communication_message
- stakeholder_position

Document and content primitives:

- content_blob
- document_version

Configuration and capability primitives:

- configuration_change
- migration_job
- schema_migration
- system_capability_registry
- substrate_capability_metric (schema present, computation deferred)
- substrate_known_issue

Reasoning and verification primitives:

- reasoning_trace
- causal_claim
- fact_contestation
- access_log
- purpose_definition (schema present, enforcement deferred)

Action primitives:

- subscription
- actor
- actor_scope_assignment

### Worker runtime infrastructure

A general-purpose worker process runs from day one. It is what makes the substrate reactive without requiring synchronous request handling for everything.

Required:

- Job queue with at-least-once delivery
- Scheduler for time-based jobs (reminders, deadlines, scheduled re-projections)
- Handler registration interface (handlers register on startup; new handlers are code drops, not infrastructure changes)
- Retry with exponential backoff
- Dead-letter queue for permanently failing jobs
- Telemetry on job throughput, latency, and failure rates
- Tenant binding on every job execution (the worker sets `app.tenant_id` before any database operation)

Specific worker types (ingestion, identity resolution, notification dispatch) are not in scope for Layer 0-2. The runtime that will host them is.

### MCP server

The substrate exposes itself only through MCP. No REST API. No GraphQL. The MCP server is the canonical interface from day one.

Required tool categories at Layer 0-2 done:

- Read tools for entities, attributes, relationships, events, judgments, outcomes, communication threads, documents, definition registry contents
- Write tools that route through the action layer (every write becomes an action with intent, autonomy tier, and reasoning capture)
- Capability tools (return what entity kinds, attribute kinds, relationship kinds, action kinds, workflow definitions exist for the current tenant)
- Search tools (hybrid keyword plus structured filter; vector search added when content blob volume justifies it)
- Configuration tools (add custom fields, define new entity kinds, author rubrics, manage permission scopes; consumed by the Layer 4 configuration agent later)

Authentication via tenant-scoped tokens. All operations respect permission_scope and governance gradient.

### Performance budget

50 milliseconds per primitive operation at the substrate layer, measured under no contention. Profiled from day one. The budget exists because the eventual product (Figma-vibe AI-native business software) requires it. A 200ms substrate cannot become a fast product.

### Observability

From day one:

- Structured logging with tenant context
- OpenTelemetry traces for substrate operations and worker job execution
- Metrics on action volume, projection lag, MCP tool latency, worker queue depth

## The reference app

> **Amended by ADR 0042 (2026-06-09): Huber is the proof-of-life vertical and
> replaces the generic task/notes reference app.** The substrate is now proven
> independently (clone test + 33/33 invariant suite + adversarial audit —
> `docs/FOUNDATION_CERTIFICATION.md`), and a real vertical (Huber AR/credit) carries
> the dogfood obligations below in real multi-user use, in a private Layer-3 fork.
> The generic task/notes app described here is no longer a gate; the spec is kept
> as the canonical list of dogfood obligations that transfer to Huber. See ADR
> 0042 for the rationale and the obligation that Huber must not pull substrate
> changes upstream to make a feature work.

The reference app is the dogfood and the smoke test. It is not for any external customer. Its job is to exercise every primitive and every invariant in real, daily use.

### Reference app spec

A multi-user task and notes app. Founder plus fiancée plus a few invited users to exercise multi-tenant boundaries.

Surfaces required:

- Authentication (Google SSO via Supabase Auth)
- Workspace switching (multi-tenant test path)
- Task list with create, edit, complete, delete, all routed through the action layer
- Note authoring with version history
- Reminders (proves the worker runtime fires time-based jobs)
- Sharing (proves role assignment, ownership assignment, permission scope)
- Activity feed (proves access log and the audit trail are queryable surfaces)
- Disagreement flow (two users contest a fact; proves contestation is first-class)
- Chat surface backed by the MCP server (the dogfood for MCP itself)
- AI feedback flow (mark a Claude chat response as helpful, wrong, or wrong-because. Marking creates a judgment about the AI's suggestion. Marking wrong creates a `fact_contestation` if the suggestion conflicted with an existing fact. The reasoning trace behind every AI suggestion is viewable on demand from the chat surface, exposing what the AI considered and why.)

### What the reference app must exercise

The reference app proves the substrate works by using every layer 1 invariant and every core primitive in normal operation:

- Tenancy: data isolation between users in different workspaces
- Temporality and time precision: tasks have due dates with day or hour precision; activity feed shows what was true when
- Identity: a user's identity is stable across email changes and merges
- Provenance: every fact in the activity feed carries who created it and when
- Confidence: AI-suggested tags carry confidence scores; manual tags are 1.0
- Knowability: a task with no due date shows "no due date set" distinctly from "due date unknown"
- Assertion polarity: marking a task as explicitly not blocked is distinct from no blocked information
- Auditability: every change appears in the activity feed
- Intent: editing a task title because of a typo is distinct from editing because of scope change
- Reversibility: undo works for every action that admits a reversal
- Schema-as-data: founder adds a custom field to tasks at runtime without a migration
- Projection determinism: rebuilding the activity feed from raw events produces the same feed
- Append-only events: edits do not destroy prior values
- HLC: ordering of concurrent edits is deterministic
- Read consistency: a user who just wrote a task sees it immediately
- Configuration version binding: a workflow in flight uses the rules it started with even after the rules change
- Hash chain: tampering with the activity feed in the database is detectable
- Causality: a reminder firing causes a notification, both linked
- Reasoning capture: AI-suggested tags include the reasoning behind the suggestion, surfaced in the chat surface on demand (the user can ask "why did you suggest this?" and see evidence and alternatives the AI considered)
- Contestation: two users disagreeing on a task's status is captured, not silently resolved; AI suggestions marked wrong by users create contestations linked back to the reasoning trace
- Governance gradients: AI can autonomously suggest tags, must notify on edits, must request approval on deletes
- Extensibility: founder adds a "priority" attribute kind to tasks at runtime through the configuration interface
- AI effectiveness as derived property: a query like "what fraction of Claude's suggestions in the past week were marked helpful by the user" returns a meaningful answer using only the existing primitives (`reasoning_trace`, `judgment`, `fact_contestation`, `outcome`), with no separate evaluation system. See ADR 0028.

### Definition of reference app done

- All surfaces above are functional
- Founder uses the app daily for 3 weeks minimum without finding a substrate gap that requires Layer 1 or core primitive changes
- Multi-user operation has been exercised (at least one second user, ideally with a contested fact resolved)
- The MCP server has been used as the chat surface for at least 30 substantive queries

## Out of scope for Layer 0-2

Nothing customer-specific. Anything below gets built later, against the substrate, without modifying the substrate.

- Specific ingestion adapters (Affinity, Salesforce, Gmail, Slack, Calendar, Grain, Fireflies, Crunchbase, Pitchbook, NetSuite, Oracle, etc.)
- Specific identity resolution algorithms beyond the schema and the deterministic email-and-domain matchers needed for the reference app
- Pipeline review workflow
- Dunning workflow
- Cash application workflow
- Any other customer-specific workflow
- Visual configuration UIs beyond what the reference app needs to prove configuration works (these are Layer 4)
- Configuration agent (Layer 4)
- Visual workflow editor (Layer 4)
- Native mobile apps (Layer 4 or later)
- Open source release (Layer 4 or later)
- Federation between substrates (Layer 4 or later)
- Multi-currency operation (schema present from day one; active operation deferred until a customer needs it)
- Cryptographic event chain signature verification (schema and hashing present; signature verification per-tenant opt-in, off by default)
- Salience mechanisms
- Hypothetical branched state (counterfactual modeling)

## Definition of done

Layer 0-2 is done when all of the following are true. Every item is binary. No partials.

1. **All 23 invariants implemented and tested.** Each invariant has at least one test that fails when the invariant is violated. The test suite passes in CI on every commit.

2. **All 7 core primitives plus their definition registries authored and working.** Every core primitive obeys every invariant.

3. **All additional Layer 2 primitives listed above authored.** Even those whose enforcement is deferred (substrate_capability_metric, purpose_definition) have schema and ingest paths ready.

4. **Schema-as-data is real.** Adding an attribute kind to an existing entity kind at runtime through the configuration interface preserves all 23 invariants. Existing entities remain queryable. The new attribute appears in MCP capability output immediately.

5. **MCP server exposes every substrate operation natively.** Adding a new substrate operation makes it a new MCP tool without separate wrapper code. The MCP server is the primary interface, not a wrapper over a REST API.

6. **Worker runtime is operational.** Job queue, scheduler, retry, dead-letter, telemetry, tenant binding all work. A reminder scheduled in the reference app fires at the right time. A handler can be registered without changing the runtime.

7. **The proof-of-life vertical runs end-to-end on the substrate.** Multi-user, real daily use. Exercises every invariant and every core primitive in normal operation. **Per ADR 0042 this is Huber (AR/credit), not a generic task/notes app** — Huber carries the dogfood obligations in a private Layer-3 fork, on the same customer-agnostic substrate.

8. **Performance budget met.** Substrate operations under 50ms at the median, profiled and graphed in observability tooling.

9. **No tech debt against the eventual Layer 4 vision.** Every architectural decision passes the test "would this same decision be made for any future tenant in any vertical?" If no, the decision is rejected and revisited.

If any of those nine is not true, Layer 0-2 is not done. Customer engagements wait.

## Success signals beyond definition of done

These are not gates. They are evidence that the substrate is ready for customers.

- A new entity kind can be added end-to-end (definition row, MCP tools available, reference app surface, governance configured) in under an hour
- A new MCP tool can be added in under thirty minutes following the pattern doc
- A new worker handler can be registered in under thirty minutes
- The founder can answer "where did this fact come from" for any value in the reference app in one query
- The founder can answer "what would have changed if this rule had been different" for any contested fact in the reference app
- The founder can run a query that shows AI effectiveness over a chosen time window (acceptance rate, contestation rate, calibration) without any separate analytics tooling, using only substrate primitives

## What this document is not

It is not the architecture. ARCHITECTURE.md governs the substrate's nature.

It is not a roadmap. The roadmap covers Layer 4 phases.

It is not a sales document. It is internal contract.

It is not a customer specification. Customer-specific scope documents live in customer-fork repos, not upstream.

It is not negotiable on Layer 1. The 23 invariants ship in v1. Scope cuts come from feature additions or deferred Layer 4 work, never from Layer 1.
