# Concepts to study

A running glossary of technical concepts that come up while building Exsto. Each entry is written in plain language. The goal is for Joe to be able to skim this document and understand what every term in his own codebase means.

How to use this doc:

- When you encounter a term you don't fully understand, check here first.
- When a new concept comes up that you want to learn, add a stub here and Claude (or you) will fill it in.
- Skim it once a week. The terms you are most fuzzy on are the ones to study next.

The order is rough categories: build tooling, then language and runtime, then database, then substrate-specific concepts, then AI-specific concepts. New entries get added at the bottom of the relevant section.

---

## Build and developer tooling

### Monorepo

A single repository (one Git project, one folder structure) that contains multiple software packages instead of one. Exsto is a monorepo because the substrate, the primitives, the MCP server, the worker runtime, and the reference app all share types and break each other when one changes. Keeping them in one place means a change to a type used in five places gets caught immediately.

The opposite is a "polyrepo" setup where each package is its own repo. That works for things that are loosely coupled but creates pain when changes need to ripple across packages.

Why it matters for Exsto: it lets the reference app share TypeScript types with the substrate, so when a new primitive is added, the reference app's compile errors point straight at the places that need to be updated.

### pnpm

A package manager for Node.js, like npm or yarn. It does the same job (installs the libraries your code depends on) but does it faster and uses much less disk space. It also catches a class of bugs that npm misses, where a package can accidentally use a library it didn't actually declare it depends on.

Why we use it: monorepos have a lot of shared dependencies, and pnpm handles that gracefully.

To learn more: https://pnpm.io/motivation

### Workspaces

A feature of pnpm (and npm and yarn) for managing multiple packages in one repo. Workspaces let one package depend on another in the same repo without publishing it. So `apps/reference` can `import` from `packages/substrate` directly, even though `packages/substrate` is not on npm.

### TypeScript

A programming language that adds types to JavaScript. JavaScript will let you call `add(5, "hello")` and crash at runtime; TypeScript will refuse to compile that code, telling you the second argument should be a number. Most of Exsto is written in TypeScript.

Why it matters: when an architecture has 23 invariants and ~40 primitives, types are how you stop yourself from accidentally violating them.

### Node.js

The runtime that executes JavaScript and TypeScript code on a server (as opposed to in a web browser). Exsto's MCP server, the worker runtime, and Next.js itself all run on Node.

### Next.js

A framework for building web applications with React. Handles routing, server-side rendering, and a bunch of other plumbing that you would otherwise have to build yourself. The reference app is built with Next.js.

### React

A JavaScript library for building user interfaces. The reference app's UI is React components.

### ESLint, Prettier

Tools that check your code style and format it automatically. ESLint catches likely bugs and style violations. Prettier makes everything format the same way so you don't argue about whitespace.

### Vitest

A test framework. You write tests; Vitest runs them and tells you which passed and which failed. It is the modern, fast alternative to the old standby Jest.

### CI (continuous integration)

A system that automatically runs your tests every time you push code to GitHub. If the tests fail, the CI marks the commit red, and you know not to merge it. GitHub Actions is the most common CI provider; we will use that.

### git, branches, commits, pull requests

Git is the version control system that tracks every change to the code. Concepts:

- A **commit** is a saved snapshot of changes with a message describing them.
- A **branch** is a parallel line of development. You make changes on a branch without affecting the main code.
- A **pull request (PR)** is a proposal to merge a branch into the main branch. Reviewers comment, you adjust, and once approved, the branch gets merged.
- The **main branch** is the production-ready version of the code.

Day-to-day: you make a branch, make changes, commit, push the branch to GitHub, open a PR, get reviewed, merge.

### Worktrees

A git feature that lets you have multiple branches checked out at the same time in different folders. Useful when you want to keep a long-running task running in one branch while you fix something on another. The Superpowers plugin uses worktrees heavily.

### .gitignore

A file that tells git which files to never track. Examples: build output, environment variables (which contain secrets), the giant `node_modules` folder. Anything in `.gitignore` is invisible to git.

---

## Database concepts

### Postgres (also called PostgreSQL)

The database that Exsto runs on. Postgres is a relational database, meaning data is organized into tables with rows and columns. It has been the default open-source database for serious software for decades because it is reliable, fast, and supports advanced features (like JSON columns, full-text search, and the row-level security feature we depend on for multi-tenancy).

