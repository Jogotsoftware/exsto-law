// OVERLOAD-HANDLING-1 — graceful transient-error handling for Anthropic calls.
// These are PURE unit tests of the adapter's retry/classify/humanize helpers
// (no network, no DB): the retry policy is deterministic and the graceful
// surface never leaks raw API-error JSON or a request_id. Acceptance A–E from
// the session brief map 1:1 to the describe blocks below.
import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  isRetryableAnthropicError,
  retryDelayMs,
  withTransientRetry,
  humanizeAnthropicError,
  extractApiErrorMessage,
} from '@exsto/legal'

// Fabricate a real SDK APIError the way the live API would surface one. The
// pinned SDK's ctor is (status, errorBody, message, headersRecord).
function apiError(
  status: number,
  opts: { message?: string; headers?: Record<string, string> } = {},
) {
  const body = {
    type: 'error',
    error: {
      type: status === 529 ? 'overloaded_error' : 'error',
      message: opts.message ?? 'Overloaded',
    },
    request_id: 'req_ABC123_secret',
  }
  return new Anthropic.APIError(status, body, `${status} ${JSON.stringify(body)}`, opts.headers)
}
const noSleep = () => Promise.resolve()

describe('classification: retryable vs non-retryable', () => {
  it('treats 529 / 429 / 5xx / connection errors as transient', () => {
    expect(isRetryableAnthropicError(apiError(529))).toBe(true)
    expect(isRetryableAnthropicError(apiError(429))).toBe(true)
    expect(isRetryableAnthropicError(apiError(500))).toBe(true)
    expect(isRetryableAnthropicError(apiError(503))).toBe(true)
    expect(isRetryableAnthropicError(new Anthropic.APIConnectionError({ message: 'boom' }))).toBe(
      true,
    )
  })
  it('does NOT retry 400 / 401 / 403 / 404 / 422 or a user abort', () => {
    for (const s of [400, 401, 403, 404, 422])
      expect(isRetryableAnthropicError(apiError(s))).toBe(false)
    expect(isRetryableAnthropicError(new Anthropic.APIUserAbortError())).toBe(false)
    expect(isRetryableAnthropicError(new Error('plain'))).toBe(false)
  })
})

describe('A — a self-resolving 529 blip is invisible (auto-retry succeeds)', () => {
  it('retries a first-attempt 529 and returns the second attempt result', async () => {
    let calls = 0
    const result = await withTransientRetry(
      async () => {
        calls++
        if (calls === 1) throw apiError(529)
        return 'ok'
      },
      { sleepFn: noSleep },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2) // one failure, one success — caller never sees the blip
  })
})

describe('B — persistent 529 surfaces a plain human message, never JSON', () => {
  it('exhausts retries then throws, and the message is clean', async () => {
    let calls = 0
    const err = await withTransientRetry(
      async () => {
        calls++
        throw apiError(529)
      },
      { sleepFn: noSleep },
    ).catch((e) => e)
    expect(calls).toBe(4) // initial + 3 retries (RETRY_BACKOFF_MS length)
    const human = humanizeAnthropicError(err)
    expect(human).toBe('The assistant is briefly overloaded — please try again in a moment.')
    // Never leak machinery.
    expect(human).not.toMatch(/[{[]/)
    expect(human).not.toMatch(/request_id|req_/i)
    expect(human).not.toMatch(/overloaded_error/)
  })
})

describe('C — a non-retryable 400 surfaces immediately, no retry, no JSON', () => {
  it('does not retry and returns the model’s human message, not the envelope', async () => {
    let calls = 0
    const err = await withTransientRetry(
      async () => {
        calls++
        throw apiError(400, { message: 'max_tokens must be at least 1' })
      },
      { sleepFn: noSleep },
    ).catch((e) => e)
    expect(calls).toBe(1) // surfaced on the first attempt
    expect(extractApiErrorMessage(err)).toBe('max_tokens must be at least 1')
    const human = humanizeAnthropicError(err)
    expect(human).toContain('max_tokens must be at least 1')
    expect(human).not.toMatch(/[{[]/)
    expect(human).not.toMatch(/request_id|req_/i)
  })
})

describe('D — retry preserves context and never double-fires a side effect', () => {
  it('re-invokes the SAME call; the post-success side effect runs exactly once', async () => {
    // Models the adapter's real shape: a client tool runs only AFTER the model
    // call succeeds. So a failed-then-retried call invokes the model N times but
    // the side effect exactly once — retry cannot double-fire it.
    const seenPrompts: string[] = []
    let sideEffects = 0
    const PROMPT = 'draft the NDA' // same context every attempt
    await withTransientRetry(
      async () => {
        seenPrompts.push(PROMPT)
        if (seenPrompts.length < 3) throw apiError(529)
        return 'model-response'
      },
      { sleepFn: noSleep },
    ).then(() => {
      sideEffects++ // the "tool" runs once, after success
    })
    expect(seenPrompts).toEqual([PROMPT, PROMPT, PROMPT]) // identical context each retry
    expect(sideEffects).toBe(1)
  })
})

describe('E — backoff schedule and Retry-After', () => {
  it('uses 1s / 2s / 4s and stops after the budget', () => {
    const e = apiError(529)
    expect(retryDelayMs(0, e)).toBe(1000)
    expect(retryDelayMs(1, e)).toBe(2000)
    expect(retryDelayMs(2, e)).toBe(4000)
    expect(retryDelayMs(3, e)).toBeNull() // budget spent
  })
  it('honors a Retry-After header (seconds → ms), capped', () => {
    expect(retryDelayMs(0, apiError(429, { headers: { 'retry-after': '2' } }))).toBe(2000)
    // A large server-suggested wait is capped so a sync request can't hang.
    expect(retryDelayMs(0, apiError(429, { headers: { 'retry-after': '99' } }))).toBe(8000)
  })
  it('returns null for a non-retryable error regardless of attempt', () => {
    expect(retryDelayMs(0, apiError(400))).toBeNull()
  })
  it('actually waits the scheduled delays (injected clock)', async () => {
    const slept: number[] = []
    let calls = 0
    await withTransientRetry(
      async () => {
        calls++
        if (calls < 3) throw apiError(529)
        return 'ok'
      },
      { sleepFn: async (ms) => void slept.push(ms) },
    )
    expect(slept).toEqual([1000, 2000]) // two retries before the third attempt won
  })
})

describe('graceful surface for other error shapes', () => {
  it('connection errors read as temporarily unavailable', () => {
    expect(humanizeAnthropicError(new Anthropic.APIConnectionError({ message: 'x' }))).toBe(
      'The assistant is temporarily unavailable — please try again in a moment.',
    )
  })
  it('auth errors point at Settings, not the raw body', () => {
    const human = humanizeAnthropicError(apiError(401, { message: 'invalid x-api-key' }))
    expect(human).toMatch(/Settings/)
    expect(human).not.toMatch(/[{[]/)
  })
  it('a raw JSON-looking plain Error is not echoed back verbatim', () => {
    const human = humanizeAnthropicError(new Error('{"type":"error","request_id":"req_x"}'))
    expect(human).not.toMatch(/request_id/)
    expect(human).toBe("The assistant couldn't complete that request. Please try again.")
  })
})
