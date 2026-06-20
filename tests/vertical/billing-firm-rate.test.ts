// Beta feedback: "still not seeing unbilled invoices even though I logged
// expenses and hours." One cause: listUnbilled priced time ONLY at the client's
// explicit rate, so a client with no rate showed a BLANK amount — even though the
// firm has a default hourly rate that the invoice handler already falls back to.
// This pins the fix: the Unbilled preview now prices logged time at the firm
// default when the client has no own rate, and the matter (linked to a client by
// intake) shows up as BILLABLE, not orphaned. DB-gated.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { logTimeEntry, listUnbilled, setFirmDefaultRate } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const intakeCtx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

run('billing — firm-rate fallback on unbilled time (live DB)', { timeout: 120_000 }, () => {
  const tag = `bfr-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('prices logged time at the firm default when the client has no own rate', async () => {
    // A distinctive firm default so we are not coupled to existing data.
    const firmRate = '275.00'
    await setFirmDefaultRate(ctx, firmRate)

    // Intake → contact + matter. matter.open links the matter to a (new) client
    // parent with NO client_billable_rate set.
    const intake = await submitAction(intakeCtx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Rate Test`,
        client_email: `${tag}@pilot.test`,
        client_phone: null,
        client_company_name: `${tag} Co`,
        service_key: 'nc_llc_single_member',
        intake_form_id: null,
        intake_responses: {},
      },
    })
    const { clientEntityId: contactId, questionnaireEntityId } = intake.effects[0] as {
      clientEntityId: string
      questionnaireEntityId: string
    }
    const opened = await submitAction(intakeCtx, {
      actionKindName: 'matter.open',
      intentKind: 'enforcement',
      payload: {
        service_key: 'nc_llc_single_member',
        workflow_route: 'manual',
        client_entity_id: contactId,
        questionnaire_entity_id: questionnaireEntityId,
        client_display_name: `${tag} Co`,
      },
    })
    const matterId = (opened.effects[0] as { matterEntityId: string }).matterEntityId

    // Log one hour of time.
    await logTimeEntry(ctx, {
      matterEntityId: matterId,
      durationMinutes: 60,
      description: `${tag} drafting`,
    })

    const { clients } = await listUnbilled(ctx)
    // Find our matter across clients (it is BILLABLE — linked to a client parent).
    let entry: { kind: string; rate: string | null; amount: string | null } | undefined
    let onBillableClient = false
    for (const c of clients) {
      const m = c.matters.find((x) => x.matterEntityId === matterId)
      if (m) {
        onBillableClient = Boolean(c.clientEntityId)
        entry = m.entries.find((e) => e.description === `${tag} drafting`)
      }
    }
    expect(entry, 'logged time entry should appear in Unbilled').toBeTruthy()
    expect(onBillableClient, 'matter should be under a billable client, not orphaned').toBe(true)
    // Priced at the firm default: 60 min = 1.00h × 275.00 = 275.00.
    expect(entry!.rate).toBe('275.00')
    expect(entry!.amount).toBe('275.00')
  })
})
