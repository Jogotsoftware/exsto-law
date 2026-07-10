// BACKHALF-BLOCKS-1 — retire the throwaway receipt clone service (append-only
// deprecation; its three receipt matters are already archived/terminal).
import { retireService } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

retireService(ctx, 'nc_will_drafting_copy')
  .then((r) => {
    console.log('retired:', JSON.stringify(r))
    process.exit(0)
  })
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
