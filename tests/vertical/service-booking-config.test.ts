// WP2.3 / Contract G acceptance on a live DB. One save through the Service Library
// (updateServiceMetadata) must write a NEW immutable workflow_definition version
// carrying the per-service booking block + generation_mode + the inline rate, and
// reading the service back must surface them. Mirrors service-library.test.ts.
//
// DB-gated like tests/invariants: skips (not fails) when no DB URL is wired.
import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'

run('service booking config (live DB)', { timeout: 90_000 }, () => {
  const ctx = { tenantId: TENANT, actorId: ATTORNEY }
  const db = new pg.Pool({ connectionString: url })

  afterAll(async () => {
    await db.end()
    const { closeDbPool } = await import('@exsto/shared')
    await closeDbPool()
  })

  it('one save carries booking + generation_mode + cost onto a new version', async () => {
    const { createService, updateServiceMetadata, getService, retireService } =
      await import('@exsto/legal')

    const created = await createService(ctx, {
      displayName: `WP2.3 Booking ${randomUUID().slice(0, 8)}`,
    })
    const key = created.serviceKey

    try {
      // New service defaults: generation_mode template_merge, no booking, no cost.
      expect(created.generationMode).toBe('template_merge')
      expect(created.booking).toBeNull()
      expect(created.cost).toBeNull()

      // One save writes a new version carrying all three (Contract G).
      const saved = await updateServiceMetadata(ctx, {
        serviceKey: key,
        displayName: created.displayName,
        generationMode: 'ai_draft',
        booking: { enabled: true, send_calendar_invite: true, duration_minutes: 45 },
        cost: { type: 'hourly', amount: '350.00', hours: 3 },
      })

      // Reads surface the parsed shapes.
      expect(saved.generationMode).toBe('ai_draft')
      expect(saved.booking).toEqual({
        enabled: true,
        send_calendar_invite: true,
        duration_minutes: 45,
      })
      expect(saved.cost).toEqual({ type: 'hourly', amount: '350.00', hours: 3 })

      // And get-by-key resolves identically.
      const fetched = await getService(ctx, key)
      expect(fetched?.booking?.duration_minutes).toBe(45)
      expect(fetched?.generationMode).toBe('ai_draft')

      // The persisted transitions JSON carries the booking block + generation_mode
      // on exactly one active version (the prior was sealed).
      const rows = await db.query<{
        version: number
        generation_mode: string
        booking_enabled: boolean
        booking_duration: number
      }>(
        `SELECT version,
                transitions->>'generation_mode' AS generation_mode,
                (transitions->'booking'->>'enabled')::boolean AS booking_enabled,
                (transitions->'booking'->>'duration_minutes')::int AS booking_duration
           FROM workflow_definition
          WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
        [TENANT, key],
      )
      expect(rows.rowCount).toBe(1)
      expect(rows.rows[0]!.version).toBe(2)
      expect(rows.rows[0]!.generation_mode).toBe('ai_draft')
      expect(rows.rows[0]!.booking_enabled).toBe(true)
      expect(rows.rows[0]!.booking_duration).toBe(45)

      // An invalid duration is rejected before a version is written.
      await expect(
        updateServiceMetadata(ctx, {
          serviceKey: key,
          displayName: created.displayName,
          booking: { enabled: true, send_calendar_invite: false, duration_minutes: 20 as 15 },
        }),
      ).rejects.toThrow(/duration_minutes/)
    } finally {
      await retireService(ctx, key)
    }
  })
})
