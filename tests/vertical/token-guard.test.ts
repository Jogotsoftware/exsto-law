// AI-CONTEXT C3 — the pre-flight token-budget guard (lib/tokenGuard.ts). Pure
// unit tests (no DB, no network): the conservative char/token estimator, the
// deterministic + MONOTONIC whole-turn history trim guardChatBudget relies on
// (the property AI-CONTEXT C2's prompt cache needs — see
// assistant-prompt-caching.test.ts), the volatile page-capture clip as the
// last-resort step, the Haiku worst-case (max history/attachments/page-capture)
// staying under its tier ceiling, and the drafter's fail-fast assertDraftBudget.
//
// A NOTE ON TEST NUMBERS: several tests "dial" the effective ceiling down to a
// small, easy-to-reason-about value by exploiting guardChatBudget's own
// contract — ceiling = INPUT_CEILING_BY_TIER[tier] − maxTokens — so passing a
// large maxTokens produces a small, arbitrary ceiling without needing a huge
// (slow) synthetic history. Turn content lengths are chosen as clean multiples
// of CHARS_PER_TOKEN (3.5) — e.g. 350 chars = exactly 100 tokens — so the
// expected trim boundary can be hand-computed exactly, not just asserted
// loosely.
import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  INPUT_CEILING_BY_TIER,
  guardChatBudget,
  assertDraftBudget,
  DraftBudgetExceededError,
  TIER_MODEL,
  buildChatRequest,
  buildVolatileClaudeSystem,
  SCREEN_BEGIN,
  SCREEN_END,
  type AiTask,
} from '@exsto/legal'

const HAIKU = TIER_MODEL.haiku
const SONNET = TIER_MODEL.sonnet

// Ceiling-dialing helper: guardChatBudget/assertDraftBudget compute
// `ceiling = INPUT_CEILING_BY_TIER[tier] - maxTokens`, so this returns the
// maxTokens value that makes the effective ceiling exactly `desiredCeiling`
// for the given tier's model.
function maxTokensForCeiling(desiredCeiling: number, tier: 'haiku' | 'sonnet' = 'haiku'): number {
  const base = tier === 'haiku' ? INPUT_CEILING_BY_TIER.haiku : INPUT_CEILING_BY_TIER.sonnet
  return base - desiredCeiling
}

// A turn of EXACTLY `tokens` tokens: content is exactly tokens*3.5 characters
// (a clean multiple, so estimateTokens(content) === tokens with no rounding),
// built from `fill` regardless of `fill`'s own length (repeat-then-slice, not
// a raw `.repeat(tokens * 3.5)` — repeating a multi-char fill that many TIMES
// would multiply its length by fill.length, silently inflating the token count
// past what the test asked for).
function turn(
  role: 'user' | 'assistant',
  tokens: number,
  fill = 'x',
): { role: typeof role; content: string } {
  const targetLen = Math.round(tokens * 3.5)
  const content = fill.repeat(Math.ceil(targetLen / fill.length)).slice(0, targetLen)
  return { role, content }
}

describe('estimateTokens', () => {
  it('is 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('divides by 3.5 chars/token and rounds up (conservative — never under-counts)', () => {
    expect(estimateTokens('x'.repeat(35))).toBe(10) // 35 / 3.5 = 10 exactly
    expect(estimateTokens('x'.repeat(36))).toBe(11) // 36 / 3.5 = 10.28.. -> ceil 11
    expect(estimateTokens('x'.repeat(1))).toBe(1) // any nonzero text costs >= 1 token
  })

  it('is strictly more conservative (more tokens) than a plain 4-chars/token estimate', () => {
    const text = 'x'.repeat(10_000)
    expect(estimateTokens(text)).toBeGreaterThan(Math.ceil(text.length / 4))
  })
})

describe('INPUT_CEILING_BY_TIER', () => {
  it('haiku is a practical ceiling below the 200K window; sonnet/opus is the window itself', () => {
    expect(INPUT_CEILING_BY_TIER.haiku).toBe(180_000)
    expect(INPUT_CEILING_BY_TIER.haiku).toBeLessThan(200_000)
    expect(INPUT_CEILING_BY_TIER.sonnet).toBe(200_000)
    expect(INPUT_CEILING_BY_TIER.opus).toBe(200_000)
  })
})

