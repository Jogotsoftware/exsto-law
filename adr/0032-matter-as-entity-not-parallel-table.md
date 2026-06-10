# ADR 0032: Matter is modeled as an entity, not a parallel table

## Status
Accepted

## Context
An earlier draft of migration 0004 created a flat `legal_matter` table with columns for matter number, client name, practice area, status, summary. A handler for `legal.matter.create` inserted directly into that table.

This bypassed the entity primitive. The matter row had no attribute provenance, no time precision, no knowability, no temporality, no relationships to client_contact or questionnaire_response. None of the substrate invariants applied to it because it was its own concept. The reasoning trace, document_version, and content_blob primitives could not naturally reference a matter that lived outside the entity graph.

It also broke the architecture's second commitment — "unified operational and judgmental data" — by creating a domain-specific table that other primitives would need to special-case.

## Decision

The matter is an entity with `entity_kind = 'matter'`. Its identifying fields (matter number, client name, practice area, status, summary) are written as attributes through `insertAttribute`, each with its own provenance, confidence, time precision, and validity range. The matter's relationships to its client contact, questionnaire, call session, transcript, and documents are first-class `relationship` rows. The same is true for client contacts, questionnaire responses, transcripts, draft documents, and engagement letters.

Migration 0004 therefore does *not* create a `legal_matter` table; the only legal-specific schema is `reasoning_trace` (general substrate primitive) and the document/content blob primitives added in 0005. The seed inserts entity_kind / attribute_kind / relationship_kind definition rows that the wedge handlers reference by name at runtime.

## Consequences

### What this makes easier
- Matter status changes are observations on an attribute — automatically temporal, audited, and reasonable about historically.
- Every fact about a matter has provenance and confidence by construction.
- Queries that traverse "matter → questionnaire → transcript → draft" use the same `relationship` table everything else uses.
- Future verticals don't need their own `*_matter` tables; they just register new entity kinds.

### What this makes harder
- Queries are denser: `getMatter` joins entity + attribute + relationship + document_version. The `verticals/legal/src/queries/matters.ts` query is ~40 lines instead of one `SELECT * FROM legal_matter`.
- Index design has to think about (entity_id, attribute_kind_id, valid_from DESC) access patterns; the current indexes cover that path for the wedge but production usage may need more.

## Alternatives considered
- Keep the parallel `legal_matter` table as a denormalization, write to both through the handler. Rejected as drift-prone and substrate-incoherent.
- Make `legal_matter` a materialized view over entity + attribute. Rejected as unnecessary complexity for v1; the indexed entity/attribute path is fast enough.

## Accepted
Yes. Implemented in `supabase/migrations/0003_core_primitives.sql`, `supabase/migrations/0004_reasoning_trace_legal_matter.sql`, the seed, and `verticals/legal/src/handlers/`.
