// WP2.2 receipt. The pilot currently has no CRM rows (clean pre-onboarding), so
// the four-way is verified two ways: (1) the pure bucket rule on representative
// matter-status sets, and (2) the brief's exact client_contact→client→matters
// SQL executes against live (returns clean, currently-empty buckets).
//   tsx --env-file=.env.local verticals/legal/demo/verify-crm-buckets.ts
import { closeDbPool } from '@exsto/shared'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { deriveCrmBucket } from '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000001',
}

const CASES: Array<[string[], string]> = [
  [[], 'prospective'],
  [['intake_submitted'], 'active'],
  [['consultation_scheduled'], 'active'],
  [['matter_closed'], 'prior'],
  [['closed'], 'prior'],
  [['matter_closed', 'drafting'], 'active'], // any open ⇒ active
  [['closed', 'matter_closed'], 'prior'], // all closed ⇒ prior
]

async function main() {
  let pass = true
  for (const [statuses, expected] of CASES) {
    const got = deriveCrmBucket(statuses)
    const ok = got === expected
    pass &&= ok
    console.log(`${ok ? 'ok ' : 'FAIL'} [${statuses.join(',')}] → ${got} (expected ${expected})`)
  }

  // The brief's bucketing join, run live to prove it's valid SQL on this DB.
  const buckets = await withActionContext(ctx, async (c) => {
    const r = await c.query<{ bucket: string; n: string }>(
      `with attrs as (
         select distinct on (a.entity_id) a.entity_id, a.value
         from attribute a
         join attribute_kind_definition akd on akd.id = a.attribute_kind_id and akd.kind_name='matter_status'
         where a.tenant_id = $1
         order by a.entity_id, a.valid_from desc
       ),
       contact_status as (
         select cc.id as contact_id,
                count(*) filter (where ms.value #>> '{}' not in ('closed','matter_closed')) as open_n,
                count(*) filter (where ms.value #>> '{}' in ('closed','matter_closed')) as closed_n
         from entity cc
         join entity_kind_definition cek on cek.id = cc.entity_kind_id and cek.kind_name='client_contact'
         left join relationship co on co.source_entity_id = cc.id
              and co.relationship_kind_id = (select id from relationship_kind_definition where kind_name='contact_of')
         left join relationship mo on mo.target_entity_id = co.target_entity_id
              and mo.relationship_kind_id = (select id from relationship_kind_definition where kind_name='matter_of')
         left join attrs ms on ms.entity_id = mo.source_entity_id
         where cc.tenant_id = $1 and cc.status='active'
         group by cc.id
       )
       select case when open_n>0 then 'active' when closed_n>0 then 'prior' else 'prospective' end as bucket,
              count(*)::text as n
       from contact_status group by 1 order by 1`,
      [ctx.tenantId],
    )
    return r.rows
  })
  console.log('live client-path buckets (currently):', JSON.stringify(buckets))
  console.log(pass ? 'PASS — four-way bucket rule verified.' : 'FAIL')
  await closeDbPool()
  if (!pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