describe('guardChatBudget — pass-through when already under budget', () => {
  it('returns the SAME parts (no trim) and an accurate estimate when everything fits', () => {
    const history = [turn('user', 50), turn('assistant', 50)]
    const result = guardChatBudget({
      systemStable: 'x'.repeat(350), // 100 tokens
      volatile: '',
      history,
      userMessage: 'x'.repeat(35), // 10 tokens
      model: SONNET,
      maxTokens: 2048,
    })
    expect(result.droppedHistoryTurns).toBe(0)
    expect(result.volatileClippedToChars).toBeUndefined()
    expect(result.history).toEqual(history)
    expect(result.estimatedInputTokens).toBe(100 + 10 + 50 + 50)
  })
})

describe('guardChatBudget — trim determinism + monotonicity', () => {
  it('is a pure function: identical inputs produce an identical result', () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', 100),
    )
    const args = {
      systemStable: 'S',
      volatile: '',
      history,
      userMessage: 'x'.repeat(35),
      model: HAIKU,
      maxTokens: maxTokensForCeiling(981),
    }
    expect(guardChatBudget(args)).toEqual(guardChatBudget(args))
  })

  it('adding turns to the end never resurrects an already-dropped older turn, and never changes which survive out of order', () => {
    // 20 turns of 100 tokens each; a small dialed ceiling forces repeated
    // trimming as the history grows one turn at a time.
    const all = Array.from({ length: 20 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', 100, `t${i}-`),
    )
    const maxTokens = maxTokensForCeiling(970)
    let prevStart = 0
    for (let n = 1; n <= all.length; n++) {
      const history = all.slice(0, n)
      const { history: survivors, droppedHistoryTurns } = guardChatBudget({
        systemStable: 'S',
        volatile: '',
        history,
        userMessage: 'U',
        model: HAIKU,
        maxTokens,
      })
      // Monotonic: the survivor start index (== dropped count, since these are
      // whole-turn suffix drops) never decreases as history grows.
      expect(droppedHistoryTurns).toBeGreaterThanOrEqual(prevStart)
      // The survivors are always exactly the tail of the full history from the
      // dropped count onward — never a different, non-suffix subset.
      expect(survivors).toEqual(history.slice(droppedHistoryTurns))
      prevStart = droppedHistoryTurns
    }
  })
})

describe('guardChatBudget — over-budget history trims instead of erroring', () => {
  it('drops oldest whole turns first and never throws, even far over budget', () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', 500),
    )
    expect(() =>
      guardChatBudget({
        systemStable: 'S',
        volatile: '',
        history,
        userMessage: 'U',
        model: HAIKU,
        maxTokens: maxTokensForCeiling(2_000),
      }),
    ).not.toThrow()

    const result = guardChatBudget({
      systemStable: 'S',
      volatile: '',
      history,
      userMessage: 'U',
      model: HAIKU,
      maxTokens: maxTokensForCeiling(2_000),
    })
    expect(result.droppedHistoryTurns).toBeGreaterThan(0)
    expect(result.droppedHistoryTurns).toBeLessThan(history.length)
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(2_000)
    // Whole turns only — every surviving turn's full original content is intact.
    for (const t of result.history) expect(history).toContainEqual(t)
  })

  it('never trims the stable system prompt or the current user message, even when they alone exceed the ceiling', () => {
    const hugeSystem = 'x'.repeat(700) // 200 tokens
    const hugeUser = 'y'.repeat(700) // 200 tokens
    const result = guardChatBudget({
      systemStable: hugeSystem,
      volatile: '',
      history: [turn('user', 1000), turn('assistant', 1000)],
      userMessage: hugeUser,
      model: HAIKU,
      maxTokens: maxTokensForCeiling(300), // less than system+user alone (400)
    })
    expect(result.systemStable).toBe(hugeSystem)
    expect(result.userMessage).toBe(hugeUser)
    // All history was dropped trying (and failing) to fit — the guard did
    // everything it's ALLOWED to do; it never touches system/user.
    expect(result.history).toEqual([])
  })
})

