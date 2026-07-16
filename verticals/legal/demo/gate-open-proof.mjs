import '@exsto/legal'
import { scheduleClientTime } from '@exsto/legal'
const ctx = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '0e6ac4c2-8669-4c5f-9e9e-871705bddeae',
}
const start = new Date(Date.now() + 7 * 24 * 3600 * 1000)
const end = new Date(start.getTime() + 30 * 60000)
try {
  await scheduleClientTime(ctx, {
    clientContactId: 'fd690e57-dc76-4a0f-9605-a26be095b1f4',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  })
  console.log('booked')
} catch (e) {
  console.log('post-accept booking attempt →', e.name + ':', e.message)
}
process.exit(0)
