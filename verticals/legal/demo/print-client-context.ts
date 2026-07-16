// MACHINE-COMMS-1 (WP1 receipt) — print a client's ASSEMBLED memory exactly as
// the machine consumes it (getClientContext → formatClientContext). Read-only.
//
//   npx tsx --env-file=.env.local verticals/legal/demo/print-client-context.ts <clientEntityId> [maxChars]
import { pathToFileURL } from 'node:url'
import type { ActionContext } from '@exsto/substrate'
import { getClientContext, formatClientContext } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: process.env.SEED_TENANT ?? '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const clientId = process.argv[2]
  if (!clientId) throw new Error('usage: print-client-context.ts <clientEntityId> [maxChars]')
  const maxChars = process.argv[3] ? Number(process.argv[3]) : undefined
  const context = await getClientContext(ctx, clientId)
  if (!context) {
    console.error('No such client (or not active).')
    process.exit(2)
  }
  console.log(formatClientContext(context, maxChars))
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    })
}