describe('guardChatBudget — step 2: clips the volatile page-capture only as a last resort', () => {
  it('drops ALL history before ever touching volatile', () => {
    const volatile = buildVolatileClaudeSystem({
      path: '/attorney/matters/x',
      content: 'p'.repeat(16_000), // at assistantChat.ts's own MAX_PAGE_CONTENT_CHARS cap
    })
    const history = [turn('user', 50), turn('assistant', 50)]
    // A ceiling that fits system+user+volatile+history if NOTHING trims, so
    // this case should need no trimming at all — sanity check before the
    // tighter case below.
    const roomy = guardChatBudget({
      systemStable: 'S',
      volatile,
      history,
      userMessage: 'U',
      model: HAIKU,
      maxTokens: 2048,
    })
    expect(roomy.droppedHistoryTurns).toBe(0)
    expect(roomy.volatileClippedToChars).toBeUndefined()
  })

  it('clips the fenced page-capture content, preserving the fence markers and the truncation-marker convention', () => {
    const pageContent = 'p'.repeat(16_000)
    const volatile = buildVolatileClaudeSystem({
      path: '/attorney/matters/x',
      content: pageContent,
    })
    const history = [turn('user', 500), turn('assistant', 500), turn('user', 500)]
    const ceiling = 600 // small enough that dropping all history STILL isn't enough
    const result = guardChatBudget({
      systemStable: 'S',
      volatile,
      history,
      userMessage: 'U',
      model: HAIKU,
      maxTokens: maxTokensForCeiling(ceiling),
    })
    // History fully dropped first...
    expect(result.droppedHistoryTurns).toBe(history.length)
    expect(result.history).toEqual([])
    // ...then volatile's page capture got clipped.
    expect(result.volatileClippedToChars).toBeDefined()
    expect(result.volatileClippedToChars!).toBeLessThan(pageContent.length)
    // The fence markers survive, exactly once each — never duplicated or dropped.
    expect(result.volatile.split(SCREEN_BEGIN).length - 1).toBe(1)
    expect(result.volatile.split(SCREEN_END).length - 1).toBe(1)
    // Same truncation-marker convention MAX_PAGE_CONTENT_CHARS's own clip uses
    // — a doubly-clipped capture never stutters "…[truncated] …[truncated]".
    expect(result.volatile).toContain('…[truncated]')
    expect(result.volatile.match(/…\[truncated\]/g)?.length).toBe(1)
    // Route line + guard prose (outside the fence) are untouched.
    expect(result.volatile).toContain('/attorney/matters/x')
  })

  it('is a no-op when volatile has no fenced page-capture block at all', () => {
    const result = guardChatBudget({
      systemStable: 'S',
      volatile: 'just a build brief, no screen capture',
      history: [turn('user', 2000)],
      userMessage: 'U',
      model: HAIKU,
      maxTokens: maxTokensForCeiling(100),
    })
    expect(result.volatile).toBe('just a build brief, no screen capture')
    expect(result.volatileClippedToChars).toBeUndefined()
  })
})

