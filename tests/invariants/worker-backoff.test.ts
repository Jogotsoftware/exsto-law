// Worker runtime — retry backoff. Pure unit test (no DB): failed jobs retry with
// exponential backoff and a cap (DoD: "retry with exponential backoff").
import { describe, it, expect } from 'vitest'
import { backoffSeconds } from '@exsto/worker-runtime'

describe('worker retry backoff', () => {
  it('grows exponentially from the first retry', () => {
    expect(backoffSeconds(1)).toBe(2)
    expect(backoffSeconds(2)).toBe(4)
    expect(backoffSeconds(3)).toBe(8)
    expect(backoffSeconds(4)).toBe(16)
  })

  it('is caps and never negative', () => {
    expect(backoffSeconds(100)).toBe(3600)
    expect(backoffSeconds(0)).toBeGreaterThanOrEqual(2)
  })
})
