# ADR 0004: Identity is stable, separate from natural keys, and managed by assertions

## Status
Accepted

## Context
Operational systems frequently identify entities by natural keys: email addresses for people, domain names for companies, deal IDs from a CRM. These keys change. People change emails. Companies change domains. CRMs migrate. Software that bound logic to natural keys breaks when the keys move.

Worse, the same real-world thing often appears in multiple source systems with different identifiers. The same person is `john@oldco.com` in one system, `j.smith@newco.com` in another, `1234` in Salesforce, `5678` in HubSpot. Identity resolution decides these are the same person. A naive merge destroys history. A proper system records the assertion that they are the same and lets future analysis reconsider it.

## Decision
Every entity has a substrate-internal UUID (`entity.id`) generated at creation. The UUID never changes. It has no semantic meaning. It is the only stable identifier inside the substrate.

Natural keys (emails, domains, external IDs) are stored as attributes on the entity, not as primary keys. They can change, get added, get removed. Multiple natural keys per entity are normal.

Identity resolution between source records is managed via `identity_assertion` rows. An assertion says "the source record at this URI corresponds to this substrate entity, asserted by this actor on this date with this confidence." Assertions are first-class observations: they have provenance, confidence, and validity periods. They can be revised by adding a contradicting assertion; the original is not deleted.

When two entities are believed to be the same, an `identity_assertion` row links them. The substrate does not destructively merge. Queries can choose to treat linked entities as one or as separate based on the use case.

## Consequences

What's now easier:
- External system migrations. The CRM changes, the natural keys change, the substrate's entity IDs do not.
- Identity revision. A bad merge is a new assertion that contradicts the old, not a database surgery operation.
- Confidence-aware identity. Two entities can be linked with confidence 0.7, queries can decide how to treat that.

What's now harder:
- Application code never relies on natural keys for joins. Internal code uses UUIDs.
- Identity resolution is a substrate concern, not an application detail. Adapters must produce assertions, not just write data with assumed identity.
- Reporting that aggregates by external ID needs to know how to handle linked-but-not-merged entities.

## Alternatives considered

**Natural keys as primary keys.** Rejected: requires destructive updates when keys change. Breaks history.

**UUIDs with destructive merge.** Use UUIDs but, when a duplicate is found, copy data to one entity and delete the other. Rejected: destroys history. Cannot be undone if the merge was wrong. Cannot represent "we think these are the same with 70% confidence."

**Separate person/company/etc tables with cross-references.** Rejected: every new entity kind requires schema changes. The schema-as-data discipline (ADR 0012) requires kinds to be data, so identity has to work uniformly across kinds.

**Probabilistic record linkage as a separate system.** Considered: there are good libraries for this. The output of any such system becomes `identity_assertion` rows in the substrate. The library is a tool; the substrate model is the contract.
