// Fix #10 receipt — firm email signature stored & resolved THROUGH THE CORE.
// Proves: (1) the 0053 kinds exist; (2) legal.firm.signature_set fires and
// persists; (3) the central send path resolves the stored signature; (4) editing
// the signature changes what subsequent sends would carry; (5) the enabled toggle
// suppresses it; (6) with nothing stored it falls back to a firm-derived default.
//   tsx --env-file=.env.local verticals/legal/demo/verify-firm-signature.ts
import { closeDbPool } from '@exsto/shared'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { getFirmSignature, resolveEmailSignature, setFirmSignature } from '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000001',
}

async function actionCount(): Promise<number> {
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM action a
         JOIN action_kind_definition akd ON akd.id = a.action_kind_id
        WHERE a.tenant_id = $1 AND akd.kind_name = 'legal.firm.signature_set'`,
      [ctx.tenantId],
    )
    return Number(r.rows[0]?.n ?? 0)
  })
}

async function main() {
  let pass = true
  const check = (label: string, ok: boolean, extra = '') => {
    pass &&= ok
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  }

  // (1) kinds present
  const kinds = await withActionContext(ctx, async (c) => {
    const r = await c.query<{ t: string; kind_name: string }>(
      `SELECT 'entity' t, kind_name FROM entity_kind_definition WHERE kind_name='firm_profile'
       UNION ALL SELECT 'attr', kind_name FROM attribute_kind_definition WHERE kind_name IN ('email_signature','email_signature_enabled')
       UNION ALL SELECT 'action', kind_name FROM action_kind_definition WHERE kind_name='legal.firm.signature_set'`,
    )
    return r.rows.map((x) => `${x.t}:${x.kind_name}`)
  })
  check('0053 kinds defined', kinds.length === 4, kinds.join(', '))

  const before = await actionCount()

  // (2)+(3) set a signature, resolve it through the send path
  const sigText = 'Best regards,\nJuan Carlos Pacheco\nPacheco Law Firm · (919) 555-0100'
  await setFirmSignature(ctx, { signature: sigText, enabled: true })
  const resolved1 = await resolveEmailSignature(ctx)
  check(
    'stored signature is what the send path resolves',
    resolved1 === sigText,
    JSON.stringify(resolved1),
  )

  const after = await actionCount()
  check(
    'legal.firm.signature_set fired through the core',
    after === before + 1,
    `${before} → ${after}`,
  )

  // (4) editing changes subsequent sends
  const sigText2 = sigText + '\nNC Bar #12345'
  await setFirmSignature(ctx, { signature: sigText2 })
  const resolved2 = await resolveEmailSignature(ctx)
  check('editing the signature changes the next send', resolved2 === sigText2)

  // (5) disable → send path appends nothing; getFirmSignature reflects it
  await setFirmSignature(ctx, { enabled: false })
  const resolved3 = await resolveEmailSignature(ctx)
  const cfg3 = await getFirmSignature(ctx)
  check('disabled ⇒ send path appends nothing', resolved3 === '' && cfg3.enabled === false)

  // (6) clear text + re-enable ⇒ firm-derived default kicks in (non-empty)
  await setFirmSignature(ctx, { signature: '', enabled: true })
  const cfg4 = await getFirmSignature(ctx)
  const resolved4 = await resolveEmailSignature(ctx)
  check(
    'empty stored ⇒ firm-derived default used',
    cfg4.isDefault === true && resolved4.length > 0,
    `default=${JSON.stringify(resolved4)}`,
  )

  // Restore a sensible firm signature so the pilot is left in a good state.
  await setFirmSignature(ctx, { signature: sigText2, enabled: true })
  console.log(
    '\nleft pilot with signature enabled:\n' +
      JSON.stringify((await getFirmSignature(ctx)).resolved),
  )

  console.log(`\n${pass ? 'PASS' : 'FAIL'} — firm signature through-the-core`)
  if (!pass) process.exitCode = 1
}

main().finally(closeDbPool)
