// BUILDER-UX-3 (P11) — consultation capture became AUTOMATIC (call.ingest enqueues
// transcript_extraction on transcript arrival), so the composed capture stages are
// superseded out of the live service graphs: for each ACTIVE service whose current
// lifecycle carries an invoke_capability{transcript_extraction} stage, write version
// n+1 with that stage REMOVED and its inbound edge re-pointed to the stage's own
// target. LOSSLESS re-point (the STEP-EDITOR-1 discipline): only the inbound edge's
// `to` changes — its gate/via/on and every other stage's own edge stay byte-identical.
// Writes go through setServiceLifecycleAI (validate → reasoning trace → seal prior
// version → insert version n+1); running matters stay pinned to their bound version,
// and the per-transcript guard in call.ingest prevents double extraction while both
// paths coexist on in-flight matters.
//
// Prod check found exactly one carrier: attorney_letter_drafting (stage key
// capture_consultation, inbound edge re-points to draft_letter) — the sweep below
// still scans every active service rather than hardcoding it.
//
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux3-capture-supersede.ts show
//   node --import tsx --env-file=<main>/.env.local verticals/legal/demo/bux3-capture-supersede.ts apply
import '@exsto/legal'
import {
  getServiceLifecycle,
  listServicesIncludingInactive,
  setServiceLifecycleAI,
  type Lifecycle,
  type LifecycleStage,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // seeded Joe Pacheco (human)
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

function isCaptureStage(s: LifecycleStage): boolean {
  if (s.action?.kind !== 'invoke_capability') return false
  const cfg = (s.action.config ?? {}) as { capability_slug?: string }
  return (cfg.capability_slug ?? '').trim() === 'transcript_extraction'
}

// Remove ONE capture stage from the graph, re-pointing its inbound edge(s) to the
// stage's own target. Only `to` on the inbound edge changes; everything else is
// carried verbatim from the deep-cloned input.
function removeStage(graph: Lifecycle, stageKey: string): { graph: Lifecycle; notes: string[] } {
  const notes: string[] = []
  const stage = graph.find((s) => s.key === stageKey)
  if (!stage) throw new Error(`stage "${stageKey}" not found`)
  if (stage.terminal || stage.advances_to.length === 0) {
    throw new Error(`stage "${stageKey}" is terminal / has no outgoing edge — refusing to re-point`)
  }
  if (stage.advances_to.length > 1) {
    throw new Error(
      `stage "${stageKey}" has ${stage.advances_to.length} outgoing edges — not linear`,
    )
  }
  const target = stage.advances_to[0]!.to
  const next = graph.filter((s) => s.key !== stageKey)
  for (const s of next) {
    for (const e of s.advances_to) {
      if (e.to === stageKey) {
        e.to = target
        notes.push(`edge ${s.key} → ${stageKey} re-pointed to ${target} (gate/via/on untouched)`)
      }
    }
  }
  if (stage.entry) {
    const t = next.find((s) => s.key === target)
    if (!t) throw new Error(`re-point target "${target}" not found`)
    t.entry = true
    notes.push(`entry moved to ${target} (removed stage was the entry)`)
  }
  notes.push(`stage ${stageKey} removed; its edge to ${target} goes with it`)
  return { graph: next, notes }
}

interface Plan {
  serviceKey: string
  version: number
  before: Lifecycle
  after: Lifecycle
  removedKeys: string[]
  notes: string[]
}

async function collectPlans(): Promise<Plan[]> {
  const services = (await listServicesIncludingInactive(ctx)).filter((s) => s.isActive)
  const plans: Plan[] = []
  for (const s of services) {
    const current = await getServiceLifecycle(ctx, s.serviceKey)
    if (!current) continue
    const captureKeys = current.graph.filter(isCaptureStage).map((st) => st.key)
    if (captureKeys.length === 0) continue
    let working = structuredClone(current.graph) as Lifecycle
    const notes: string[] = []
    for (const key of captureKeys) {
      const r = removeStage(working, key)
      working = r.graph
      notes.push(...r.notes)
    }
    plans.push({
      serviceKey: s.serviceKey,
      version: current.version,
      before: current.graph,
      after: working,
      removedKeys: captureKeys,
      notes,
    })
  }
  return plans
}

async function show(): Promise<void> {
  const plans = await collectPlans()
  if (plans.length === 0) {
    console.log('No active service carries an invoke_capability{transcript_extraction} stage.')
    return
  }
  for (const p of plans) {
    console.log(`\n=== ${p.serviceKey} (v${p.version} → v${p.version + 1}) ===`)
    for (const n of p.notes) console.log(`  - ${n}`)
    console.log('--- before ---')
    console.log(JSON.stringify(p.before, null, 2))
    console.log('--- after ---')
    console.log(JSON.stringify(p.after, null, 2))
  }
}

async function apply(): Promise<void> {
  const plans = await collectPlans()
  if (plans.length === 0) {
    console.log('Nothing to supersede — no active service carries a capture stage.')
    return
  }
  for (const p of plans) {
    const res = await setServiceLifecycleAI(ctx, p.serviceKey, p.after, {
      conclusion:
        `P11 — consultation capture is automatic on transcript arrival; removed the composed ` +
        `transcript_extraction stage(s) ${p.removedKeys.map((k) => `"${k}"`).join(', ')} and ` +
        `re-pointed the inbound edge(s) to their target (lossless: only \`to\` changed; every ` +
        `other stage and edge carried verbatim). Running matters stay on their bound version.`,
      confidence: 0.9,
      modelIdentity: 'bux3-capture-supersede',
    })
    console.log(`wrote  ${p.serviceKey} v${res.version} (removed ${p.removedKeys.join(', ')})`)
  }
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
const cmd = process.argv[2]
if (cmd === 'apply') await apply()
else if (cmd === 'show') await show()
else console.error('usage: bux3-capture-supersede.ts show|apply')
