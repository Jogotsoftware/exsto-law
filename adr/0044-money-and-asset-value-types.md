# ADR 0044: Money and asset value types — amounts as strings, assets as entities

## Status

Accepted. Must be settled before any client vertical touches money (Huber AR/credit
is next after exsto-law). Establishes the one representation every vertical uses for
monetary and asset-denominated values. A cheap helper (`public.money_to_numeric`)
ships in migration 0026; the asset entity kind is a documented convention verticals
instantiate via `kind.define` (schema-as-data), not a forced foundation seed.

## Context

The substrate stores structured values in `jsonb` (attribute `value`, event/action
`payload`, etc.). The naive choice — store a monetary amount as a JSON number —
silently corrupts money: JSON numbers are IEEE-754 doubles, so `0.1 + 0.2`,
large integer cents, and 18-decimal crypto amounts lose precision the moment they
round-trip through a double. A substrate whose entire reason to exist is "hold what
is true, exactly" cannot store money as a float.

Two questions must be answered once, for every vertical, before money appears:

1. **How is an amount stored** so no precision is ever lost?
2. **How is the currency/asset modeled** so fiat and crypto share one shape and a
   value is never an ambiguous bare number?

## Decision

### 1. Amounts are stored as STRINGS in jsonb; math casts to `numeric`

A monetary amount is a **decimal string**, never a JSON number:

```jsonc
// attribute.value / payload field
{ "amount": "1234.56", "asset_ref": "9f1c…-asset-entity-uuid" }
```

- Postgres `jsonb` preserves the string exactly. Arithmetic casts at the boundary:
  `(value ->> 'amount')::numeric`. `numeric` is arbitrary-precision and exact.
- **Never** write the amount as `1234.56` (a JSON number) — even once, because the
  double has already been formed before it reaches Postgres.
- Crypto base units (e.g. wei, 18 decimals) are stored as their full integer or
  decimal string (`"1000000000000000000"`), never a float.

Helper (migration 0026), kept immutable and search-path-pinned:

```sql
public.money_to_numeric(value jsonb, key text default 'amount') returns numeric
-- (value ->> key)::numeric, with a clear error if the field is a JSON number
-- (jsonb_typeof = 'number') rather than a string.
```

The helper both extracts and **guards**: if the field was stored as a JSON number
it raises, turning a precision bug into a loud failure at write/read time.

### 2. Assets (fiat AND crypto) are ENTITIES; a value is `(amount, asset_ref)`

An asset — US dollars, euros, BTC, USDC, a tokenized share — is modeled as an
**entity** of kind `asset`, not an enum or a free-text currency code. This is the
substrate's own discipline (configuration is data, identity is stable) applied to
money:

- Entity kind `asset` with attributes:
  - `asset_class` — `fiat` | `crypto` | `security` | …
  - `symbol` — `USD`, `BTC`, `USDC`, …
  - `decimals` — integer scale (2 for USD, 18 for ETH/most ERC-20)
  - `chain` — for crypto: `ethereum`, `solana`, … (null for fiat)
  - `contract_address` — for crypto tokens (null for fiat / native coins)
- A monetary value everywhere is the **same pair**: a decimal-string `amount` plus
  an `asset_ref` (the asset entity's id). Fiat and crypto are indistinguishable in
  shape — a USD invoice line and a USDC payment are both `(amount, asset_ref)`.

This gives: stable asset identity across symbol reuse/renames (identity assertions
apply), exact decimals per asset, multi-currency and multi-chain from day one
without schema changes, and a single code path for "convert/sum/compare amounts"
that always resolves the asset's `decimals` from the entity.

**The `asset` kind is a convention, instantiated per vertical via `kind.define`**
(schema-as-data), not forced into the customer-agnostic foundation seed — a legal
clone needs no assets; a credit clone defines them on day one. The ADR fixes the
shape so every vertical defines the *same* `asset` kind and the *same*
`(amount, asset_ref)` representation. The foundation ships only the precision-safe
helper, which is asset-agnostic.

## Consequences

**Correct by construction**
- No monetary value can lose precision: strings in, `numeric` for math, `decimals`
  carried by the asset entity. The helper makes a float-amount a loud error.

**Unified fiat + crypto**
- One representation, one set of sum/convert/compare operations. A vertical adding
  crypto support adds asset entities, not a new value type or schema.

**Obligations on verticals**
- Define the `asset` kind exactly as specified (so cross-vertical/upstream code can
  rely on the shape). Always pair an amount with an `asset_ref`; never store a bare
  number. Use `money_to_numeric` (or the cast) for math; never JS-side float math
  on amounts read from the substrate.

**Cost**
- A monetary value is a small object (`amount` + `asset_ref`), not a scalar, and
  reads resolve the asset entity for `decimals`/`symbol`. This is the price of
  exactness and multi-asset support, and is negligible against the cost of a
  precision bug in a financial system.
