// Matter time & expense ledgers (time.logged / expense.recorded events).
//   • Pure money math (no DB): amountToCents parses decimal strings exactly and
//     rejects junk — the ADR 0044 "no float money" guard.
//   • Substrate recording (live DB): logTimeEntry / recordExpense write events on
//     the matter; the list reads them back with self-consistent totals; a receipt
//     round-trips (metadata in the list, bytes on demand) and is absent when none
//     was attached.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  amountToCents,
  logTimeEntry,
  listMatterTime,
  recordExpense,
  listMatterExpenses,
  getExpenseReceipt,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

describe('amountToCents (no DB)', () => {
  it('parses decimal strings exactly', () => {
    expect(amountToCents('150')).toBe(15000)
    expect(amountToCents('150.5')).toBe(15050)
    expect(amountToCents('150.50')).toBe(15050)
    expect(amountToCents('0.29')).toBe(29)
    expect(amountToCents(' 12.00 ')).toBe(1200)
  })
  it('rejects non-decimal or over-precise input', () => {
    expect(() => amountToCents('abc')).toThrow()
    expect(() => amountToCents('1.234')).toThrow()
    expect(() => amountToCents('-5')).toThrow()
    expect(() => amountToCents('')).toThrow()
  })
})

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
// The seeded demo matter (Pine Hollow Roasters), stable across the dev DB.
const MATTER = 'ee4a824f-0742-4f2b-af16-55fc62f1f107'

run('time & expense recording (live DB)', { timeout: 90_000 }, () => {
  const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }
  const tag = `vitest-te-${Date.now()}`

  afterAll(async () => {
    await closeDbPool()
  })

  it('logs time and reads it back with a self-consistent total', async () => {
    await logTimeEntry(ctx, {
      matterEntityId: MATTER,
      durationMinutes: 90,
      description: `${tag} draft`,
    })
    await logTimeEntry(ctx, {
      matterEntityId: MATTER,
      durationMinutes: 30,
      description: `${tag} call`,
    })

    const { entries, totalMinutes } = await listMatterTime(ctx, MATTER)
    const mine = entries.filter((e) => e.description.startsWith(tag))
    expect(mine.map((e) => e.durationMinutes).sort()).toEqual([30, 90])
    // The reported total is exactly the sum of the listed entries.
    expect(totalMinutes).toBe(entries.reduce((s, e) => s + e.durationMinutes, 0))
  })

  it('records expenses (with + without receipt) and totals them; receipt round-trips', async () => {
    // base64('hello world') — a tiny stand-in receipt.
    const receiptB64 = Buffer.from('hello world').toString('base64')
    const withReceipt = await recordExpense(ctx, {
      matterEntityId: MATTER,
      amount: '125.50',
      description: `${tag} filing fee`,
      receipt: { filename: 'fee.txt', contentType: 'text/plain', dataBase64: receiptB64 },
    })
    await recordExpense(ctx, {
      matterEntityId: MATTER,
      amount: '0.50',
      description: `${tag} postage`,
    })

    const { entries, total } = await listMatterExpenses(ctx, MATTER)
    const fee = entries.find((e) => e.description === `${tag} filing fee`)
    const postage = entries.find((e) => e.description === `${tag} postage`)
    expect(fee?.amount).toBe('125.50')
    expect(postage?.amount).toBe('0.50')

    // Receipt metadata rides in the list; bytes do NOT.
    expect(fee?.receipt).toMatchObject({ filename: 'fee.txt', contentType: 'text/plain' })
    expect(fee?.receipt?.sizeBytes).toBeGreaterThan(0)
    expect(postage?.receipt).toBeNull()
    expect(JSON.stringify(entries)).not.toContain(receiptB64)

    // Total equals the exact cents-sum of every listed expense.
    const expectedCents = entries.reduce((s, e) => s + amountToCents(e.amount), 0)
    expect(amountToCents(total)).toBe(expectedCents)

    // Bytes fetched on demand for the one with a receipt; null for the one without.
    const got = await getExpenseReceipt(ctx, {
      matterEntityId: MATTER,
      eventId: withReceipt.eventId,
    })
    expect(got?.dataBase64).toBe(receiptB64)
    expect(got?.filename).toBe('fee.txt')

    const none = await getExpenseReceipt(ctx, {
      matterEntityId: MATTER,
      eventId: (await listMatterExpenses(ctx, MATTER)).entries.find(
        (e) => e.description === `${tag} postage`,
      )!.eventId,
    })
    expect(none).toBeNull()
  })

  it('rejects a bad amount and an oversized receipt', async () => {
    await expect(
      recordExpense(ctx, { matterEntityId: MATTER, amount: 'not-money', description: 'x' }),
    ).rejects.toThrow()
    await expect(
      recordExpense(ctx, {
        matterEntityId: MATTER,
        amount: '1.00',
        description: 'big',
        receipt: {
          filename: 'big.bin',
          contentType: 'application/octet-stream',
          dataBase64: 'A'.repeat(2_000_001),
        },
      }),
    ).rejects.toThrow(/too large/i)
  })
})
