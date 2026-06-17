// Per-attorney integration connections (migration 0016). "Each attorney is
// almost their own tenant within a tenant": personal providers (google, granola)
// are scoped to the connecting attorney's actor_id, so one attorney can never
// read, overwrite, or disconnect another attorney's credentials — even inside
// the same firm. Firm-wide AI keys (anthropic/openai/perplexity) stay shared
// (actor_id NULL) because the async drafting worker loads them as the agent
// actor, not a logged-in attorney.
//
// This is the most security-sensitive guarantee in the product (credential
// isolation in a legal app), so it gets a live-DB test that exercises the real
// Vault-backed store. Runs against an EPHEMERAL throwaway tenant + two actors so
// it never touches real attorney connections in the shared dev DB.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  saveConnection,
  loadConnection,
  listConnections,
  disconnect,
  resolveFirmPrimaryActor,
  isPerActorProvider,
} from '@exsto/legal'
import { withSuperuser, closeDbPool } from '@exsto/shared'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

// Deterministic ids in a range no seed uses, so cleanup is unambiguous.
const TENANT = '00000000-0000-0000-0000-0000000a0016'
const ACTOR_A = '00000000-0000-0000-000a-0000000a0016'
const ACTOR_B = '00000000-0000-0000-000b-0000000a0016'