### Supabase

A hosted Postgres provider that also bundles useful tools around it: authentication, file storage, real-time subscriptions, and a nice admin UI. We use Supabase because it gives us a managed Postgres without us having to run our own database server, and because its row-level security model is exactly what we need for multi-tenancy.

### Migration

A change to the database structure, written as SQL and saved as a file in `supabase/migrations/`. Migrations run in order. Once a migration is merged to the main branch, it is never modified, only added to. If you need to change something a previous migration did, you write a new migration that does the change.

Why this matters: the substrate's schema is the database. Getting migrations right is how you avoid corrupting data over time.

### Row-level security (RLS)

A Postgres feature that automatically filters database rows based on rules you write. We use it for multi-tenancy: every table has a `tenant_id` column, and the RLS rule says "only return rows where tenant_id matches the current tenant's ID." This means even if there is a bug in the application code that forgets to filter by tenant, the database itself refuses to leak data across tenants.

Why it matters for Exsto: hard tenancy is a layer 1 invariant. RLS is how we enforce it at the database level rather than relying on application code to never make a mistake.

### Multi-tenancy

When one running instance of software serves multiple separate customers ("tenants") whose data must never mix. Hard multi-tenancy means tenancy is a fundamental property of every piece of data, enforced structurally. The opposite is single-tenancy, where you run a separate copy of the software for each customer.

Why it matters: scaling a business on per-customer instances is brutal. Multi-tenancy is how SaaS works. Building it in from row one is much cheaper than retrofitting it later.

### Append-only / immutable data

