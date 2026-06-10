import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { closeDbPool, withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { cacheDraft, createMatter, loadCall, submitQuestionnaire } from '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ATTORNEY_ACTOR_ID = '00000000-0000-0000-0000-000000000002'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = resolve(here, 'content')

const ctx: ActionContext = {
  tenantId: TENANT_ID,
  actorId: ATTORNEY_ACTOR_ID,
}

function loadJson<T>(filename: string): T {
  const raw = readFileSync(resolve(contentDir, filename), 'utf8')
  return JSON.parse(raw) as T
}

function loadText(filename: string): string {
  return readFileSync(resolve(contentDir, filename), 'utf8')
}

interface QuestionnaireResponse {
  company_name: string
  members: Array<{
    name: string
    address: string
    capital_contribution: number
    ownership_percentage: number
    is_manager: boolean
  }>
  [k: string]: unknown
}

async function resetTenantData(): Promise<void> {
  await withSuperuser(async (client) => {
    // Children-first deletion order. Definition rows (entity_kind_definition,
    // attribute_kind_definition, relationship_kind_definition,
    // action_kind_definition) and identities (tenant, actor) survive — only
    // the matter-level data resets.
    const tables = [
      'document_version',
      'content_blob',
      'relationship',
      'attribute',
      'entity',
      'raw_event_log',
      'action',
      'reasoning_trace',
    ]
    for (const table of tables) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT_ID])
    }
  })
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required. Run: pnpm seed:demo with .env.local in place, or set DATABASE_URL inline.',
    )
  }

  console.log('▸ Resetting Pacheco Law tenant data…')
  await resetTenantData()

  console.log('▸ Loading questionnaire response, transcript, and cached drafts from content/…')
  const questionnaire = loadJson<QuestionnaireResponse>('questionnaire-response.json')
  const transcript = loadText('transcript.md')
  const cachedOa = loadText('cached-oa.md')
  const cachedEngagement = loadText('cached-engagement-letter.md')
  const oaTrace = loadJson<Record<string, unknown>>('oa-reasoning-trace.json')
  const engagementTrace = loadJson<Record<string, unknown>>(
    'engagement-letter-reasoning-trace.json',
  )

  console.log('▸ Creating matter (legal.matter.create)…')
  const matterResult = await createMatter(ctx, {
    matterNumber: 'M-2026-0042',
    clientFullName: questionnaire.members[0]!.name,
    clientEmail: 'marcus@pinehollowroasters.example',
    practiceArea: 'business_formation',
    summary: `Formation of ${questionnaire.company_name}, LLC — two-member manager-managed NC LLC for a specialty coffee roaster + retail café in Asheville.`,
  })
  const matterEntityId = (matterResult.effects[0] as { matterEntityId: string }).matterEntityId
  console.log(`  matter_entity_id = ${matterEntityId}`)

  console.log('▸ Submitting questionnaire (legal.questionnaire.submit)…')
  await submitQuestionnaire(ctx, {
    matterEntityId,
    templateId: 'intake-questionnaire-oa',
    responses: questionnaire as unknown as Record<string, unknown>,
  })

  console.log('▸ Recording consultation call + transcript (legal.call.simulate)…')
  await loadCall(ctx, {
    matterEntityId,
    externalCallId: 'granola-pinehollow-2026-05-22',
    startedAt: '2026-05-22T15:00:00-04:00',
    endedAt: '2026-05-22T15:27:00-04:00',
    transcriptText: transcript,
    transcriptSource: 'manual',
    rawPayload: {
      external_call_id: 'granola-pinehollow-2026-05-22',
      participants: ['Juan Carlos Pacheco', 'Marcus Holloway', 'Priya Iyer'],
      duration_seconds: 1620,
      source: 'demo-seed (pre-loaded; in production this is the Granola webhook payload)',
    },
  })

  console.log('▸ Caching OA draft + reasoning trace (legal.draft.generate, no live API call)…')
  await cacheDraft(ctx, {
    matterEntityId,
    documentKind: 'operating_agreement',
    documentMarkdown: cachedOa,
    prompt:
      'Drafting prompt for Pine Hollow Roasters operating agreement, assembled from drafting-prompt.md + questionnaire + transcript at seed time.',
    reasoningTrace: oaTrace as Parameters<typeof cacheDraft>[1]['reasoningTrace'],
    modelIdentity: (oaTrace['model_identity'] as string) ?? 'claude-sonnet-4-6',
  })

  console.log('▸ Caching engagement letter draft + reasoning trace…')
  await cacheDraft(ctx, {
    matterEntityId,
    documentKind: 'engagement_letter',
    documentMarkdown: cachedEngagement,
    prompt:
      'Drafting prompt for Pine Hollow Roasters engagement letter, assembled from drafting-prompt.md + questionnaire + transcript at seed time.',
    reasoningTrace: engagementTrace as Parameters<typeof cacheDraft>[1]['reasoningTrace'],
    modelIdentity: (engagementTrace['model_identity'] as string) ?? 'claude-sonnet-4-6',
  })

  console.log('')
  console.log('✓ Demo seed complete.')
  console.log('')
  console.log('  Matter entity:  ' + matterEntityId)
  console.log('')
  console.log('  Attorney app:   http://localhost:3001/?demo_user=juan-carlos')
  console.log('  Client portal:  http://localhost:3002/?demo_user=marcus-holloway')
  console.log('')
  console.log('  Start the processes in three terminals:')
  console.log('    pnpm dev:mcp')
  console.log('    pnpm dev:attorney')
  console.log('    pnpm dev:client')
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
