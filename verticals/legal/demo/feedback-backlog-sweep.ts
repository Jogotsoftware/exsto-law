// One-shot beta-feedback backlog sweep (manager coordination), THROUGH THE CORE.
//
// CLAIMS ONLY — reversible. Marks each open item whose page area is owned by an
// active branch as in_progress (claimed by that branch), so parallel sessions stop
// duplicating them. It does NOT resolve anything: resolution is irreversible and
// belongs to the session that actually shipped the work (the standing rule), so
// "looks shipped" candidates are reported, not auto-resolved here. Items with no
// clear active owner are left open and reported.
//
// Attributed to the Claude agent actor (tenant zero) — this is an agent action.
// Run: tsx --env-file=.env.local verticals/legal/demo/feedback-backlog-sweep.ts
import { closeDbPool } from '@exsto/shared'
import { type ActionContext } from '@exsto/substrate'
import { claimFeedback, listFeedbackBacklog } from '@exsto/legal'
import '@exsto/legal'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000004', // Claude (agent/claude), tenant zero
}

// link_path prefix → the active branch that owns that area (most specific first).
const CLAIM_RULES: Array<[RegExp, string]> = [
  [/^\/attorney\/templates/, 'feat/integrate-tiptap-templates'],
  [/^\/attorney\/services\/[^/]+\/templates/, 'feat/integrate-tiptap-templates'],
  [/^\/attorney\/services/, 'feat/service-create-wizard'],
  [/^\/attorney\/calendar/, 'feat/calendar-grid'],
  [/^\/attorney\/mail/, 'feat/mail-send-perms'],
  [/^\/attorney\/matters/, 'feat/matter-tabs'],
]

function claimFor(linkPath: string | null): string | null {
  if (!linkPath) return null
  for (const [re, branch] of CLAIM_RULES) if (re.test(linkPath)) return branch
  return null
}

async function main(): Promise<void> {
  const { items, counts } = await listFeedbackBacklog(ctx, { status: 'open' })
  console.log(`Open backlog: ${items.length} (overall counts: ${JSON.stringify(counts)})\n`)

  const claimedByBranch: Record<string, number> = {}
  const left: string[] = []

  for (const it of items) {
    const short = it.feedbackEventId.slice(0, 8)
    const branch = claimFor(it.linkPath)
    if (branch) {
      await claimFeedback(ctx, {
        feedbackEventId: it.feedbackEventId,
        claimedBy: branch,
        note: `Backlog sweep: ${it.linkPath} is being worked on ${branch}.`,
      })
      claimedByBranch[branch] = (claimedByBranch[branch] ?? 0) + 1
      continue
    }
    left.push(`${short} [${it.category}] ${it.linkPath ?? '(none)'} — ${it.excerpt.slice(0, 70)}`)
  }

  console.log(`\n✓ Sweep complete (claims only — nothing resolved).`)
  console.log(`  claimed (in_progress):`)
  for (const [b, n] of Object.entries(claimedByBranch).sort((a, b) => b[1] - a[1]))
    console.log(`     ${n.toString().padStart(2)}  ${b}`)
  console.log(`  left OPEN (no clear owner) — ${left.length}:`)
  for (const l of left) console.log(`     ${l}`)
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('✗ Sweep failed:', e)
    try {
      await closeDbPool()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
