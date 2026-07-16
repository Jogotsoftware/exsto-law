// BUILDER-UX-2 (WP-7) — backfill SPANISH client copy for every active service in the
// pilot tenant, through core (updateServiceMetadata → legal.service.upsert → a new
// immutable version with transitions.client_copy_i18n.es). Wizard builds now author
// Spanish alongside English at propose-time; this covers the services that predate
// that. Translations were authored for this backfill under the same client-copy
// doctrine (outcome-only, two ends, no jurisdiction, ≤70 chars).
//
// DELIBERATE GAP: ga_mutual_nda gets an es displayName but NO es description — the
// Spanish intake must fall back to the English description for it (the WP-7 fallback
// receipt). firm.booking_rules is a config singleton, not a client service — skipped.
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux2-es-backfill.ts apply
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux2-es-backfill.ts show
import '@exsto/legal'
import { listServicesIncludingInactive, updateServiceMetadata } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

// serviceKey → the es client copy. displayName/description follow the same tile
// doctrine as the English (outcome-only, ≤70 chars, no jurisdiction).
const ES: Record<string, { displayName: string; description?: string }> = {
  ga_mutual_nda: {
    displayName: 'Acuerdo de Confidencialidad Mutuo',
    // description DELIBERATELY omitted — the English-fallback receipt.
  },
  healthcare_employment_contract_review: {
    displayName: 'Revisión de Contrato Laboral Médico',
    description: 'Envíe su contrato y reciba una revisión clara en lenguaje sencillo.',
  },
  k_1_visa_application_review: {
    displayName: 'Revisión de Solicitud de Visa K-1',
    description: 'Envíe su solicitud K-1 y reciba una revisión completa.',
  },
  nc_cease_desist_letter: {
    displayName: 'Carta de Cese y Desistimiento',
    description: 'Cuéntenos su situación y reciba una carta lista para enviar.',
  },
  nc_residential_lease_review: {
    displayName: 'Revisión de Contrato de Arrendamiento',
    description: 'Suba su contrato y reciba una revisión en lenguaje claro.',
  },
  nc_will_drafting: {
    displayName: 'Testamento',
    description: 'Un testamento que protege a su familia y sus deseos.',
  },
}

async function apply(): Promise<void> {
  const services = await listServicesIncludingInactive(ctx)
  for (const s of services.filter((x) => x.isActive)) {
    const es = ES[s.serviceKey]
    if (!es) {
      console.log(`skip   ${s.serviceKey} (no translation authored — not a client service?)`)
      continue
    }
    if (s.clientCopyI18n?.es?.displayName) {
      console.log(`have   ${s.serviceKey} (es already present)`)
      continue
    }
    await updateServiceMetadata(ctx, {
      serviceKey: s.serviceKey,
      displayName: s.displayName, // identity resent verbatim; nothing else changes
      description: s.description,
      clientCopyI18n: { ...(s.clientCopyI18n ?? {}), es },
    })
    console.log(`wrote  ${s.serviceKey} → es "${es.displayName}"`)
  }
}

async function show(): Promise<void> {
  const rows = await withActionContext(ctx, async (client) => {
    const r = await client.query(
      `SELECT kind_name, client_display_name,
              transitions->'client_copy_i18n'->'es'->>'displayName' AS es_name,
              transitions->'client_copy_i18n'->'es'->>'description' AS es_desc
         FROM workflow_definition
        WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL
        ORDER BY kind_name`,
      [TENANT],
    )
    return r.rows
  })
  console.log(JSON.stringify(rows, null, 2))
}

const cmd = process.argv[2]
if (cmd === 'apply') await apply()
else if (cmd === 'show') await show()
else console.error('usage: bux2-es-backfill.ts apply|show')
