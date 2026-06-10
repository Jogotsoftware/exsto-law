# Supabase

This directory holds the database schema and configuration for Exsto.

## Structure

- `migrations/` - forward-only SQL migrations applied in numeric order. Once a migration is merged to main, it is never modified, only added to. To change something a previous migration did, write a new migration that does the change.
- `seed/` - seed data for local development (currently empty)
- `functions/` - Edge Functions for low-volume webhooks (currently empty)

## Applying migrations

Migrations are currently applied to the dev Supabase project (`exsto-dev`) via the Supabase MCP connection during planning sessions. Each migration is verified working before its SQL file lands in this directory. A future PR will introduce a CI workflow or scripted path for applying migrations.

## Authoring new migrations

File naming: `NNNN_snake_case_description.sql` where NNNN is the next sequence number (zero-padded to 4 digits).

Conventions:

- Forward-only. No drops, no destructive changes; corrections are new migrations.
- Every tenant-scoped table has `tenant_id uuid NOT NULL REFERENCES tenant(id)`.
- Every tenant-scoped table has RLS enabled with the standard policy (see migration 0001 for the pattern).
- Append-only event tables deny UPDATE and DELETE via RLS policies returning `false` (see migration 0001 `action` table for the pattern).
- Indexes on `tenant_id` are mandatory for query performance under RLS.
