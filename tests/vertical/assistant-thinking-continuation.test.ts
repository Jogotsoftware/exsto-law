// Regression: the in-app assistant 400'd with
//   "messages.2.content.0.thinking: each thinking block must contain thinking"
// when a turn used adaptive thinking (work rate balanced/thorough) AND the model
// then called a tool (log_feedback) or web search paused. The continuation
// re-sent the assistant turn including a streamed thinking block whose signature
// SDK 0.32 can't round-trip → the API rejected it. The fix: strip thinking blocks
// from the carried turn and don't re-enable thinking on the resumed request. No
// live model needed — these pin the two pure helpers.
import { describe, it, expect } from 'vitest'
import { buildChatRequest, stripThinkingBlocks } from '@exsto/legal'

describe('stripThinkingBlocks', () => {
  it('removes thinking and redacted_thinking blocks, keeps text + tool_use', () => {
    const content = [
      { type: 'thinking', thinking: 'pondering…', signature: 'sig' },
      { type: 'redacted_thinking', data: 'xyz' },
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 't1', name: 'log_feedback', input: {} },
    ]
    const out = stripThinkingBlocks(content) as Array<{ type: string }>
    expect(out.map((b) => b.type)).toEqual(['text', 'tool_use'])
  })

  it('passes through non-array content unchanged', () => {
    expect(stripThinkingBlocks('nope')).toBe('nope')
    expect(stripThinkingBlocks(null)).toBe(null)
  })
})

describe('buildChatRequest thinking on continuation', () => {
  const opts = { model: 'claude-sonnet-4-6', workRate: 'balanced' as const, supportsWorkRate: true }
  const messages = [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'hi' },
  ]

  it('enables adaptive thinking on the FIRST turn (no carry)', () => {
    const body = buildChatRequest(messages, opts)
    expect(body.thinking).toBeTruthy()
  })

  it('DROPS thinking on a continuation (carry present), so a resumed tool turn is valid', () => {
    const carry = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ]
    const body = buildChatRequest(messages, opts, carry)
    expect(body.thinking).toBeUndefined()
    // The effort/output_config knob is unaffected — only `thinking` is dropped.
    expect(body.output_config).toBeTruthy()
  })
})