run('per-attorney connection isolation (live DB)', { timeout: 90_000 }, () => {
  beforeAll(async () => {
    await withSuperuser(async (client) => {
      // Clean any leftovers from a prior aborted run, then create fixtures.
      await client.query(`DELETE FROM vault.secrets WHERE name LIKE $1`, [`legal/%/${TENANT}%`])
      await client.query(`DELETE FROM legal_integration_connection WHERE tenant_id = $1`, [TENANT])
      await client.query(`DELETE FROM actor WHERE id = ANY($1::uuid[])`, [[ACTOR_A, ACTOR_B]])
      await client.query(`DELETE FROM tenant WHERE id = $1`, [TENANT])
      await client.query(`INSERT INTO tenant (id, name) VALUES ($1, 'per-actor-test')`, [TENANT])
      await client.query(
        `INSERT INTO actor (id, tenant_id, actor_type, display_name) VALUES
           ($1, $3, 'human', 'Attorney A'),
           ($2, $3, 'human', 'Attorney B')`,
        [ACTOR_A, ACTOR_B, TENANT],
      )
    })
  })

  afterAll(async () => {
    await withSuperuser(async (client) => {
      await client.query(`DELETE FROM vault.secrets WHERE name LIKE $1`, [`legal/%/${TENANT}%`])
      await client.query(`DELETE FROM legal_integration_connection WHERE tenant_id = $1`, [TENANT])
      await client.query(`DELETE FROM actor WHERE id = ANY($1::uuid[])`, [[ACTOR_A, ACTOR_B]])
      await client.query(`DELETE FROM tenant WHERE id = $1`, [TENANT])
    })
    await closeDbPool()
  })

  it('classifies providers: google/granola are per-actor; AI keys are firm-wide', () => {
    expect(isPerActorProvider('google')).toBe(true)
    expect(isPerActorProvider('granola')).toBe(true)
    expect(isPerActorProvider('anthropic')).toBe(false)
    expect(isPerActorProvider('openai')).toBe(false)
    expect(isPerActorProvider('perplexity')).toBe(false)
  })

  it("an attorney's Google credentials are invisible to another attorney", async () => {
    await saveConnection(
      TENANT,
      'google',
      { access_token: 'A-google-token' },
      { accountEmail: 'a@firm.test' },
      ACTOR_A,
    )
    await saveConnection(
      TENANT,
      'google',
      { access_token: 'B-google-token' },
      { accountEmail: 'b@firm.test' },
      ACTOR_B,
    )

    const a = await loadConnection<{ access_token: string }>(TENANT, 'google', ACTOR_A)
    const b = await loadConnection<{ access_token: string }>(TENANT, 'google', ACTOR_B)
    expect(a?.secret.access_token).toBe('A-google-token')
    expect(b?.secret.access_token).toBe('B-google-token')
    expect(a?.info.accountEmail).toBe('a@firm.test')
    expect(b?.info.accountEmail).toBe('b@firm.test')

    // The firm-wide slot (no actor) for a per-actor provider is its own empty
    // slot — it must NOT resolve to either attorney's tokens.
    const firmWide = await loadConnection(TENANT, 'google', null)
    expect(firmWide).toBeNull()
  })

  it('Granola is likewise isolated per attorney', async () => {
    await saveConnection(TENANT, 'granola', { api_key: 'A-granola' }, {}, ACTOR_A)
    await saveConnection(TENANT, 'granola', { api_key: 'B-granola' }, {}, ACTOR_B)
    const a = await loadConnection<{ api_key: string }>(TENANT, 'granola', ACTOR_A)
    const b = await loadConnection<{ api_key: string }>(TENANT, 'granola', ACTOR_B)
    expect(a?.secret.api_key).toBe('A-granola')
    expect(b?.secret.api_key).toBe('B-granola')
  })

  it('firm-wide AI keys ignore actorId — every attorney shares the one key', async () => {
    // Saving anthropic "as" attorney A still writes the firm-wide row (actor_id
    // NULL); attorney B and the worker (no actor) read the SAME key.
    await saveConnection(TENANT, 'anthropic', { api_key: 'firm-anthropic' }, {}, ACTOR_A)

    const asA = await loadConnection<{ api_key: string }>(TENANT, 'anthropic', ACTOR_A)
    const asB = await loadConnection<{ api_key: string }>(TENANT, 'anthropic', ACTOR_B)
    const asWorker = await loadConnection<{ api_key: string }>(TENANT, 'anthropic')
    expect(asA?.secret.api_key).toBe('firm-anthropic')
    expect(asB?.secret.api_key).toBe('firm-anthropic')
    expect(asWorker?.secret.api_key).toBe('firm-anthropic')

    // And the row really is firm-wide (actor_id NULL), not pinned to A.
    const stored = await withSuperuser((client) =>
      client.query<{ actor_id: string | null }>(
        `SELECT actor_id FROM legal_integration_connection
         WHERE tenant_id = $1 AND provider = 'anthropic'`,
        [TENANT],
      ),
    )
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0]?.actor_id).toBeNull()
  })

  it('resolveFirmPrimaryActor returns the earliest-connected attorney for a provider', async () => {
    // A connected Google before B (insertion order above), so A is primary.
    const primary = await resolveFirmPrimaryActor(TENANT, 'google')
    expect(primary).toBe(ACTOR_A)
    // Firm-wide providers have no "primary attorney".
    expect(await resolveFirmPrimaryActor(TENANT, 'anthropic')).toBeNull()
  })

  it("listConnections(actor) returns the attorney's own personal + firm-wide, never a peer's", async () => {
    const forA = await listConnections(TENANT, ACTOR_A)
    const providersForA = forA.map((c) => c.provider).sort()
    // A sees A's google + granola and the firm-wide anthropic.
    expect(providersForA).toEqual(['anthropic', 'google', 'granola'])
    // A's google email is A's — never B's.
    expect(forA.find((c) => c.provider === 'google')?.accountEmail).toBe('a@firm.test')

    const forB = await listConnections(TENANT, ACTOR_B)
    expect(forB.find((c) => c.provider === 'google')?.accountEmail).toBe('b@firm.test')

    // Admin/diagnostic listing (no actor) sees every row across both attorneys.
    const all = await listConnections(TENANT)
    expect(all.filter((c) => c.provider === 'google')).toHaveLength(2)
  })

  it("disconnecting one attorney leaves the other's connection intact", async () => {
    await disconnect(TENANT, 'google', ACTOR_A)
    expect(await loadConnection(TENANT, 'google', ACTOR_A)).toBeNull()
    // B is untouched.
    const b = await loadConnection<{ access_token: string }>(TENANT, 'google', ACTOR_B)
    expect(b?.secret.access_token).toBe('B-google-token')
  })
})