describe('guardChatBudget — Haiku worst case stays under ceiling', () => {
  it('max history (100k chars) + max attachments (160k chars) + max page capture (16k) + a forced-skill-sized system all fit under the dialed-down Haiku ceiling after trimming', () => {
    // Mirrors the real caps this repo already enforces independently:
    //   client history cap (UnifiedAssistantChat.tsx)      = 100_000 chars
    //   attachments total cap (assistantChat.ts)            = 160_000 chars
    //   page-capture cap (assistantChat.ts)                 =  16_000 chars
    //   a realistic forced-skill body (firm-admin.build-service-sized)
    const forcedSkillChars = 16_000
    const baseSystemChars = 4_000
    const systemStable = 'S'.repeat(baseSystemChars + forcedSkillChars)

    const volatile = buildVolatileClaudeSystem({
      path: '/attorney/matters/worst-case',
      content: 'p'.repeat(16_000),
    })

    // 100_000 chars of history, split into many small turns (realistic —
    // dozens of short exchanges, not one giant turn).
    const history = Array.from({ length: 100 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', Math.ceil(1000 / 3.5), `h${i}`),
    )

    // The current message + up to 160k chars of attachments, already composed
    // (mirrors composeUserMessage's output shape).
    const userMessage = `Please review these documents.\n\n${'a'.repeat(160_000)}`

    const result = guardChatBudget({
      systemStable,
      volatile,
      history,
      userMessage,
      model: HAIKU,
      maxTokens: 3072, // workRateParams('balanced', false).maxTokens(2048) + 1024 tool headroom
    })

    const ceiling = INPUT_CEILING_BY_TIER.haiku - 3072
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(ceiling)
    // The two never-trimmed pieces really did survive untouched.
    expect(result.systemStable).toBe(systemStable)
    expect(result.userMessage).toBe(userMessage)
  })
})

describe('joint trim x cache — a trimmed turn N and turn N+1 still share a byte-identical prefix', () => {
  // Reuses the byte-stability comparison approach from
  // assistant-prompt-caching.test.ts (stripCC/canon): cache_control markers are
  // token-invisible metadata that legitimately moves turn to turn, so content
  // comparisons must ignore them.
  type Block = Record<string, unknown>
  type Msg = { role: string; content: unknown }
  function stripCC(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stripCC)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'cache_control') continue
        out[k] = stripCC(val)
      }
      return out
    }
    return v
  }
  function canon(m: Msg): { role: string; content: Block[] } {
    const blocks: Block[] =
      typeof m.content === 'string'
        ? [{ type: 'text', text: m.content }]
        : (stripCC(m.content) as Block[])
    return { role: m.role, content: blocks }
  }

  it('turn N+1 (one more exchange appended) reuses turn N through the surviving trimmed history', () => {
    // Hand-computed (see the module doc comment): with 12 raw 100-token
    // history turns, a 981-token ceiling (11 fixed + 970 history budget), the
    // survivor start index is 3 for BOTH turn N and turn N+1 — the two new
    // turns (10 tokens each) fit inside the 70-token slack left after turn N's
    // trim, so no ADDITIONAL drop happens between N and N+1.
    const rawHistory = Array.from({ length: 12 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', 100, `t${i}-`),
    )
    const qN = turn('user', 10, 'qN-') // turn N's current message (10 tokens)
    const aN = turn('assistant', 10, 'aN-') // turn N's reply, once it lands in history
    const rN1 = turn('user', 10, 'rN1-') // turn N+1's current message

    const system = 'S'
    const maxTokens = maxTokensForCeiling(981)

    const guardedN = guardChatBudget({
      systemStable: system,
      volatile: '',
      history: rawHistory,
      userMessage: qN.content,
      model: HAIKU,
      maxTokens,
    })
    expect(guardedN.droppedHistoryTurns).toBe(3) // some trimming DID happen

    const guardedN1 = guardChatBudget({
      systemStable: system,
      volatile: '',
      history: [...rawHistory, qN, aN],
      userMessage: rN1.content,
      model: HAIKU,
      maxTokens,
    })
    // Same start index — no ADDITIONAL drop between N and N+1.
    expect(guardedN1.droppedHistoryTurns).toBe(3)
    // Turn N+1's survivors are turn N's survivors, plus exactly the new exchange.
    expect(guardedN1.history).toEqual([...guardedN.history, qN, aN])

    const opts = { model: HAIKU, workRate: 'balanced' as const, supportsWorkRate: false }
    const bodyN = buildChatRequest(
      [
        { role: 'system' as const, content: guardedN.systemStable },
        ...guardedN.history,
        { role: 'user' as const, content: guardedN.userMessage },
      ],
      opts,
    )
    const bodyN1 = buildChatRequest(
      [
        { role: 'system' as const, content: guardedN1.systemStable },
        ...guardedN1.history,
        { role: 'user' as const, content: guardedN1.userMessage },
      ],
      opts,
    )

    // System block identical (the stable, always-cached prefix).
    expect(stripCC(bodyN.system)).toEqual(stripCC(bodyN1.system))

    // Shared prefix = turn N's messages EXCEPT its final (current) user turn —
    // i.e. everything turn N sent as history.
    const msgsN = bodyN.messages as Msg[]
    const msgsN1 = bodyN1.messages as Msg[]
    const prefixLen = msgsN.length - 1
    expect(msgsN1.length).toBeGreaterThan(prefixLen) // N+1 really is longer
    const prefixN = msgsN.slice(0, prefixLen).map(canon)
    const prefixN1 = msgsN1.slice(0, prefixLen).map(canon)
    expect(prefixN).toEqual(prefixN1)
  })
})

describe('assertDraftBudget — fail-fast for the single-call drafter', () => {
  const TASK: AiTask = 'draft_generate'

  it('does not throw when the prompt fits', () => {
    expect(() => assertDraftBudget(TASK, 'x'.repeat(350), SONNET, 8000)).not.toThrow()
  })

  it('throws an actionable DraftBudgetExceededError naming the task, the estimate, and the ceiling', () => {
    const prompt = 'x'.repeat(3500) // 1000 tokens
    const maxTokens = maxTokensForCeiling(500, 'haiku') // ceiling 500 < 1000 estimated
    let caught: unknown
    try {
      assertDraftBudget(TASK, prompt, HAIKU, maxTokens)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(DraftBudgetExceededError)
    const err = caught as DraftBudgetExceededError
    expect(err.task).toBe(TASK)
    expect(err.estimatedTokens).toBe(1000)
    expect(err.ceiling).toBe(500)
    expect(err.message).toContain(TASK)
    expect(err.message).toContain('1,000')
    expect(err.message).toContain('500')
  })
})
