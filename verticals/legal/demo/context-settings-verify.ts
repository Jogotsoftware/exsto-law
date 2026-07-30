// CONTEXT-SETTINGS-1 — prod acceptance drive in the PACHECO LAW tenant.
//
// Proves, against the live database and through the action layer only:
//   1. The firm AI Context store round-trips (write → read), and the universal
//      base guidance resolves to the platform default until a firm overrides it.
//   2. A firm-wide instruction reaches a real service's drafting prompt.
//   3. The per-service instructions layer contains NO universal boilerplate and
//      no mustache slots, while the composed prompt the worker receives carries
//      both — the actual point of the change.
//   4. The chat scope router writes to the scope it names, and REFUSES to
//      promote a service-scoped instruction to a firm-wide write.
//   5. The user-level context file round-trips on the actor's own settings.
//
// CLEANS UP AFTER ITSELF: every fixture value written here is cleared at the
// end (the substrate keeps the history — these are append-only effective-dated
// facts — but the LIVE config is restored to exactly what it was before).
//
// Run: pnpm tsx verticals/legal/demo/context-settings-verify.ts
import 'dotenv/config'
import {
  getAiContextConfig,
  updateAiContextConfig,
  getDraftingPrompt,
  saveAiInstruction,
  getAssistantSettings,
  setAssistantSettings,
  DRAFTING_BASE_GUIDANCE,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

// Resolved fresh at the top of the run rather than hardcoded (the slug is the
// stable identifier; the id is not something to remember between sessions).
const PACHECO_SLUG = 'pacheco'

const UNIVERSAL_MARKERS = [
  'NEVER INVENT A VALUE',
  'NEVER WRITE REVIEW-STATE TEXT INTO THE DOCUMENT',
  'OUTPUT THE FINAL DOCUMENT ONLY',
]
const SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
]

const FIXTURE = 'FIXTURE(context-settings-verify): every document must be well formatted.'

