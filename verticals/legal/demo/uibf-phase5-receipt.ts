// UI-BUILDER-FIX-1 Phase 5 receipt — TWO separate build sessions against prod:
// distinct session entities, each with exactly the messages said in that build,
// then closed. Proves the session mechanics through the action layer (the chat
// integration rides the same functions server-side).
import { pathToFileURL } from 'node:url'
import type { ActionContext } from '@exsto/substrate'
import {
  startBuildSession,
  appendBuildMessages,
  closeBuildSession,
  isOpenBuildSession,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const ctx: ActionContext = { tenantId: TENANT, actorId: ATTORNEY }

async function main(): Promise<void> {
  // Build 1: two exchanges (4 messages).
  const a = await startBuildSession(ctx, { serviceKey: null })
  await appendBuildMessages(ctx, a.buildSessionId, [
    { role: 'user', content: 'Build me a trademark registration service.' },
    { role: 'assistant', content: 'Tell me about the client and the outcome.' },
  ])
  await appendBuildMessages(ctx, a.buildSessionId, [
    { role: 'user', content: 'Small businesses; they walk away with a filed mark.' },
    { role: 'assistant', content: 'Got it — proposing the service shell.' },
  ])
  console.log('session A open:', await isOpenBuildSession(ctx, a.buildSessionId))
  await closeBuildSession(ctx, a.buildSessionId, 'completed')
  console.log('session A open after close:', await isOpenBuildSession(ctx, a.buildSessionId))

  // Build 2: one exchange (2 messages) — a NEW session, never A's.
  const b = await startBuildSession(ctx, { serviceKey: null })
  await appendBuildMessages(ctx, b.buildSessionId, [
    { role: 'user', content: 'Now a separate lease-abstract service.' },
    { role: 'assistant', content: 'Understood — a fresh build, new session.' },
  ])
  await closeBuildSession(ctx, b.buildSessionId, 'completed')

  console.log('A =', a.buildSessionId)
  console.log('B =', b.buildSessionId)
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
    .then(() => closeDbPool())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
