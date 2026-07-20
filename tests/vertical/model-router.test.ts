// AI-CONTEXT C1 — the central model router. Pure unit tests (no DB, no
// network): the precedence table, the '' -vs-unset env normalization bug fix
// (LEGAL_DRAFTING_MODEL / LEGAL_RESEARCH_MODEL), per-task registry defaults +
// escalation thresholds, the literal-'auto' bug fix
// (resolveConcreteAssistantModelId), and a source-grep gate asserting
// LEGAL_DRAFTING_MODEL is read in exactly one file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TIER_MODEL,
  resolveModelForTask,
  resolveConcreteAssistantModelId,
  chooseAutoModel,
  AUTO_MODEL_ID,
  AUTO_MODEL_HAIKU_ID,
  AUTO_MODEL_SONNET_ID,
  resolveAssistantModel,
  type AiTask,
} from '@exsto/legal'

// Every server drafting task LEGAL_DRAFTING_MODEL is allowed to override —
// mirrors the router's own DRAFTING_MODEL_TASKS set so the precedence table
// below is exhaustive rather than spot-checked.
const DRAFTING_TASKS: AiTask[] = [
  'draft_generate',
  'draft_revise',
  'doc_review',
  'redline',
  'email_generate',
  'transcript_extract',
  'brief_matter',
  'brief_client',
  'service_digest',
  'config_regenerate',
  'template_ai',
]

// Tasks LEGAL_DRAFTING_MODEL must NEVER touch.
const NON_DRAFTING_TASKS: AiTask[] = ['chat_turn', 'chat_client_portal', 'key_verify', 'research']

