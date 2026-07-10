// BUILDER-CERT-1 (WP2) — the composition contract: the three levers the service-
// builder wizard is made of (doctrine = seeded firm-admin skills, tool contracts =
// the closed catalogs, validators = the vocabulary/diagnostics) must AGREE. Twice the
// seeded doctrine silently disagreed with the code (skills taught a deprecated step
// kind after the catalog dropped it); this pins the levers to each other in CI so the
// drift class dies at the PR, not in a live wizard turn.
//
// Pure — reads the skill SOURCE files (verticals/legal/skills/firm-admin/*.md) and
// the in-repo catalogs; no DB. The capability contracts come from the seed source of
// truth (demo/seed-capabilities.ts, imported without side effects — its main() is
// guarded to direct execution). Reseed freshness (seeded DB content matches these
// sources) is deliberately NOT checked here: CI's test database has no seeded firm
// tenant, so that check belongs to the reseed runbook, not the unit gate.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STEP_ACTION_CATALOG,
  AUTHORABLE_STEP_ACTION_KINDS,
  GATE_TRANSITION_VOCABULARY,
  KNOWN_FIELD_TYPES,
  buildInvokeCapabilityStepTemplate,
} from '@exsto/legal'
import { INVOCABLE_CONTRACTS, CAPABILITIES } from '../../verticals/legal/demo/seed-capabilities.js'

const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../verticals/legal/skills/firm-admin',
)

// slug → file body for every seeded firm-admin skill source.
const skillFiles: Record<string, string> = Object.fromEntries(
  readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => [f, readFileSync(join(SKILLS_DIR, f), 'utf8')]),
)
const allDoctrine = Object.values(skillFiles).join('\n')

describe('composition contract — doctrine teaches no deprecated step kind', () => {
  const deprecatedKinds = STEP_ACTION_CATALOG.filter((s) => s.deprecated).map((s) => s.kind)

  it('the catalog actually has a deprecated kind to guard against (sanity)', () => {
    expect(deprecatedKinds).toContain('generate_document')
  })

  it('every doctrine line naming a deprecated kind marks it deprecated/forbidden', () => {
    for (const kind of deprecatedKinds) {
      for (const [file, body] of Object.entries(skillFiles)) {
        const offending = body
          .split('\n')
          .filter((line) => line.includes(kind))
          .filter((line) => !/deprecat|never author|reject/i.test(line))
        expect(
          offending,
          `${file} teaches deprecated step kind "${kind}" without marking it deprecated: ${JSON.stringify(offending)}`,
        ).toEqual([])
      }
    }
  })

  it('every authorable step kind is taught in author-workflow.md', () => {
    const body = skillFiles['author-workflow.md'] ?? ''
    for (const kind of AUTHORABLE_STEP_ACTION_KINDS) {
      expect(body, `author-workflow.md does not teach authorable kind "${kind}"`).toContain(kind)
    }
  })
})

describe('composition contract — every step-invocable capability is taught', () => {
  const invocableSlugs = Object.entries(INVOCABLE_CONTRACTS)
    .filter(([, c]) => c.step_invocable === true)
    .map(([slug]) => slug)

  it('the seed registry has the four invocable capabilities (sanity)', () => {
    expect(invocableSlugs.sort()).toEqual([
      'ai_document_review',
      'document_generation',
      'esignature',
      'request_client_materials',
    ])
  })

  it('the doctrine references every invocable capability (slug or spaced/hyphenated name)', () => {
    // "AI-document-review capability" in prose ≡ the ai_document_review slug: compare
    // on a normalized text (lowercase, runs of space/hyphen → underscore).
    const normalized = allDoctrine.toLowerCase().replace(/[-\s]+/g, '_')
    for (const slug of invocableSlugs) {
      expect(
        normalized.includes(slug),
        `no firm-admin skill teaches the step-invocable capability "${slug}"`,
      ).toBe(true)
    }
  })

  it('the doctrine teaches the current stepTemplate wrapper keys, and the generator agrees', () => {
    // The wrapper contract: a stage's action.config is exactly { capability_slug,
    // capability_config }. The doctrine must name both keys; the generated
    // stepTemplate for every invocable contract must use exactly them.
    expect(allDoctrine).toContain('capability_slug')
    expect(allDoctrine).toContain('capability_config')
    for (const slug of invocableSlugs) {
      const spec = {
        ...(CAPABILITIES.find((c) => c.slug === slug)?.spec ?? { name: slug }),
        ...INVOCABLE_CONTRACTS[slug],
      }
      const template = buildInvokeCapabilityStepTemplate({ slug, spec })
      expect(template.action.kind).toBe('invoke_capability')
      const config = template.action.config as Record<string, unknown>
      expect(Object.keys(config).sort()).toEqual(['capability_config', 'capability_slug'])
      expect(config.capability_slug).toBe(slug)
    }
  })
})

