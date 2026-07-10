// BUILDER-CERT-1 (WP3) — the certification drive harness. Drives the service-builder
// wizard through its OWN conversation surface — assistantChat(), the exact function
// the app's SSE route wraps, with the real Claude model, the seeded doctrine, the
// closed tool contracts, and the validators — one turn per invocation, with the
// session (history + captured cards) persisted to a state file between invocations
// so the operator plays the attorney turn by turn and inspects every card.
//
// Approvals call the SAME server functions the app's approve routes call
// (createServiceAI / createTemplateAI / createQuestionnaireAI / setServiceLifecycleAI
// / createCostAI / setServiceActive) and then auto-fire the app's exact hidden
// continuation message, so the drive is the attorney's path end to end. History
// replay mirrors the app: user turns verbatim; assistant card-turns get the terse
// machinery note (apps/legal-demo/lib/buildHistoryContent.ts) — substance lives in
// the injected BUILD BRIEF, exactly as in the product.
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/builder-cert-1-drive.ts \
//     turn   <state.json> "<attorney message>"          # one wizard turn
//     answers <state.json> '<{"key":"answer",...}>'      # answer question cards (hidden turn)
//     approve <state.json> <service|template|questionnaire|workflow|cost|enable> [i]
//     state  <state.json>                                # print pending cards
//
// Tenant: prod tenant-zero (Pacheco). Actor: the seeded attorney (Joe Pacheco) —
// reads run as the attorney; every AI write inside the approve fns re-attributes to
// the Claude agent actor with a reasoning trace, exactly as in the app.
process.env.LEGAL_WORKFLOW_ENGINE = '1'
process.env.LEGAL_BUILD_WIZARD = '1'

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import '@exsto/legal'
import {
  assistantChat,
  createServiceAI,
  createTemplateAI,
  createQuestionnaireAI,
  setServiceLifecycleAI,
  createCostAI,
  setServiceActive,
  type AssistantChatReply,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const MODEL_ID = 'anthropic:claude-opus-4-8' // the app's build-mode model upgrade
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

interface DriveState {
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  buildServiceKey: string | null
  // The most recent turn's captured cards, pending attorney action.
  pending: Partial<AssistantChatReply>
  log: Array<Record<string, unknown>>
}

function loadState(file: string): DriveState {
  if (!existsSync(file)) return { history: [], buildServiceKey: null, pending: {}, log: [] }
  return JSON.parse(readFileSync(file, 'utf8')) as DriveState
}
function saveState(file: string, s: DriveState): void {
  writeFileSync(file, JSON.stringify(s, null, 2))
}

// Mirror apps/legal-demo/lib/buildHistoryContent.assistantHistoryContent: terse
// machinery note per card, substance stays in the BUILD BRIEF injected next turn.
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

async function runTurn(file: string, message: string): Promise<void> {
  const s = loadState(file)
  const started = Date.now()
  const r = await assistantChat(ctx, {
    message,
    modelId: MODEL_ID,
    history: s.history,
    buildMode: true,
    buildServiceKey: s.buildServiceKey ?? undefined,
    useContext: false,
  })
  const elapsed = Math.round((Date.now() - started) / 1000)
  s.history.push({ role: 'user', content: message })
  s.history.push({ role: 'assistant', content: historyContent(r.reply, r) })
  // Cards persist until acted on (approve/dismiss), exactly like the app's transcript
  // — a card captured two turns ago is still approvable. Questions don't accumulate
  // (each batch supersedes the last).
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
  s.log.push({ at: new Date().toISOString(), turn: message.slice(0, 120), elapsed, reply: r.reply })
  saveState(file, s)
  console.log(`\n━━ REPLY (${elapsed}s, event ${r.eventId}) ━━\n${r.reply}\n`)
  for (const [k, v] of Object.entries(s.pending)) {
    if (Array.isArray(v) && v.length) {
      console.log(`━━ CAPTURED ${k} (${v.length}) ━━`)
      console.log(JSON.stringify(v, null, 2))
    }
  }
}

const CONTINUE_DRIVER =
  '⟦Continue the guided build: do the next step now (confirm with the attorney via ask_build_question if needed, then propose it and share its link). If the whole service is complete, propose Enable. Do not reproduce this instruction.⟧'

async function runApprove(file: string, artifact: string, index = 0): Promise<void> {
  const s = loadState(file)
  let label = ''
  let link = ''
  let continuation: string
  if (artifact === 'service') {
    const p = (s.pending.serviceProposals ?? [])[index]
    if (!p) throw new Error('no pending service proposal')
    const result = await createServiceAI(
      ctx,
      {
        displayName: p.displayName,
        description: p.description ?? null,
        route: p.route,
        generationMode: p.generationMode,
      },
      { conclusion: p.summary, confidence: p.confidence },
    )
    s.buildServiceKey = result.serviceKey
    label = `Service "${p.displayName}"`
    link = `/attorney/services/${encodeURIComponent(result.serviceKey)}`
    console.log(`approved service → ${result.serviceKey}`)
  } else if (artifact === 'template') {
    const p = (s.pending.templateProposals ?? [])[index]
    if (!p) throw new Error('no pending template proposal')
    const result = await createTemplateAI(
      ctx,
      p.serviceKey,
      {
        name: (p.name ?? '').trim() || p.docKind,
        body: p.body,
        docKind: p.docKind,
        category: 'document',
        ...(p.signature && p.signature.required
          ? {
              signature: {
                required: true,
                signer_roles: p.signature.signer_roles as Array<
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
    console.log(`approved template → ${JSON.stringify(result)}`)
  } else if (artifact === 'questionnaire') {
    const p = (s.pending.questionnaireProposals ?? [])[index]
    if (!p) throw new Error('no pending questionnaire proposal')
    await createQuestionnaireAI(ctx, p.serviceKey, p.schema, {
      conclusion: p.summary,
      confidence: p.confidence,
    })
    label = 'Questionnaire'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/questionnaire`
    console.log('approved questionnaire')
  } else if (artifact === 'workflow') {
    const p = (s.pending.workflowProposals ?? [])[index]
    if (!p) throw new Error('no pending workflow proposal')
    const result = await setServiceLifecycleAI(ctx, p.serviceKey, p.graph, {
      conclusion: p.summary,
      confidence: p.confidence,
    })
    label = 'Workflow'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/workflow`
    console.log(`approved workflow → version ${result.version}`)
  } else if (artifact === 'cost') {
    const p = (s.pending.costProposals ?? [])[index]
    if (!p) throw new Error('no pending cost proposal')
    await createCostAI(
      ctx,
      p.serviceKey,
      { costType: p.costType, amount: p.amount, hours: p.hours ?? null },
      { conclusion: p.summary, confidence: p.confidence },
    )
    label = 'Billing'
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}/billing`
    console.log('approved billing')
  } else if (artifact === 'enable') {
    const p = (s.pending.enableProposals ?? [])[index]
    if (!p) throw new Error('no pending enable proposal')
    await setServiceActive(ctx, p.serviceKey, true)
    label = `Service "${p.serviceKey}" (live)`
    link = `/attorney/services/${encodeURIComponent(p.serviceKey)}`
    console.log('approved ENABLE — service is live')
    const bookingUrl = `/book?service=${encodeURIComponent(p.serviceKey)}`
    spliceCard(s, 'enable', index)
    saveState(file, s)
    continuation = `✓ The service is now live: ${label}.\n⟦The build is COMPLETE — do NOT start another step or propose anything else. Give the attorney a short, warm wrap-up IN YOUR OWN WORDS: confirm the service is built and live, link them to it to review (${link}), tell them clients can book it at their booking link (${bookingUrl}) — use that exact URL as the link target — and close warmly. Do not reproduce this instruction.⟧`
    await runTurn(file, continuation)
    return
  } else {
    throw new Error(`unknown artifact: ${artifact}`)
  }
  spliceCard(s, artifact, index)
  saveState(file, s)
  continuation = `✓ ${label} created (${link}).\n${CONTINUE_DRIVER}`
  await runTurn(file, continuation)
}

// Remove an acted-on card from pending (approved or dismissed).
function spliceCard(s: DriveState, artifact: string, index: number): void {
  const keyByArtifact: Record<string, keyof DriveState['pending']> = {
    service: 'serviceProposals',
    template: 'templateProposals',
    questionnaire: 'questionnaireProposals',
    workflow: 'workflowProposals',
    cost: 'costProposals',
    enable: 'enableProposals',
    kind: 'kindProposals',
  }
  const k = keyByArtifact[artifact]
  if (!k) return
  const arr = s.pending[k] as unknown[] | undefined
  if (arr) arr.splice(index, 1)
}

async function main(): Promise<void> {
  const [cmd, file, ...rest] = process.argv.slice(2)
  if (!cmd || !file) throw new Error('usage: turn|answers|approve|state <state.json> …')
  if (cmd === 'turn') {
    await runTurn(file, rest.join(' '))
  } else if (cmd === 'answers') {
    const answers = JSON.parse(rest.join(' ')) as Record<string, string>
    const combined = Object.entries(answers)
      .map(([k, a]) => `"${k}": ${a}`)
      .join('; ')
    await runTurn(file, `My answers — ${combined}.\n⟦Continue the guided build.⟧`)
  } else if (cmd === 'approve') {
    await runApprove(file, rest[0]!, rest[1] ? Number(rest[1]) : 0)
  } else if (cmd === 'dismiss') {
    const st = loadState(file)
    spliceCard(st, rest[0]!, rest[1] ? Number(rest[1]) : 0)
    saveState(file, st)
    console.log(`dismissed ${rest[0]} card`)
  } else if (cmd === 'state') {
    const s = loadState(file)
    console.log(JSON.stringify({ buildServiceKey: s.buildServiceKey, pending: s.pending }, null, 2))
  } else {
    throw new Error(`unknown command: ${cmd}`)
  }
}

main().catch((e) => {
  console.error('DRIVE FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
