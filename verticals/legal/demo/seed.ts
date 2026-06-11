// Demo seed (REQ-DEMO-02): a realistic two-founder NC LLC formation matter,
// end to end THROUGH THE ACTION LAYER — intake.submit → matter.open →
// booking.create → raw_event.ingest → call.ingest → draft.generate (cached,
// with full reasoning traces). No live API calls.
//
// Idempotent by detection, not deletion: the substrate's history is
// append-only (invariant 14 triggers raise on DELETE for every role), so the
// seed never resets — if the demo client already exists, it reports and exits.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { closeDbPool, withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { cacheDraft, loadCall, submitBooking } from '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE_ACTOR_ID = '00000000-0000-0000-0001-000000000005'
const ATTORNEY_ACTOR_ID = '00000000-0000-0000-0001-000000000002'
const DEMO_CLIENT_EMAIL = 'marcus@pinehollowroasters.example'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = resolve(here, 'content')

const publicCtx: ActionContext = { tenantId: TENANT_ID, actorId: PUBLIC_INTAKE_ACTOR_ID }
const attorneyCtx: ActionContext = { tenantId: TENANT_ID, actorId: ATTORNEY_ACTOR_ID }

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(resolve(contentDir, filename), 'utf8')) as T
}

function loadText(filename: string): string {
  return readFileSync(resolve(contentDir, filename), 'utf8')
}

// Next weekday at 15:00 ET, at least 3 days out — a believable consultation slot.
function demoSlot(): { startIso: string; endIso: string } {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1)
  d.setUTCHours(19, 0, 0, 0) // 15:00 ET (EDT)
  return { startIso: d.toISOString(), endIso: new Date(d.getTime() + 30 * 60 * 1000).toISOString() }
}

async function existingDemoMatter(): Promise<string | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'email'
       JOIN relationship r ON r.source_entity_id = a.entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
       WHERE a.tenant_id = $1 AND lower(a.value #>> '{}') = $2
       LIMIT 1`,
      [TENANT_ID, DEMO_CLIENT_EMAIL],
    )
    return res.rows[0]?.id ?? null
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (set it in .env.local).')
  }

  const existing = await existingDemoMatter()
  if (existing) {
    console.log('✓ Demo matter already seeded (append-only substrate — no resets).')
    console.log(`  matter_entity_id = ${existing}`)
    printNextSteps(existing)
    return
  }

  console.log('▸ Loading questionnaire, transcript, and cached drafts from content/…')
  const questionnaire = loadJson<Record<string, unknown>>('questionnaire-response.json')
  const transcript = loadText('transcript.md')
  const cachedOa = loadText('cached-oa.md')
  const cachedEngagement = loadText('cached-engagement-letter.md')
  const oaTrace = loadJson<Record<string, unknown>>('oa-reasoning-trace.json')
  const engagementTrace = loadJson<Record<string, unknown>>(
    'engagement-letter-reasoning-trace.json',
  )

  console.log('▸ Booking the matter (intake.submit → matter.open → booking.create)…')
  const slot = demoSlot()
  const booking = await submitBooking(publicCtx, {
    clientFullName: 'Marcus Holloway',
    clientEmail: DEMO_CLIENT_EMAIL,
    clientPhone: '+1 828 555 0164',
    clientCompanyName: 'Pine Hollow Roasters',
    attributionSource: 'demo-seed',
    serviceKey: 'nc_llc_multi_member',
    intakeResponses: questionnaire,
    scheduledAtIso: slot.startIso,
    scheduledEndIso: slot.endIso,
  })
  const matterEntityId = (booking.effects[0] as { matterEntityId: string }).matterEntityId
  console.log(`  matter_entity_id = ${matterEntityId}`)

  console.log('▸ Recording the consultation (raw_event.ingest → call.ingest)…')
  await loadCall(publicCtx, {
    matterEntityId,
    externalCallId: 'granola-pinehollow-2026-05-22',
    startedAt: '2026-05-22T15:00:00-04:00',
    endedAt: '2026-05-22T15:27:00-04:00',
    transcriptText: transcript,
    transcriptSource: 'manual',
    rawPayload: {
      call_id: 'granola-pinehollow-2026-05-22',
      participants: ['Juan Carlos Pacheco', 'Marcus Holloway', 'Priya Iyer'],
      duration_seconds: 1620,
      source: 'demo-seed (in production this is the Granola webhook payload)',
    },
  })

  // The demo matter is a two-founder (multi-member) formation per REQ-DEMO-02;
  // the cached drafts exercise the full draft.generate + reasoning-trace path
  // without a live API call (Phase 0 auto-drafting itself is single-member only).
  console.log('▸ Caching OA draft + reasoning trace (draft.generate, no live API)…')
  await cacheDraft(attorneyCtx, {
    matterEntityId,
    documentKind: 'operating_agreement',
    documentMarkdown: cachedOa,
    prompt:
      'Drafting prompt for Pine Hollow Roasters operating agreement, assembled from drafting-prompt.md + questionnaire + transcript at seed time.',
    reasoningTrace: oaTrace as Parameters<typeof cacheDraft>[1]['reasoningTrace'],
    modelIdentity: (oaTrace['model_identity'] as string) ?? 'cached-demo-draft',
  })

  console.log('▸ Caching engagement letter draft + reasoning trace…')
  await cacheDraft(attorneyCtx, {
    matterEntityId,
    documentKind: 'engagement_letter',
    documentMarkdown: cachedEngagement,
    prompt:
      'Drafting prompt for Pine Hollow Roasters engagement letter, assembled from drafting-prompt.md + questionnaire + transcript at seed time.',
    reasoningTrace: engagementTrace as Parameters<typeof cacheDraft>[1]['reasoningTrace'],
    modelIdentity: (engagementTrace['model_identity'] as string) ?? 'cached-demo-draft',
  })

  console.log('')
  console.log('✓ Demo seed complete (every step an audited action).')
  printNextSteps(matterEntityId)
}

function printNextSteps(matterEntityId: string): void {
  console.log('')
  console.log('  Matter entity:  ' + matterEntityId)
  console.log('')
  console.log('  Start the processes in two terminals:')
  console.log('    pnpm dev:web      (Next.js app on :3000 — attorney + client portal)')
  console.log('    pnpm dev:worker   (async drafting + notifications + Granola projection)')
  console.log('')
  console.log('  Attorney app:   http://localhost:3000/attorney?demo_user=juan-carlos')
  console.log('  Booking page:   http://localhost:3000/book')
  console.log('')
  console.log('  Then run pnpm preflight to confirm everything is reachable.')
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('✗ Seed failed:', error)
    try {
      await closeDbPool()
    } catch {
      // ignore
    }
    process.exit(1)
  })
