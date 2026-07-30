// SB-FIX-1 (defect 1) — the WIZARD-LOSES-ITS-PLACE reproduction harness.
//
// Drives the service builder through its OWN conversation surface — assistantChat(),
// the exact function the app's SSE route wraps — with the real Claude model, the
// seeded doctrine skill, the closed tool contracts and the real validators, against
// the REAL Pacheco Law tenant. Approvals call the SAME server functions the app's
// approve routes call, and each one auto-fires the app's exact hidden continuation,
// so the drive is the attorney's path end to end.
//
// Modeled on demo/builder-cert-1-drive.ts (the certification harness). Two
// differences: this one is SCRIPTED (one command replays the whole repro so it can
// be re-run before/after a fix), and it mirrors the CLIENT's own progress-strip
// derivation (apps/legal-demo/components/UnifiedAssistantChat.tsx BUILD_PHASES +
// approvedPhases) so the strip's claimed phase is recorded next to what the model
// actually proposed. That side-by-side is the defect.
//
// The scripted sequence is the reported repro, verbatim:
//   walkthrough → approve shell → approve template → approve questionnaire
//   → approve BILLING → "go back and change the intake questionnaire"
//   → approve the REVISED questionnaire → observe where the flow resumes.
//
//   node --import tsx --env-file=.env.local verticals/legal/demo/sb-fix-1-repro.ts run [state.json]
//   node --import tsx --env-file=.env.local verticals/legal/demo/sb-fix-1-repro.ts archive <serviceKey>
//
// It creates a REAL disabled draft service in Pacheco. `archive` disables it again;
// run it when the repro is done (substrate tables are trigger-protected against raw
// DELETE, so disable/archive through the action layer is the only cleanup path).
process.env.LEGAL_WORKFLOW_ENGINE = '1'
process.env.LEGAL_BUILD_WIZARD = '1'

