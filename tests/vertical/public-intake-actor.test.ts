// SECOND-FIRM-1 — resolvePublicIntakeActor must FAIL CLOSED. Public writes
// (booking, e-sign links, pay links, appointment manage) run as the RESOLVED
// tenant's own system actor; tenant zero's historical …0005 id has no actor row
// in any other tenant, so returning it as a fallback only defers the failure to
// a confusing downstream FK error. These tests pin: (a) the tenant's own actor
// row wins, (b) a tenant with no system/agent actor throws a provisioning
// error instead of silently borrowing tenant zero's actor.
import { describe, it, expect, vi } from 'vitest'

const rows: Array<{ id: string }> = []
vi.mock('@exsto/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/shared')>()
  return {
    ...actual,
    withTenant: vi.fn(async (_tenantId: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows, rowCount: rows.length }) }),
    ),
  }
})
import { resolvePublicIntakeActor } from '@exsto/legal'

const TENANT = 'ae5530a1-05c7-4241-a38e-79bd186c1bbb'

describe('resolvePublicIntakeActor (SECOND-FIRM-1)', () => {
  it("returns the tenant's own resolved actor row", async () => {
    rows.length = 0
    rows.push({ id: 'firm-two-system-actor' })
    expect(await resolvePublicIntakeActor(TENANT)).toBe('firm-two-system-actor')
  })

  it('throws (fail closed) when the tenant has no system/agent actor', async () => {
    rows.length = 0
    await expect(resolvePublicIntakeActor(TENANT)).rejects.toThrow(
      /No active public-intake system actor in tenant/,
    )
  })
})