let failures = 0
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main(): Promise<void> {
  const { withActionContext } = await import('@exsto/substrate')

  // Resolve the tenant + a human actor without hardcoding either.
  const bootstrap: ActionContext = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorId: '00000000-0000-0000-0001-000000000001',
  }
  const resolved = await withActionContext(bootstrap, async (client) => {
    const t = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM tenant WHERE public_slug = $1`,
      [PACHECO_SLUG],
    )
    return t.rows[0] ?? null
  })
  if (!resolved) throw new Error(`No tenant with slug "${PACHECO_SLUG}".`)
  console.log(`Tenant: ${resolved.name} (${resolved.id})`)

  const actor = await withActionContext(
    { tenantId: resolved.id, actorId: bootstrap.actorId },
    async (client) => {
      const a = await client.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM actor
        WHERE tenant_id = $1 AND actor_type = 'human' AND display_name ILIKE '%Pacheco%'
        ORDER BY created_at LIMIT 1`,
        [resolved.id],
      )
      return a.rows[0] ?? null
    },
  )
  if (!actor) throw new Error('No human actor found in the Pacheco tenant.')
  console.log(`Actor:  ${actor.display_name} (${actor.id})\n`)

  const ctx: ActionContext = { tenantId: resolved.id, actorId: actor.id }

  // Snapshot everything we are about to touch, so cleanup restores it exactly.
  const before = await getAiContextConfig(ctx)
  const beforeSettings = (await getAssistantSettings(ctx)) ?? {}

  try {
    console.log('1. Firm AI Context store')
    const written = await updateAiContextConfig(ctx, {
      appendDocumentGenerationInstruction: FIXTURE,
    })
    check(
      'write returns the appended instruction',
      written.documentGeneration.instructions.includes(FIXTURE),
    )
    const readBack = await getAiContextConfig(ctx)
    check(
      'read-back sees it (persisted, not just echoed)',
      readBack.documentGeneration.instructions.includes(FIXTURE),
    )
    check('version bumped', readBack.version > before.version)

    console.log('\n2 & 3. A real service’s drafting prompt')
    const services = await withActionContext(ctx, async (client) => {
      const r = await client.query<{ kind_name: string; documents: string[] }>(
        `SELECT kind_name, COALESCE(transitions->'documents','[]'::jsonb) AS documents
           FROM workflow_definition
          WHERE tenant_id = $1 AND valid_to IS NULL
            AND transitions->'drafting' IS NOT NULL
          ORDER BY kind_name`,
        [ctx.tenantId],
      )
      return r.rows
    })
    if (services.length === 0) throw new Error('No service with drafting config in this tenant.')
    for (const svc of services) {
      const kinds = Array.isArray(svc.documents) ? svc.documents : []
      for (const kind of kinds) {
        const doc = await getDraftingPrompt(ctx, svc.kind_name, kind)
        if (!doc) continue
        const label = `${svc.kind_name}/${kind} [${doc.source}]`
        if (doc.source === 'composed') {
          const inst = doc.instructionsText ?? ''
          check(
            `${label}: the attorney-editable layer has no universal boilerplate`,
            UNIVERSAL_MARKERS.every((m) => !inst.includes(m)),
            inst.slice(0, 120),
          )
          check(
            `${label}: the editable layer has no mustache slots`,
            SLOTS.every((s) => !inst.includes(s)),
          )
          check(
            `${label}: the composed prompt still carries the universal rules`,
            UNIVERSAL_MARKERS.every((m) => (doc.promptText ?? '').includes(m)),
          )
          check(
            `${label}: the composed prompt still carries every worker slot`,
            SLOTS.every((s) => (doc.promptText ?? '').includes(s)),
          )
          check(
            `${label}: the firm-wide instruction reached it`,
            (doc.promptText ?? '').includes(FIXTURE),
          )
        } else {
          console.log(`  NOTE  ${label}: hand-authored full prompt — left untouched by design`)
        }
      }
    }

    console.log('\n4. Chat scope routing')
    const savedFirm = await saveAiInstruction(ctx, {
      scope: 'firm_document_review',
      instruction: `${FIXTURE} (review)`,
    })
    check(
      'routes a firm review instruction and names the scope',
      savedFirm.scope === 'firm_document_review',
    )
    const afterRoute = await getAiContextConfig(ctx)
    check(
      '…and it actually landed',
      afterRoute.documentReview.instructions.some((i) => i.includes('(review)')),
    )

    let refused = false
    try {
      await saveAiInstruction(ctx, { scope: 'service_document_review', instruction: 'x' })
    } catch {
      refused = true
    }
    check(
      'REFUSES a service-scoped instruction with no service (never promotes it firm-wide)',
      refused,
    )

    console.log('\n5. User-level context file')
    await setAssistantSettings(ctx, { ...beforeSettings, contextMd: 'FIXTURE user context.' })
    const settingsBack = await getAssistantSettings(ctx)
    check(
      'round-trips on the actor’s own settings',
      settingsBack?.contextMd === 'FIXTURE user context.',
    )

    console.log('\n6. Base guidance defaults')
    check(
      'an un-overridden firm resolves to the platform universal rules',
      before.documentGeneration.baseGuidance === null &&
        DRAFTING_BASE_GUIDANCE.includes('NEVER INVENT A VALUE'),
    )
  } finally {
    // CLEAN UP — restore the live config to exactly its pre-run state.
    console.log('\nCleaning up fixtures…')
    await updateAiContextConfig(ctx, {
      documentGenerationInstructions: before.documentGeneration.instructions,
      documentReviewInstructions: before.documentReview.instructions,
      documentGenerationBaseGuidance: before.documentGeneration.baseGuidance,
      documentReviewBaseGuidance: before.documentReview.baseGuidance,
      firmContextMd: before.firmContextMd,
    })
    await setAssistantSettings(ctx, beforeSettings)
    const restored = await getAiContextConfig(ctx)
    const restoredSettings = await getAssistantSettings(ctx)
    check(
      'firm config restored to its pre-run state',
      JSON.stringify(restored.documentGeneration.instructions) ===
        JSON.stringify(before.documentGeneration.instructions) &&
        JSON.stringify(restored.documentReview.instructions) ===
          JSON.stringify(before.documentReview.instructions) &&
        restored.firmContextMd === before.firmContextMd,
    )
    check(
      'user context restored',
      (restoredSettings?.contextMd ?? null) === (beforeSettings.contextMd ?? null),
    )
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
