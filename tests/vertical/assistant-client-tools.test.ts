// ITEM 2 (assistant model-driven tools): the Claude adapter advertises client
// tools (e.g. log_feedback) and runs a tool_use → tool_result loop. These pin the
// pure loop helpers — no live model or DB needed. The executor's write path
// (submitAssistantFeedback) is covered by feedback-category.test.ts.
import { describe, it, expect } from 'vitest'
import { clientToolUses, runClientTools, type ClientTool } from '@exsto/legal'

describe('assistant client-tool loop', () => {
  it('extracts tool_use blocks, ignoring text and server tools (web_search)', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} },
      { type: 'tool_use', id: 'tu1', name: 'log_feedback', input: { summary: 'x' } },
    ]
    const uses = clientToolUses(content)
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ id: 'tu1', name: 'log_feedback', input: { summary: 'x' } })
  })

  it('returns [] for non-array / malformed content', () => {
    expect(clientToolUses(null)).toEqual([])
    expect(clientToolUses('nope')).toEqual([])
    expect(clientToolUses([{ type: 'tool_use' }])).toEqual([]) // missing id/name
  })

  it('runs a matching tool and builds a clean tool_result user turn', async () => {
    let received: unknown
    const tool: ClientTool = {
      definition: { name: 'log_feedback' },
      name: 'log_feedback',
      run: async (input) => {
        received = input
        return 'Feedback logged for the team. Reference id: abc123.'
      },
    }
    const turn = await runClientTools(
      [{ id: 'tu1', name: 'log_feedback', input: { summary: 's', category: 'ui' } }],
      [tool],
    )
    expect(turn.role).toBe('user')
    const blocks = turn.content as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu1',
      content: 'Feedback logged for the team. Reference id: abc123.',
    })
    expect(blocks[0].is_error).toBeUndefined()
    expect(received).toEqual({ summary: 's', category: 'ui' })
  })

  it('marks an unknown tool as is_error so the turn never stalls', async () => {
    const turn = await runClientTools([{ id: 'tu9', name: 'nope', input: {} }], [])
    const blocks = turn.content as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu9', is_error: true })
  })

  it('captures a throwing tool as is_error (never throws out of the loop)', async () => {
    const tool: ClientTool = {
      definition: { name: 'boom' },
      name: 'boom',
      run: async () => {
        throw new Error('kaboom')
      },
    }
    const turn = await runClientTools([{ id: 't', name: 'boom', input: {} }], [tool])
    const blocks = turn.content as Array<Record<string, unknown>>
    expect(blocks[0].is_error).toBe(true)
    expect(String(blocks[0].content)).toContain('kaboom')
  })

  it('returns a tool_result for EVERY tool_use in one turn', async () => {
    const tool: ClientTool = {
      definition: { name: 'log_feedback' },
      name: 'log_feedback',
      run: async () => 'ok',
    }
    const turn = await runClientTools(
      [
        { id: 'a', name: 'log_feedback', input: {} },
        { id: 'b', name: 'log_feedback', input: {} },
      ],
      [tool],
    )
    const blocks = turn.content as Array<Record<string, unknown>>
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['a', 'b'])
  })
})
