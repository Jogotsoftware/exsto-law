# Exsto Substrate REST API

> Generated from the OpenAPI spec (`GET /v1/openapi.json`), which is itself generated
> from the tool catalog. Do not edit by hand — run `pnpm --filter @exsto/rest-api gen:docs`.

A thin REST/OpenAPI adapter over the Exsto operation core (ADR 0038). Every endpoint delegates to the SAME action/query core the MCP server uses; it never issues its own substrate SQL. Authenticate with an API key; the tenant + actor are derived from the key server-side. Writes flow through the append-only action layer.

## Versioning
All endpoints are under `/v1`. Breaking changes ship under a new version prefix.

## Authentication & tenancy
Authenticate with an API key: `Authorization: Bearer <key>` or `X-API-Key: <key>`.
The **tenant and actor are derived from the key server-side** and are never read from the
request — a client cannot choose its own tenant. Writes flow through the append-only action
layer; reads are tenant-scoped. Mint a key with `scripts/create-api-key.mjs`.

## Idempotency
Write requests accept an optional `Idempotency-Key` header. Replaying a write with the same
key returns the original response (header `idempotency-replayed: true`) instead of submitting
a second action.

## Rate limiting
Per-tenant fixed window. Responses carry `X-RateLimit-Limit` / `X-RateLimit-Remaining`; a 429
carries `Retry-After` (seconds).

## Errors
Every error returns `{ "error": { "code", "message", "details"? } }`:

| Status | When |
|---|---|
| 400 | Malformed JSON body |
| 401 | Missing/invalid API key |
| 403 | Tenancy/governance denied |
| 404 | Unknown or non-exposed operation |
| 405 | Non-POST on an operation path |
| 409 | Contestation detected |
| 422 | Operation understood but could not be completed |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error |

## Endpoints

Each operation maps 1:1 to a substrate tool of the same name (`entity.create` -> `POST /v1/entity/create`), delegating to the same operation core as the MCP adapter.

| Method & path | Operation | Mode | Summary |
|---|---|---|---|
| `POST /v1/attribute/history/get` | `attribute_history_get` | read | Get the full observation history for one attribute kind on an entity. |
| `POST /v1/attribute/set` | `attribute_set` | write | Set an entity attribute, closing the prior value of the same kind. |
| `POST /v1/entity/archive` | `entity_archive` | write | Archive an entity. |
| `POST /v1/entity/context` | `entity_context` | read | Full context for one entity: attributes, relationships, events, judgments, outcomes — the unit of context for an AI model. |
| `POST /v1/entity/create` | `entity_create` | write | Create an entity of a given kind, optionally with initial attributes. |
| `POST /v1/entity/get` | `entity_get` | read | Get an entity with its current attribute values. |
| `POST /v1/entity/list_by_kind` | `entity_list_by_kind` | read | List active entities of a given kind. |
| `POST /v1/entity/search` | `entity_search` | read | Hybrid keyword search over entity names and current attribute values, with optional entity-kind filter. |
| `POST /v1/entity/update` | `entity_update` | write | Update an entity's name, status, or metadata. |
| `POST /v1/event/list_for_entity` | `event_list_for_entity` | read | List recent events touching an entity. |
| `POST /v1/event/record` | `event_record` | write | Record an immutable event. |
| `POST /v1/identity/assert` | `identity_assert` | write | Assert that two entities are the same, different, or related (non-destructive). |
| `POST /v1/judgment/list_for_entity` | `judgment_list_for_entity` | read | List judgments about an entity (optionally only current ones). |
| `POST /v1/judgment/record` | `judgment_record` | write | Record a judgment (qualitative assessment) about an entity. |
| `POST /v1/outcome/list_for_entity` | `outcome_list_for_entity` | read | List realized outcomes for an entity. |
| `POST /v1/outcome/record` | `outcome_record` | write | Record a realized outcome for an entity. |
| `POST /v1/relationship/close` | `relationship_close` | write | End a relationship's validity. |
| `POST /v1/relationship/create` | `relationship_create` | write | Create a relationship between two entities. |
| `POST /v1/relationship/list` | `relationship_list` | read | List relationships touching an entity (optionally only currently-open ones). |
| `POST /v1/substrate/action/submit` | `substrate_action_submit` | write | Submit any substrate action by kind name (see substrate.capability.list for available kinds). |
| `POST /v1/substrate/capability/list` | `substrate_capability_list` | read | List the entity, attribute, relationship, and action kinds available for this tenant. |

Interactive docs: `GET /v1/docs` (Redoc over `/v1/openapi.json`).