Tables where rows are only ever added, never updated or deleted. The reasons: it preserves history (you can always see what was there), it makes the data tamper-evident (you can detect changes you didn't make), and it makes corrections explicit (a correction is a new row, not a silent overwrite).

Why it matters for Exsto: invariant 14. Events, actions, and audit logs are all append-only.

### Foreign key

A column in one table that points to a row in another table. Example: `entity_attribute.entity_id` is a foreign key pointing at `entity.id`. The database enforces that you can't have an `entity_attribute` row whose `entity_id` doesn't match any actual entity. This catches a class of bugs (orphaned references) at the database level.

### Index

A structure the database builds in the background to make certain queries fast. Without an index, the database has to scan every row to answer a query. With an index, it can jump straight to the matching rows. The cost: indexes take space and slow down writes a little. So you only add them when query patterns demonstrate the need.

### SQL

The query language for relational databases. You will see SQL in migration files and in some places in the codebase where the substrate package builds queries. You don't need to be an SQL expert to work on Exsto, but recognizing the basic shape (`SELECT ... FROM ... WHERE ...`) helps.

---

## Substrate-specific concepts

### Substrate

The foundational layer of Exsto. The database plus the engine that enforces the 23 invariants plus the primitives. "Substrate" is the noun we use to refer to the whole foundation, distinct from clients (UIs, agents, integrations) that connect to it.

### Layer 0, Layer 1, Layer 2, Layer 3, Layer 4

Conceptual layers of the system, in increasing order of how often they change.

- **Layer 0**: philosophical commitments. Forever. Three of them (system of record, unified data, substrate-with-clients).
- **Layer 1**: invariants every primitive obeys. Forever. 23 of them. Cannot be added or removed without rebuild.
- **Layer 2**: the primitives themselves. Mostly forever. New ones can be added carefully.
- **Layer 3**: customer-specific configurations and code (when an engagement starts). Lives in customer-specific forks of the repo, never upstream.
- **Layer 4**: features. UI surfaces, the configuration agent, dashboards. Iterated freely.

The discipline: changes at lower layers are rare and expensive. Changes at higher layers are normal and cheap.

### Primitive

One of the seven core things Exsto models: entity, attribute, relationship, event, judgment, outcome, action. Every primitive obeys all 23 invariants. Compositions of primitives express specific business concepts (a "deal," a "purchase order," a "patient" are all compositions of primitives, not primitives themselves).

### Entity

A thing that persists. Customers, deals, contacts, companies, projects, documents, periods. Anything you would talk about as a noun.

### Attribute

A typed value about an entity. The customer's name, the deal's amount, the contact's email. Each attribute carries provenance (where it came from), confidence, knowability state, and validity period.

### Relationship

A connection between two entities. "This contact works at this company." "This deal involves this account." Relationships are first-class facts, not just foreign key columns.

### Event

Something that happened. A meeting occurred. An email was sent. A status changed. Events are immutable; once recorded, they don't change.

### Judgment

A qualitative assessment about an entity, made by a human or an AI. "This deal looks weak." "This founder is a strong technical co-founder." Judgments carry provenance, confidence, and reasoning.

### Outcome

A realized result for an entity. "This deal closed won." "This patient recovered." "This invoice was paid." Outcomes are how the substrate captures the validation signal that makes it valuable for AI training.

### Action

Every change to the substrate. Actions carry the actor (who did it), the intent (why), the autonomy tier (how much oversight it required), and the reasoning (how it was decided). Every write becomes an action.

### Definition registry

A table that holds the schema for a kind of primitive. `entity_kind_definition` holds the kinds of entities that exist in this tenant. `attribute_definition` holds what attributes an entity kind can have. New kinds get added by inserting rows, not by writing code. This is the "schema-as-data" property.

### Schema-as-data

The property that the database's schema is itself queryable data. New entity kinds, new attribute kinds, new workflow definitions are all rows in tables. The application can introspect itself: "what kinds of things exist for this tenant right now?" can be answered with a query, not a code lookup.

Why it matters: this is what makes the eventual configuration agent (Layer 4) safe and possible. An agent can discover what's in the substrate by querying it.

### Provenance

Where a fact came from. Every fact in the substrate carries provenance. Sources are typed: `human:user_id`, `integration:integration_id`, `agent:agent_id`, `system:reason`. The substrate refuses to record a fact without provenance.

### Confidence

A number between 0.0 and 1.0 indicating how sure we are about a fact. Most directly observed facts are 1.0. AI-suggested facts often start lower. Inferred facts even lower. Queries return confidence alongside values, so consumers can decide how to weight the information.

### Knowability state

For each attribute, an explicit indicator of what we know about whether we know it. The states are:

- `observed`: we have a value
- `observed_null`: we explicitly observed the value is empty
- `never_observed`: we have never had a value here
- `withheld`: the value exists but we are not allowed to see it
- `inapplicable`: the field doesn't apply to this entity
- `pending`: we are in the process of finding out
- `stale`: we used to know, but the data is too old to trust
- `computation_failed`: we tried to compute it, and the computation errored

This is how the substrate distinguishes "we don't know" from "we know there is nothing" from "we are not allowed to see this."

### Time precision

Each temporal value carries a precision indicator (exact instant, second, minute, hour, day, week, month, quarter, year, range, approximate, unknown). The substrate distinguishes "Q3 2024" from "September 15, 2024" structurally, so AI agents reasoning about timing don't accidentally overstate certainty.

### Hybrid logical clock (HLC)

A way of stamping events with a timestamp that combines wall-clock time with a logical counter, so events that happen close together can still be ordered correctly even if the wall clocks of different machines disagree by a few milliseconds. Without this, distributed writes can produce ambiguous orderings, which breaks projection determinism.

To learn more: search for "hybrid logical clock paper" by Kulkarni et al. The concept is more accessible than it sounds; the paper is short.

### Hash chain

A series of records where each record contains a cryptographic hash of the previous record's contents. If you tamper with a record in the middle, the hash chain breaks and the tampering is detectable. Bitcoin uses this idea. Exsto uses it for events, so an audit can verify the event log has not been altered.

### Append-only event log

A sequence of immutable records of things that happened. The substrate's foundation. The current state of an entity is derived from the events that have affected it. Re-deriving (called "re-projection") is always possible because events are never deleted.

### Projection

The process of computing the current state of an entity from the events that have affected it. Projections are deterministic: given the same events, you always get the same current state. This is invariant 13.

### Action layer

The single code path that all writes to the substrate go through. The action layer captures intent, runs governance checks (is this actor allowed to do this?), enforces autonomy tier (does this require approval?), and records the action. Writing directly to substrate tables, bypassing the action layer, is forbidden.

### Governance gradient

Four tiers of autonomy for actions: `autonomous` (the actor can do this without asking), `notify` (the actor can do this but the relevant humans get notified), `approve` (the actor must request approval before doing this), `suggest` (the actor can only propose; a human must enact). Every action kind has a default tier; specific actors can have overrides.

Why it matters: AI agents will be doing actions in this substrate. Governance gradients are how we control what they can do without supervision.

### Identity assertion

A first-class fact that says "these two records refer to the same real-world thing." Identity is managed through assertions, not destructive merges, so you can revise identity decisions without losing history. Two systems calling the same person `John Smith` and `Jonathan Smith` get linked by an identity assertion, not by overwriting one.

### Contestation

When two facts disagree, the disagreement itself becomes a first-class observation. The substrate doesn't silently pick a winner; it records the contestation and lets a human or rule resolve it explicitly. This is invariant 21.

### Reasoning trace

When an AI agent takes an action, the reasoning behind it is captured: the evidence considered, the alternatives evaluated, the conclusion selected, the confidence in the conclusion. Linked to the action it produced. Reviewable by humans. Queryable. This is what makes AI actions in the substrate auditable in a way that just logging the action's effect cannot match.

### MCP (Model Context Protocol)

An open protocol developed by Anthropic for connecting AI models to tools and data sources. An MCP server exposes capabilities (read tools, write tools, search tools) that an AI client can call. Exsto's MCP server is the canonical interface to the substrate. AI clients (Claude in the reference app's chat surface, agents, configuration tools) all go through MCP.

