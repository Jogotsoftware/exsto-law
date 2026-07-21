// WF-RUNNER-TOOLBAR-1 — callAttorneyMcp used to throw a plain Error on any
// non-2xx, losing the HTTP status in the message string only. The runner's
// Continue button needs to tell a legal.matter.advance guard rejection (409)
// apart from a real failure so it can render in-modal guidance instead of a
// raw "Request failed (…): …" wall — so callAttorneyMcp now throws
// McpToolError, which carries `status` and the undecorated `detail` alongside
// the SAME `message` string every existing `e instanceof Error ? e.message :
// String(e)` catch site already reads. Stubs fetch, same pattern as
// mcp-client.test.ts (the sibling public-client test).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { callAttorneyMcp, McpToolError, SessionExpiredError } from '../lib/mcpAttorney'

function stubFetchOnce(status: number, body: unknown) {
  const text = JSON.stringify(body)
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('callAttorneyMcp — error shape', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('throws McpToolError with the status and undecorated detail on a 409 guard rejection', async () => {
    const guardMessage = "This step isn't finished by clicking Continue — it has its own action."
    stubFetchOnce(409, { error: guardMessage })

    let caught: unknown
    try {
      await callAttorneyMcp({ toolName: 'legal.matter.advance', input: {} })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).toBeInstanceOf(McpToolError)
    const err = caught as McpToolError
    expect(err.status).toBe(409)
    expect(err.detail).toBe(guardMessage)
    // Backward-compatible: every existing `e.message` catch site still reads
    // the same decorated string it always did.
    expect(err.message).toBe(`Request failed (409): ${guardMessage}`)
  })

  it('throws McpToolError on a plain 500 too (status distinguishes it from a 409 guard)', async () => {
    stubFetchOnce(500, { error: 'boom' })

    let caught: unknown
    try {
      await callAttorneyMcp({ toolName: 'legal.matter.advance', input: {} })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(McpToolError)
    expect((caught as McpToolError).status).toBe(500)
  })

  it('still throws SessionExpiredError (not McpToolError) on a 401', async () => {
    stubFetchOnce(401, { error: 'not signed in' })

    let caught: unknown
    try {
      await callAttorneyMcp({ toolName: 'legal.matter.advance', input: {} })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(SessionExpiredError)
    expect(caught).not.toBeInstanceOf(McpToolError)
  })
})