describe('composition contract — every gate token the doctrine names exists', () => {
  const vocabulary = new Set(
    Object.values(GATE_TRANSITION_VOCABULARY).flatMap((g) => g.options.map((o) => o.token)),
  )

  it('gate-teaching lines (on:/via:/advances on) name only real advance tokens', () => {
    // Matches the doctrine's gate-teaching notation: `on: esign.completed`,
    // `via: draft.approve`, "advances on invoice.paid". A dotted token in one of
    // those positions IS the runtime dispatch token — prose or a typo there ships a
    // wizard that composes edges that never fire.
    const re = /(?:\b(?:on|via):\s*`?|advanc(?:es|ing)\s+on\s+`?)([a-z][a-z_]*(?:\.[a-z_]+)+)/gi
    const named: Array<{ file: string; token: string }> = []
    for (const [file, body] of Object.entries(skillFiles)) {
      for (const m of body.matchAll(re)) {
        named.push({ file, token: m[1]!.toLowerCase() })
      }
    }
    expect(named.length, 'expected the doctrine to teach at least one gate token').toBeGreaterThan(
      0,
    )
    for (const { file, token } of named) {
      expect(
        vocabulary.has(token),
        `${file} teaches gate token "${token}", which is not in GATE_TRANSITION_VOCABULARY — the edge it teaches can never fire`,
      ).toBe(true)
    }
  })
})

describe('composition contract — billing doctrine forces a choice (WP1)', () => {
  it('build-service.md and author-workflow.md carry the forced-choice billing language', () => {
    for (const file of ['build-service.md', 'author-workflow.md']) {
      const body = skillFiles[file] ?? ''
      expect(body, `${file}: missing the "ONE billing point" default`).toMatch(/ONE billing point/)
      expect(body, `${file}: missing the total-per-matter card contract`).toMatch(
        /total per-matter charge/,
      )
    }
  })
})

describe('computed change read-out — describeGraphChanges (WP3)', () => {
  const stage = (key: string, label: string): Record<string, unknown> => ({
    key,
    label,
    action: { kind: 'manual_task' },
    advances_to: [],
  })

  it('returns null on first authoring (no live graph to diff against)', async () => {
    const { describeGraphChanges } = await import('@exsto/legal')
    expect(describeGraphChanges(null, [stage('a', 'A')] as never)).toBeNull()
    expect(describeGraphChanges([] as never, [stage('a', 'A')] as never)).toBeNull()
  })

  it('reports adds/removes/modifies by stage key, and key order never fakes a change', async () => {
    const { describeGraphChanges } = await import('@exsto/legal')
    const live = [stage('a', 'A'), stage('b', 'B')] as never
    // Same stage semantically, keys emitted in a different order → not a change.
    const reordered = [
      { advances_to: [], action: { kind: 'manual_task' }, label: 'A', key: 'a' },
      stage('b', 'B'),
    ] as never
    expect(describeGraphChanges(live, reordered)).toContain('no changes')
    const revised = [stage('a', 'A'), stage('b', 'B RENAMED'), stage('c', 'C')] as never
    const line = describeGraphChanges(live, revised)!
    expect(line).toContain('adds c')
    expect(line).toContain('modifies b')
  })
})

describe('composition contract — every questionnaire field type is taught', () => {
  it('author-questionnaire.md teaches every KNOWN_FIELD_TYPES entry', () => {
    const body = skillFiles['author-questionnaire.md'] ?? ''
    for (const type of KNOWN_FIELD_TYPES) {
      expect(body, `author-questionnaire.md does not teach field type "${type}"`).toContain(type)
    }
  })
})
