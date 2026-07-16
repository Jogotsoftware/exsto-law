// CLIENT-PORTAL-UI-1 (Step 0) — backfill ENGLISH client copy for the active
// services that lack it, through core (updateServiceMetadata → legal.service.upsert
// → a new immutable version with client_display_name/client_description). The
// portal home renders ONLY the client-copy store (en columns, es via
// transitions.client_copy_i18n) — BUILDER-UX-1 authored en for 2 of 8 active
// services; this covers the rest, same copy doctrine as the es backfill
// (outcome-only, ≤70 chars, no jurisdiction, no process).
//
// firm.booking_rules is a config singleton, not a client service — skipped, and
// the portal never lists it (it has no client_of matters).
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/portal-ui1-en-backfill.ts show
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/portal-ui1-en-backfill.ts apply
import '@exsto/legal'
import { listServicesIncludingInactive, updateServiceMetadata } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

// serviceKey → en client copy. Mirrors the stored es copy (bux2-es-backfill) so
// both locales describe the same outcome in the same register.
const EN: Record<string, { clientDisplayName: string; clientDescription: string }> = {
  ga_mutual_nda: {
    clientDisplayName: 'Mutual Confidentiality Agreement',
    clientDescription: 'Protect both sides before you share sensitive information.',
  },
  healthcare_employment_contract_review: {
    clientDisplayName: 'Medical Employment Contract Review',
    clientDescription: 'Send us your contract and get a clear plain-language review.',
  },
  k_1_visa_application_review: {
    clientDisplayName: 'K-1 Visa Application Review',
    clientDescription: 'Send us your K-1 application and get a complete review.',
  },
  nc_residential_lease_review: {
    clientDisplayName: 'Residential Lease Review',
    clientDescription: 'Upload your lease and get a plain-language review.',
  },
  nc_will_drafting: {
    clientDisplayName: 'Will',
    clientDescription: 'A will that protects your family and your wishes.',
  },
}

async function apply(): Promise<void> {
  const services = await listServicesIncludingInactive(ctx)
  for (const s of services.filter((x) => x.isActive)) {
    if (s.clientDisplayName) {
      console.log(`have   ${s.serviceKey} (en already present: "${s.clientDisplayName}")`)
      continue
    }
    const en = EN[s.serviceKey]
    if (!en) {
      console.log(`skip   ${s.serviceKey} (no copy authored — not a client service?)`)
      continue
    }
    await updateServiceMetadata(ctx, {
      serviceKey: s.serviceKey,
      displayName: s.displayName, // identity resent verbatim; nothing else changes
      description: s.description,
      clientDisplayName: en.clientDisplayName,
      clientDescription: en.clientDescription,
      // clientCopyI18n OMITTED — the stored es copy carries forward untouched.
    })
    console.log(`wrote  ${s.serviceKey} → en "${en.clientDisplayName}"`)
  }
}

async function show(): Promise<void> {
  const rows = await withActionContext(ctx, async (client) => {
    const r = await client.query(
      `SELECT kind_name, client_display_name, client_description,
              transitions->'client_copy_i18n'->'es'->>'displayName' AS es_name
         FROM workflow_definition
        WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL
        ORDER BY kind_name`,
      [TENANT],
    )
    return r.rows
  })
  console.table(rows)
}

const mode = process.argv[2]
if (mode === 'apply') {
  apply().then(() => process.exit(0))
} else {
  show().then(() => process.exit(0))
}