To learn more: https://modelcontextprotocol.io

### MCP tool

A single capability exposed by the MCP server. A read tool fetches data. A write tool requests an action through the action layer. Each tool is a single file in `packages/mcp-tools/`.

---

## Worker and process concepts

### Process

A running program. The reference app is one process. The MCP server is another process. The worker runtime is another. They run independently, talk to each other through HTTP or the database.

### Worker

A process whose job is to handle background tasks asynchronously. Things that don't need to happen in the moment a user clicks a button. Examples: send a reminder later, process a webhook, run a scheduled report.

Why we have a worker runtime from day one: even the reference app needs reminders, which fire on a schedule. Time-based work cannot run inline with a request.

### Job

A unit of work for a worker to do. "Send a reminder for task X to user Y at time Z." Jobs sit in a queue until a worker picks them up and runs them.

### Queue

The data structure jobs sit in. Workers pull from the queue. The queue persists jobs until they succeed (so a worker crash doesn't lose work) and supports retries (so a transient failure gets another chance).

### Dead-letter queue (DLQ)

The pile where permanently failing jobs end up after all retries have been exhausted. A human looks at the DLQ to figure out what went wrong.

### Idempotency

The property that running an operation twice has the same effect as running it once. Job handlers should be idempotent so a retry doesn't double the effect.

---

## AI and agent concepts

### Claude Code

Anthropic's command-line tool for working with Claude on coding tasks. You run `claude` in your terminal, and Claude can read your files, edit them, run tests, run commands. The development environment for Exsto is Joe plus Claude Code.

### Subagent

A Claude session spawned by the main Claude session to handle a specialized task. Subagents have their own context window and don't pollute the main session. A "code-reviewer" subagent reviews code without the main session needing to know all the code-review prompting.

### Skill

A reusable bundle of instructions that Claude Code loads when it encounters a relevant task. The Superpowers plugin includes skills like "test-driven-development," "writing-plans," "systematic-debugging." When Claude sees a relevant signal, it loads the skill and follows it.

### Plugin (in Claude Code)

A bundle of subagents, skills, and slash commands that gets installed into Claude Code from a marketplace. Superpowers and wshobson/agents are both plugins. You install once per machine; they apply across all your repos.

### Agent

In Exsto, an "agent" is a non-human actor that takes actions on the substrate. Could be Claude Code in development, could be a configured AI in production, could be an automation. Agents have actor records in the substrate just like humans do, with the same audit and governance treatment.

### TDD (test-driven development)

A workflow: write a test that fails, write the minimum code to make it pass, then refactor. Forces you to think about what "done" means before you write code. Superpowers enforces TDD heavily.

### ADR (architecture decision record)

A short document recording why an architectural decision was made. ADRs live in `adr/`. Each one has the same structure: status, context, decision, consequences, alternatives considered. The first 23 ADRs document the layer 1 invariants. New ADRs get added when a decision important enough to remember has been made.

---

## Things to add over time

When you encounter a concept you want to study, add a stub here in the right section. Either you or Claude will fill it in.

For example, if "vector embedding" comes up and you want to learn what it is, add:

```
### Vector embedding

(stub - to be filled in)
```

Then in your next conversation, ask Claude to fill it in.