import { writeFileSync } from 'node:fs'
import '@exsto/legal'
import { closeDbPool, withSuperuser } from '@exsto/shared'
import {
  assistantChat,
  createServiceAI,
  createTemplateAI,
  createQuestionnaireAI,
  setServiceLifecycleAI,
  createCostAI,
  setServiceActive,
  listServicesIncludingInactive,
  type AssistantChatReply,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'
import {
  BUILD_PHASES,
  buildPhaseNumber,
  currentBuildPhase,
  type BuildArtifact,
} from '@exsto/legal/build-order'

// Pacheco Law — resolved fresh (slug 'pacheco'); NOT 0000…0001, which is "Dev Firm".
const TENANT = 'ae5530a1-05c7-4241-a38e-79bd186c1bbb'
const MODEL_ID = 'anthropic:claude-opus-4-8' // the app's build-mode model upgrade

// The attorney's progress strip. Post-fix this comes from the ONE shared order
// (buildOrder.ts) the client strip also imports, so the repro records exactly what
// the attorney was shown rather than a copy that can drift from it again.

interface Recorded {
  step: string
  attorneySaid: string
  reply: string
  cards: string[]
  stripSays: string
  elapsedSeconds: number
}

interface DriveState {
  ctx: ActionContext
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  buildServiceKey: string | null
  pending: Partial<AssistantChatReply>
  approvedPhases: Set<string>
  record: Recorded[]
}

// Mirror apps/legal-demo/lib/buildHistoryContent.assistantHistoryContent.
function historyContent(reply: string, r: AssistantChatReply): string {
  const parts: string[] = []
  const n = r.buildQuestions?.length ?? 0
  if (n) parts.push(`asked the attorney ${n === 1 ? 'a question' : `${n} questions`} via cards`)
  for (const p of r.serviceProposals ?? [])
    parts.push(`proposed the service shell "${p.derivedKey ?? p.displayName ?? '?'}"`)
  for (const p of r.templateProposals ?? [])
    parts.push(`proposed a document template for "${p.serviceKey ?? '?'}"`)
  for (const p of r.questionnaireProposals ?? [])
    parts.push(`proposed the intake questionnaire for "${p.serviceKey ?? '?'}"`)
  for (const p of r.workflowProposals ?? [])
    parts.push(`proposed the workflow for "${p.serviceKey ?? '?'}"`)
  for (const p of r.costProposals ?? []) parts.push(`proposed billing for "${p.serviceKey ?? '?'}"`)
  for (const p of r.kindProposals ?? [])
    parts.push(`proposed a new data field "${p.kindName ?? '?'}"`)
  for (const p of r.enableProposals ?? []) parts.push(`proposed ENABLING "${p.serviceKey ?? '?'}"`)
  if (!parts.length) return reply
  const note =
    `this turn spoke through approval/question cards (the attorney acts on them in the UI): ` +
    `${parts.join('; ')}. The live state is in the Current-build brief above — re-read it; ` +
    `never repeat this note or any internal marker to the attorney.`
  return [reply, `⟦${note}⟧`].filter(Boolean).join('\n')
}

function cardNames(r: AssistantChatReply): string[] {
  const out: string[] = []
  if (r.serviceProposals?.length) out.push(`SERVICE×${r.serviceProposals.length}`)
  if (r.templateProposals?.length) out.push(`TEMPLATE×${r.templateProposals.length}`)
  if (r.questionnaireProposals?.length) out.push(`QUESTIONNAIRE×${r.questionnaireProposals.length}`)
  if (r.costProposals?.length) out.push(`COST×${r.costProposals.length}`)
  if (r.workflowProposals?.length) out.push(`WORKFLOW×${r.workflowProposals.length}`)
  if (r.enableProposals?.length) out.push(`ENABLE×${r.enableProposals.length}`)
  if (r.kindProposals?.length) out.push(`KIND×${r.kindProposals.length}`)
  if (r.buildQuestions?.length) out.push(`QUESTIONS×${r.buildQuestions.length}`)
  return out
}

// The strip the attorney is watching: "the first not-yet-approved phase is the one
// in progress" (UnifiedAssistantChat.tsx:3047).
function stripSays(s: DriveState): string {
  const phase = currentBuildPhase(s.approvedPhases, pendingArtifactsOf(s))
  return `Step ${buildPhaseNumber(phase)} of ${BUILD_PHASES.length} · ${phase.label}`
}

// The cards this drive has put on screen and not yet approved — the same set the
// app tracks client-side and sends with every build turn.
function pendingArtifactsOf(s: DriveState): BuildArtifact[] {
  const out: BuildArtifact[] = []
  if (s.pending.serviceProposals?.length) out.push('service')
  if (s.pending.templateProposals?.length) out.push('template')
  if (s.pending.questionnaireProposals?.length) out.push('questionnaire')
  if (s.pending.costProposals?.length) out.push('billing')
  if (s.pending.workflowProposals?.length) out.push('workflow')
  if (s.pending.enableProposals?.length) out.push('enable')
  return out
}

// A question card's choices are { value, label, hint } objects, not strings — click
// the first one (its label is what the attorney would see), else answer in words.
function choiceOf(
  q: { choices?: Array<{ label?: string; value?: string }> },
  fallback: string,
): string {
  const first = q.choices?.[0]
  return first?.label ?? first?.value ?? fallback
}

async function turn(s: DriveState, step: string, message: string): Promise<AssistantChatReply> {
  const started = Date.now()
  const r = await assistantChat(s.ctx, {
    message,
    modelId: MODEL_ID,
    history: s.history,
    buildMode: true,
    buildServiceKey: s.buildServiceKey ?? undefined,
    // SB-FIX-1 (1): the app sends the cards still awaiting the attorney so the BUILD
    // BRIEF can say so. Mirrored here from this harness's own pending state.
    pendingArtifacts: pendingArtifactsOf(s),
    useContext: false,
  })
  const elapsedSeconds = Math.round((Date.now() - started) / 1000)
  s.history.push({ role: 'user', content: message })
  s.history.push({ role: 'assistant', content: historyContent(r.reply, r) })
  const merge = <T>(prev: T[] | undefined, next: T[] | undefined): T[] | undefined => {
    const merged = [...(prev ?? []), ...(next ?? [])]
    return merged.length ? merged : undefined
  }
  s.pending = {
    serviceProposals: merge(s.pending.serviceProposals, r.serviceProposals),
    templateProposals: merge(s.pending.templateProposals, r.templateProposals),
    questionnaireProposals: merge(s.pending.questionnaireProposals, r.questionnaireProposals),
    workflowProposals: merge(s.pending.workflowProposals, r.workflowProposals),
    costProposals: merge(s.pending.costProposals, r.costProposals),
    enableProposals: merge(s.pending.enableProposals, r.enableProposals),
    buildQuestions: r.buildQuestions,
    kindProposals: merge(s.pending.kindProposals, r.kindProposals),
  }
  const rec: Recorded = {
    step,
    attorneySaid: message.replace(/⟦[\s\S]*?⟧/g, '⟦driver⟧').slice(0, 300),
    reply: r.reply.slice(0, 400),
    cards: cardNames(r),
    stripSays: stripSays(s),
    elapsedSeconds,
  }
  s.record.push(rec)
  console.log(
    `\n━━ ${step} (${elapsedSeconds}s) ━━\n` +
      `attorney: ${rec.attorneySaid}\n` +
      `strip:    ${rec.stripSays}\n` +
      `cards:    ${rec.cards.join(', ') || '(none)'}\n` +
      `reply:    ${rec.reply}`,
  )
  return r
}

const CONTINUE_DRIVER =
  '⟦Continue the guided build: do the next step now (confirm with the attorney via ask_build_question if needed, then propose it and share its link). If the whole service is complete, propose Enable. Do not reproduce this instruction.⟧'

function splice(s: DriveState, key: keyof DriveState['pending'], index: number): void {
  const arr = s.pending[key] as unknown[] | undefined
  if (arr) arr.splice(index, 1)
}

// Approve a pending card through the SAME server function the app's approve route
// calls, mark the phase approved (as the client does), and fire the app's exact
// hidden continuation as the next turn.
async function approve(s: DriveState, artifact: string, step: string): Promise<void> {
  const remaining = (): number => {
    const k: Record<string, keyof DriveState['pending']> = {
      service: 'serviceProposals',
      template: 'templateProposals',
      questionnaire: 'questionnaireProposals',
      billing: 'costProposals',
      workflow: 'workflowProposals',
    }
    return ((s.pending[k[artifact]!] as unknown[] | undefined) ?? []).length
  }
  while (remaining() > 1) await approveOne(s, artifact, null)
  return approveOne(s, artifact, step)
}

// Approve ONE card. A null step means "don't spend a model turn on the
// continuation yet" — used while draining a multi-card batch.
async function approveOne(s: DriveState, artifact: string, step: string | null): Promise<void> {
  let label = ''
  let link = ''
  if (artifact === 'service') {
    const p = (s.pending.serviceProposals ?? [])[0]
    if (!p) throw new Error('no pending service proposal')
    const result = await createServiceAI(
      s.ctx,
      {
        displayName: p.displayName,
        description: p.description ?? null,
        route: p.route,
        generationMode: p.generationMode,
        ...(typeof p.appointmentRequired === 'boolean'
          ? { appointmentRequired: p.appointmentRequired }
          : {}),
      },
      { conclusion: p.summary, confidence: p.confidence },
    )
    s.buildServiceKey = result.serviceKey
    label = `Service "${p.displayName}"`
    link = `/attorney/services/${encodeURIComponent(result.serviceKey)}`
    splice(s, 'serviceProposals', 0)
  } else if (artifact === 'template') {
    const p = (s.pending.templateProposals ?? [])[0]
    if (!p) throw new Error('no pending template proposal')
    await createTemplateAI(
      s.ctx,
      p.serviceKey,
      {
        name: (p.name ?? '').trim() || p.docKind,
        body: p.body,
        docKind: p.docKind,
        category: 'document',
        ...(p.signature
          ? {
              signature: {
                required: p.signature.required === true,
                signer_roles: (p.signature.signer_roles ?? []) as Array<
                  'client' | 'attorney' | 'witness' | 'notary'
                >,
              },
            }
          : {}),
      },
      { conclusion: p.summary, confidence: p.confidence },
    )
    label = `Template "${(p.name ?? '').trim() || p.docKind}"`
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/templates`
    splice(s, 'templateProposals', 0)
  } else if (artifact === 'questionnaire') {
    const p = (s.pending.questionnaireProposals ?? [])[0]
    if (!p) throw new Error('no pending questionnaire proposal')
    await createQuestionnaireAI(s.ctx, p.serviceKey, p.schema, {
      conclusion: p.summary,
      confidence: p.confidence,
    })
    label = 'Questionnaire'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/questionnaire`
    splice(s, 'questionnaireProposals', 0)
  } else if (artifact === 'billing') {
    const p = (s.pending.costProposals ?? [])[0]
    if (!p) throw new Error('no pending cost proposal')
    await createCostAI(
      s.ctx,
      p.serviceKey,
      { costType: p.costType, amount: p.amount, hours: p.hours ?? null },
      { conclusion: p.summary, confidence: p.confidence },
    )
    label = 'Billing'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/billing`
    splice(s, 'costProposals', 0)
  } else if (artifact === 'workflow') {
    const p = (s.pending.workflowProposals ?? [])[0]
    if (!p) throw new Error('no pending workflow proposal')
    await setServiceLifecycleAI(s.ctx, p.serviceKey, p.graph, {
      conclusion: p.summary,
      confidence: p.confidence,
    })
    label = 'Workflow'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/workflow`
    splice(s, 'workflowProposals', 0)
  } else {
    throw new Error(`unknown artifact: ${artifact}`)
  }
  // The client marks the phase approved — add-only, exactly as the app does
  // (UnifiedAssistantChat.tsx:2878 `next.add(info.artifact)`).
  s.approvedPhases.add(artifact)
  if (!step) return
  await turn(s, step, `✓ ${label} created (${link}).\n${CONTINUE_DRIVER}`)
}

// Answer a question batch the way the client does: one combined hidden continuation.
async function answer(s: DriveState, step: string, answers: Record<string, string>): Promise<void> {
  const combined = Object.entries(answers)
    .map(([k, v]) => `"${k}": ${v}`)
    .join('; ')
  await turn(s, step, `My answers — ${combined}.\n⟦Continue the guided build.⟧`)
}

const WALKTHROUGH =
  'This is a service for a consulting services agreement. The client books it from ' +
  'my site, tells me who the contractor is and what the scope and pay terms are, the ' +
  'agreement drafts from their answers, I review it before anything goes out, then both ' +
  'sides e-sign it. Flat $350, charged when I approve the agreement. There is also an ' +
  'engagement letter they sign up front.'

async function run(outFile: string): Promise<void> {
  const attorneyId = await resolveAttorney()
  const s: DriveState = {
    ctx: { tenantId: TENANT, actorId: attorneyId },
    history: [],
    buildServiceKey: null,
    pending: {},
    approvedPhases: new Set(),
    record: [],
  }
  console.log(`Pacheco tenant ${TENANT}, attorney actor ${attorneyId}`)

  // 1. The opener the Build button primes, answered with the walkthrough.
  await turn(
    s,
    '1-walkthrough',
    `My answer to "walkthrough": ${WALKTHROUGH}\n⟦Continue the guided build.⟧`,
  )
  // The model may ask one confirmation batch before the shell. Answer generically
  // so the drive reaches the shell without an operator.
  for (let i = 0; i < 3 && !(s.pending.serviceProposals ?? []).length; i++) {
    const qs = s.pending.buildQuestions ?? []
    if (!qs.length) break
    const answers: Record<string, string> = {}
    for (const q of qs) answers[q.key] = choiceOf(q, 'Yes, that is right')
    await answer(s, `1${'abc'[i]}-confirm`, answers)
  }

  // The reuse-first rule means the model may skip the shell and build onto an
  // existing service. Approve a shell if it proposed one; otherwise adopt the key
  // its first card names, so the drive reaches the part being tested either way.
  if ((s.pending.serviceProposals ?? []).length) {
    await approve(s, 'service', '2-after-shell-approved')
  } else {
    const adopted =
      (s.pending.templateProposals ?? [])[0]?.serviceKey ??
      (s.pending.questionnaireProposals ?? [])[0]?.serviceKey ??
      null
    if (!adopted) throw new Error('no shell proposed and no card names a service to adopt')
    const live = await listServicesIncludingInactive(s.ctx)
    if (!live.some((x) => x.serviceKey === adopted)) {
      throw new Error(
        `the model proposed against "${adopted}", which is not a live service (retired?) — ` +
          `it skipped the shell for a service that does not exist`,
      )
    }
    s.buildServiceKey = adopted
    s.approvedPhases.add('service')
    console.log(`(reused existing service ${adopted} — no shell proposed)`)
  }
  await approve(s, 'template', '3-after-template-approved')
  await approve(s, 'questionnaire', '4-after-questionnaire-approved')

  // The model may put a question batch between artifacts; keep answering until a
  // cost card is on the table, so the repro reaches the billing approval.
  for (let i = 0; i < 3 && !(s.pending.costProposals ?? []).length; i++) {
    const qs = s.pending.buildQuestions ?? []
    if (!qs.length) break
    const answers: Record<string, string> = {}
    for (const q of qs) answers[q.key] = choiceOf(q, 'Whatever you recommend')
    await answer(s, `4${'abc'[i]}-confirm`, answers)
  }

  // ── THE REPRO ────────────────────────────────────────────────────────────
  // Billing is approved…
  await approve(s, 'billing', '5-AFTER-BILLING-APPROVED')
  // …then the attorney goes BACK to change the intake questionnaire.
  await turn(
    s,
    '6-GO-BACK-TO-INTAKE',
    'hold on — go back to the intake form. I also want it to ask how they heard about ' +
      'the firm.',
  )
  for (let i = 0; i < 2 && !(s.pending.questionnaireProposals ?? []).length; i++) {
    const qs = s.pending.buildQuestions ?? []
    if (!qs.length) break
    const answers: Record<string, string> = {}
    for (const q of qs) answers[q.key] = choiceOf(q, 'Yes')
    await answer(s, `6${'ab'[i]}-confirm`, answers)
  }
  // …approves the revised questionnaire. WHERE DOES THE FLOW RESUME?
  await approve(s, 'questionnaire', '7-AFTER-REVISED-INTAKE-APPROVED')

  writeFileSync(
    outFile,
    JSON.stringify(
      { serviceKey: s.buildServiceKey, approvedPhases: [...s.approvedPhases], record: s.record },
      null,
      2,
    ),
  )
  console.log(`\n\n═══ SUMMARY ═══`)
  console.log(`service under construction: ${s.buildServiceKey}`)
  for (const r of s.record) {
    console.log(`${r.step.padEnd(34)} strip:${r.stripSays.padEnd(30)} cards:${r.cards.join(',')}`)
  }
  console.log(`\nwrote ${outFile}`)
  console.log(
    `\nCLEAN UP:  node --import tsx --env-file=.env.local ` +
      `verticals/legal/demo/sb-fix-1-repro.ts archive ${s.buildServiceKey}`,
  )
}

// The seeded human attorney actor for Pacheco (reads run as the attorney; every AI
// write inside the approve fns re-attributes to the Claude agent actor).
async function resolveAttorney(): Promise<string> {
  return withSuperuser(async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id = $1 AND actor_type = 'human' ORDER BY created_at LIMIT 1`,
      [TENANT],
    )
    const id = r.rows[0]?.id
    if (!id) throw new Error('no human actor in the Pacheco tenant')
    return id
  })
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'archive') {
    if (!arg) throw new Error('usage: archive <serviceKey>')
    const attorneyId = await resolveAttorney()
    await setServiceActive({ tenantId: TENANT, actorId: attorneyId }, arg, false)
    console.log(`disabled ${arg}`)
    return
  }
  if (cmd !== 'run') throw new Error('usage: run [state.json] | archive <serviceKey>')
  await run(arg || 'sb-fix-1-repro.json')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDbPool())
