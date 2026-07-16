// Rename a service's DISPLAY NAME through core (legal.service.upsert via
// updateServiceMetadata) — a new immutable version; status/states/transitions
// carry forward, so a disabled service stays disabled and running matters
// (version-pinned by id) are untouched. Description is re-read and carried
// forward verbatim.
//
//   npx tsx --env-file=.env.local verticals/legal/demo/rename-service.ts <serviceKey> <newDisplayName>
import { pathToFileURL } from 'node:url'
import type { ActionContext } from '@exsto/substrate'
import { getService, updateServiceMetadata } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: process.env.SEED_TENANT ?? '00000000-0000-0000-0000-000000000001',
  actorId: process.env.RENAME_ACTOR ?? 'e193d11c-9204-4068-8d01-0613ec1a5095',
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const [serviceKey, displayName] = [process.argv[2], process.argv[3]]
  if (!serviceKey || !displayName) {
    throw new Error('usage: rename-service.ts <serviceKey> <newDisplayName>')
  }
  const current = await getService(ctx, serviceKey)
  if (!current) throw new Error(`Service not found: ${serviceKey}`)
  const updated = await updateServiceMetadata(ctx, {
    serviceKey,
    displayName,
    description: current.description,
  })
  console.log(
    `renamed: ${serviceKey} "${current.displayName}" → "${updated.displayName}" (active=${updated.isActive})`,
  )
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
