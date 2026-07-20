// WF-RUNNER-TOOLBAR-1 — legal.matter.advance's GUARD 2 (a bare Continue can't
// finish a step whose edge names its own completing action, e.g. a review
// step's draft.approve) used to throw a plain Error, which the generic MCP
// route (apps/legal-demo/app/api/attorney/mcp/route.ts) always turned into a
// 500 — indistinguishable from a real server fault, and rendered client-side
// as a raw "Request failed (500): …" wall. WorkflowAdvanceGuardError carries
// the status (409) the route now reads, so the guard is a proper 4xx and the
// runner's Continue button can render it as in-modal guidance instead. Pure
// unit test — no DB — pinning the error's shape (the route/client integration
// is exercised by the app-level surfaces themselves).
import { describe, it, expect } from 'vitest'
import { WorkflowAdvanceGuardError } from '@exsto/legal'

describe('WorkflowAdvanceGuardError', () => {
  it('is a real Error carrying a 409 status and the guard message verbatim', () => {
    const message =
      "This step isn't finished by clicking Continue — it has its own action to complete it " +
      '(for a review step, open it and approve/send the document). ' +
      'Finish that step to move the matter forward.'
    const err = new WorkflowAdvanceGuardError(message)

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(WorkflowAdvanceGuardError)
    expect(err.name).toBe('WorkflowAdvanceGuardError')
    expect(err.status).toBe(409)
    expect(err.message).toBe(message)
  })
})