const ENV_KEYS = ['LEGAL_DRAFTING_MODEL', 'LEGAL_RESEARCH_MODEL'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('TIER_MODEL — the single home of Claude model ids', () => {
  it('names one id per tier', () => {
    expect(TIER_MODEL.haiku).toBe('claude-haiku-4-5-20251001')
    expect(TIER_MODEL.sonnet).toBe('claude-sonnet-4-6')
    expect(TIER_MODEL.opus).toBe('claude-opus-4-8')
  })

  it('matches the AUTO_MODEL_* ids (chooseAutoModel only ever hands back a TIER_MODEL value)', () => {
    expect(AUTO_MODEL_HAIKU_ID).toBe(TIER_MODEL.haiku)
    expect(AUTO_MODEL_SONNET_ID).toBe(TIER_MODEL.sonnet)
  })

  it('matches the assistant CATALOG entries (assistantModels.ts hardcodes its own literals to avoid a risky circular const dependency — this pins them to TIER_MODEL so drift is caught here instead)', () => {
    expect(resolveAssistantModel(`anthropic:${TIER_MODEL.opus}`)?.model).toBe(TIER_MODEL.opus)
    expect(resolveAssistantModel(`anthropic:${TIER_MODEL.sonnet}`)?.model).toBe(TIER_MODEL.sonnet)
    expect(resolveAssistantModel(`anthropic:${TIER_MODEL.haiku}`)?.model).toBe(TIER_MODEL.haiku)
  })
})

describe('resolveModelForTask — precedence', () => {
  // 'research' is excluded from this loop: it's a different provider
  // (Perplexity), so ResolvedModel.tier is a documented sentinel there, not a
  // reflection of the explicit model's actual Claude tier — see the dedicated
  // research explicit-override test below.
  const CLAUDE_TASKS = [...DRAFTING_TASKS, ...NON_DRAFTING_TASKS].filter((t) => t !== 'research')

  it('(1) an explicit model wins over everything, for every Claude task', () => {
    for (const task of CLAUDE_TASKS) {
      process.env.LEGAL_DRAFTING_MODEL = 'claude-haiku-4-5-20251001'
      const resolved = resolveModelForTask(task, { explicitModel: 'claude-opus-4-8' })
      expect(resolved.model, `task=${task}`).toBe('claude-opus-4-8')
      expect(resolved.tier, `task=${task}`).toBe('opus')
      expect(resolved.supportsWorkRate, `task=${task}`).toBe(true)
    }
  })

  it('(1) an explicit model wins for research too (model, not tier, is what matters there)', () => {
    process.env.LEGAL_DRAFTING_MODEL = 'claude-haiku-4-5-20251001'
    const resolved = resolveModelForTask('research', { explicitModel: 'sonar-reasoning' })
    expect(resolved.model).toBe('sonar-reasoning')
  })

  it('an explicit haiku model reports supportsWorkRate: false', () => {
    const resolved = resolveModelForTask('draft_generate', { explicitModel: TIER_MODEL.haiku })
    expect(resolved.tier).toBe('haiku')
    expect(resolved.supportsWorkRate).toBe(false)
  })

  it('a whitespace/empty explicitModel does NOT win — falls through to the next step', () => {
    const resolved = resolveModelForTask('key_verify', { explicitModel: '   ' })
    expect(resolved.model).toBe(TIER_MODEL.haiku) // key_verify's registry default, not ''
  })

  it('(2) a serviceOverride wins over LEGAL_DRAFTING_MODEL and the registry default', () => {
    process.env.LEGAL_DRAFTING_MODEL = TIER_MODEL.haiku
    const resolved = resolveModelForTask('draft_generate', { serviceOverride: TIER_MODEL.opus })
    expect(resolved.model).toBe(TIER_MODEL.opus)
    expect(resolved.tier).toBe('opus')
  })

  it('(3) LEGAL_DRAFTING_MODEL overrides every drafting task when no explicit/service override', () => {
    process.env.LEGAL_DRAFTING_MODEL = TIER_MODEL.opus
    for (const task of DRAFTING_TASKS) {
      const resolved = resolveModelForTask(task)
      expect(resolved.model, `task=${task}`).toBe(TIER_MODEL.opus)
      expect(resolved.reason, `task=${task}`).toMatch(/LEGAL_DRAFTING_MODEL/)
    }
  })

  it('(3) LEGAL_DRAFTING_MODEL is IGNORED for chat_turn/chat_client_portal/key_verify/research', () => {
    process.env.LEGAL_DRAFTING_MODEL = TIER_MODEL.opus
    expect(resolveModelForTask('chat_turn').model).toBe(TIER_MODEL.sonnet)
    expect(resolveModelForTask('chat_client_portal').model).toBe(TIER_MODEL.sonnet)
    expect(resolveModelForTask('key_verify').model).toBe(TIER_MODEL.haiku)
    expect(resolveModelForTask('research').model).toBe('sonar')
  })

  it("(4) '' -vs-unset: LEGAL_DRAFTING_MODEL='' normalizes to unset, not the literal ''", () => {
    process.env.LEGAL_DRAFTING_MODEL = ''
    const resolved = resolveModelForTask('draft_generate')
    expect(resolved.model).toBe(TIER_MODEL.sonnet) // NOT ''
    expect(resolved.model).not.toBe('')
  })

  it("(4) '' -vs-unset: LEGAL_RESEARCH_MODEL='' normalizes to unset, not the literal ''", () => {
    process.env.LEGAL_RESEARCH_MODEL = ''
    const resolved = resolveModelForTask('research')
    expect(resolved.model).toBe('sonar')
    expect(resolved.model).not.toBe('')
  })

  it('(4) registry default: key_verify is always haiku', () => {
    expect(resolveModelForTask('key_verify').model).toBe(TIER_MODEL.haiku)
  })

  it('(4) registry default: chat_client_portal is pinned sonnet', () => {
    expect(resolveModelForTask('chat_client_portal').model).toBe(TIER_MODEL.sonnet)
  })

  it('(4) registry default: chat_turn defaults sonnet with no explicit/env', () => {
    expect(resolveModelForTask('chat_turn').model).toBe(TIER_MODEL.sonnet)
  })

  it('(4) registry default: every other drafting task defaults sonnet with no env override', () => {
    for (const task of DRAFTING_TASKS) {
      if (task === 'transcript_extract' || task === 'service_digest') continue // escalating tasks default haiku
      expect(resolveModelForTask(task).model, `task=${task}`).toBe(TIER_MODEL.sonnet)
    }
  })

  it('(4) research defaults to sonar with nothing set', () => {
    expect(resolveModelForTask('research').model).toBe('sonar')
  })

  it('(4) research respects an explicit LEGAL_RESEARCH_MODEL override', () => {
    process.env.LEGAL_RESEARCH_MODEL = 'sonar-reasoning'
    expect(resolveModelForTask('research').model).toBe('sonar-reasoning')
  })
})

describe('resolveModelForTask — escalation thresholds', () => {
  it('transcript_extract defaults haiku and does NOT escalate at exactly 300,000 chars', () => {
    expect(resolveModelForTask('transcript_extract', { inputChars: 300_000 }).model).toBe(
      TIER_MODEL.haiku,
    )
  })

  it('transcript_extract escalates to sonnet just above 300,000 chars', () => {
    const resolved = resolveModelForTask('transcript_extract', { inputChars: 300_001 })
    expect(resolved.model).toBe(TIER_MODEL.sonnet)
    expect(resolved.reason).toMatch(/escalated/)
  })

  it('service_digest defaults haiku and does NOT escalate at exactly 100,000 chars', () => {
    expect(resolveModelForTask('service_digest', { inputChars: 100_000 }).model).toBe(
      TIER_MODEL.haiku,
    )
  })

  it('service_digest escalates to sonnet just above 100,000 chars', () => {
    const resolved = resolveModelForTask('service_digest', { inputChars: 100_001 })
    expect(resolved.model).toBe(TIER_MODEL.sonnet)
    expect(resolved.reason).toMatch(/escalated/)
  })

  it('a LEGAL_DRAFTING_MODEL override wins over escalation (step 3 beats step 4)', () => {
    process.env.LEGAL_DRAFTING_MODEL = TIER_MODEL.opus
    const resolved = resolveModelForTask('transcript_extract', { inputChars: 1_000_000 })
    expect(resolved.model).toBe(TIER_MODEL.opus)
  })
})

describe("resolveConcreteAssistantModelId — the literal-'auto' bug fix", () => {
  it('resolves the compound Auto id to a concrete Claude model, never the literal string', () => {
    const resolved = resolveConcreteAssistantModelId(AUTO_MODEL_ID, { message: 'hi' })
    expect(resolved).not.toBeNull()
    expect(resolved).not.toBe('auto')
    expect([AUTO_MODEL_HAIKU_ID, AUTO_MODEL_SONNET_ID]).toContain(resolved)
  })

  it('resolves the bare "auto" string the same way', () => {
    const resolved = resolveConcreteAssistantModelId('auto', { message: 'hi' })
    expect(resolved).not.toBe('auto')
    expect([AUTO_MODEL_HAIKU_ID, AUTO_MODEL_SONNET_ID]).toContain(resolved)
  })

  it('routes a heavy Auto turn to sonnet and a light one to haiku (delegates to chooseAutoModel)', () => {
    expect(
      resolveConcreteAssistantModelId(AUTO_MODEL_ID, { message: 'draft an engagement letter' }),
    ).toBe(chooseAutoModel({ message: 'draft an engagement letter' }))
    expect(resolveConcreteAssistantModelId(AUTO_MODEL_ID, { message: 'ok thanks' })).toBe(
      chooseAutoModel({ message: 'ok thanks' }),
    )
  })

  it('passes through a non-Auto, known model id unchanged', () => {
    expect(resolveConcreteAssistantModelId(`anthropic:${TIER_MODEL.opus}`, { message: 'x' })).toBe(
      TIER_MODEL.opus,
    )
    expect(resolveConcreteAssistantModelId('perplexity:sonar', { message: 'x' })).toBe('sonar')
  })

  it('returns null for an unknown model id (caller falls back to the task registry default)', () => {
    expect(
      resolveConcreteAssistantModelId('anthropic:not-a-real-model', { message: 'x' }),
    ).toBeNull()
  })
})

// ── Grep gate ─────────────────────────────────────────────────────────────
// LEGAL_DRAFTING_MODEL used to be READ directly in adapters/claude.ts
// (DEFAULT_MODEL). It must now be read (process.env.LEGAL_DRAFTING_MODEL) in
// exactly one file — the router — so the ''-vs-unset fix can never be
// silently bypassed by a new call site reading the env var itself. Matches
// the actual `process.env.LEGAL_DRAFTING_MODEL` access pattern, NOT bare
// mentions of the name in comments (several files legitimately document the
// gotcha/workaround this WP fixed — that prose is fine and expected). Scoped
// to verticals/legal/src (production source) — demo/ops scripts intentionally
// set the env var themselves before the app boots and are out of scope here.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../verticals/legal/src')
const ALLOWED_FILE = join(SRC_DIR, 'lib', 'modelRouter.ts')
const ENV_READ_PATTERN =
  /process\.env(?:\.LEGAL_DRAFTING_MODEL|\[\s*['"]LEGAL_DRAFTING_MODEL['"]\s*\])/

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...listTsFiles(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('grep gate — LEGAL_DRAFTING_MODEL is read nowhere outside the router', () => {
  it('no file under verticals/legal/src other than lib/modelRouter.ts reads process.env.LEGAL_DRAFTING_MODEL', () => {
    const offenders = listTsFiles(SRC_DIR)
      .filter((f) => f !== ALLOWED_FILE)
      .filter((f) => ENV_READ_PATTERN.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it("sanity: the router itself DOES read it (the gate isn't vacuously passing)", () => {
    expect(ENV_READ_PATTERN.test(readFileSync(ALLOWED_FILE, 'utf8'))).toBe(true)
  })
})
