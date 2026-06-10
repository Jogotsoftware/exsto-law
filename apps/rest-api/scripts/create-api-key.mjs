// Mint an API key for a tenant + actor. The raw key is printed ONCE; only its
// sha256 hash is stored. Run after build, with a privileged DATABASE_URL.
//   DATABASE_URL=... node scripts/create-api-key.mjs <tenantId> <actorId> [name]
import { randomBytes } from 'node:crypto'
import { withSuperuser, closeDbPool } from '@exsto/shared'
import { hashKey, API_KEY_PREFIX } from '../dist/auth.js'

const [tenantId, actorId, name = 'rest-api key'] = process.argv.slice(2)
if (!tenantId || !actorId) {
  console.error(
    'Usage: DATABASE_URL=... node scripts/create-api-key.mjs <tenantId> <actorId> [name]',
  )
  process.exit(1)
}

const rawKey = API_KEY_PREFIX + randomBytes(24).toString('hex')
const keyPrefix = rawKey.slice(0, 14)
const keyHash = hashKey(rawKey)

try {
  await withSuperuser((client) =>
    client.query(
      `INSERT INTO api_key (tenant_id, actor_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, actorId, name, keyPrefix, keyHash],
    ),
  )
  console.log('API key created. Store it now — it will not be shown again:\n')
  console.log('  ' + rawKey + '\n')
  console.log(`  tenant=${tenantId} actor=${actorId} prefix=${keyPrefix}`)
} finally {
  await closeDbPool()
}
