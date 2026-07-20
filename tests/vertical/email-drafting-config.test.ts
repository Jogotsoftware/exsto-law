// WP FB-D — per-tenant email drafting prompt + house-voice doctrine, config-
// first (mirrors service-prompt.test.ts's coverage of the document drafting-
// prompt seam). Pure-resolver/compose coverage needs no DB at all — the
// "byte-identical when no config exists" contract is proven directly against
// loader.ts's classic loadEmailDraftingPrompt(). The live-DB section is
// DB-gated like tests/invariants (skips, not fails, when no DB URL is wired)
// AND further gated on migration 0180 having actually been applied — it is
// PLANNED ONLY as of this PR (no attribute/action kind rows exist yet on any
// wired environment), so the write-path round trip skips until a future
// session applies it. The read-path fallback proof runs regardless: the query
// degrades safely (zero attribute rows can exist without the kind) even
// pre-migration.
import { describe, it, expect } from 'vitest'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { checkEmailVoice } from '../../verticals/legal/src/api/emailVoiceChecks.js'
import {
  loadEmailDraftingPrompt,
  loadEmailDraftingPromptTemplate,
  loadHouseVoiceDoctrine,
  HOUSE_VOICE_SLOT,
} from '../../verticals/legal/src/templates/loader.js'
import {
  REQUIRED_EMAIL_PROMPT_SLOTS,
  missingEmailPromptSlots,
  validateEmailDraftingPromptText,
  resolveEmailDraftingConfigDoc,
  composeEmailDraftingPrompt,
  getEmailDraftingConfig,
  updateEmailDraftingConfig,
  type EmailDraftingConfigDoc,
} from '../../verticals/legal/src/api/emailDraftingConfig.js'

// A minimal, valid prompt: contains every required slot.
function validPrompt(tag: string): string {
  return [
    `Draft instructions ${tag}.`,
    'SUBJECT: <line>',
    '{{purpose}}',
    '{{recipient_role}}',
    '{{matter_facts_json}}',
    '{{client_context}}',
    '{{client_brief}}',
    '{{firm_instructions}}',
    HOUSE_VOICE_SLOT,
  ].join('\n')
}

describe('REQUIRED_EMAIL_PROMPT_SLOTS — the repo template satisfies its own contract', () => {
  it('the bundled repo prompt template contains every required slot', () => {
    const raw = loadEmailDraftingPromptTemplate()
    for (const slot of REQUIRED_EMAIL_PROMPT_SLOTS) expect(raw).toContain(slot)
    expect(missingEmailPromptSlots(raw)).toEqual([])
  })
})

describe('missingEmailPromptSlots / validateEmailDraftingPromptText (pure)', () => {
  it('reports exactly the missing slots', () => {
    expect(missingEmailPromptSlots(validPrompt('ok'))).toEqual([])
    const bad = validPrompt('x').replace('{{matter_facts_json}}', '')
    expect(missingEmailPromptSlots(bad)).toEqual(['{{matter_facts_json}}'])
  })

  it('rejects a prompt missing the SUBJECT: output contract', () => {
    const bad = validPrompt('x').replace('SUBJECT: <line>', '')
    expect(() => validateEmailDraftingPromptText(bad)).toThrow(/SUBJECT:/)
  })

  it.each(REQUIRED_EMAIL_PROMPT_SLOTS.filter((s) => s !== 'SUBJECT:'))(
    'rejects a prompt missing %s',
    (slot) => {
      const bad = validPrompt('x').replace(slot, '')
      expect(() => validateEmailDraftingPromptText(bad)).toThrow()
      expect(() => validateEmailDraftingPromptText(bad)).toThrow(
        new RegExp(slot.replace(/[{}]/g, '\\$&')),
      )
    },
  )

  it('rejects empty / non-string prompts', () => {
    expect(() => validateEmailDraftingPromptText('   ')).toThrow(/non-empty/i)
    expect(() => validateEmailDraftingPromptText(42 as unknown)).toThrow(/non-empty/i)
  })

  it('a valid prompt round-trips unchanged (no auto-append, unlike the drafting-prompt trace contract)', () => {
    const text = validPrompt('clean')
    expect(validateEmailDraftingPromptText(text)).toBe(text)
  })
})

describe('resolveEmailDraftingConfigDoc (pure, no DB)', () => {
  it('no stored config at all → both halves fall back to the repo, version null', () => {
    const doc = resolveEmailDraftingConfigDoc(null)
    expect(doc.promptSource).toBe('repo')
    expect(doc.houseVoiceSource).toBe('repo')
    expect(doc.promptText).toBe(loadEmailDraftingPromptTemplate())
    expect(doc.houseVoiceText).toBe(loadHouseVoiceDoctrine())
    expect(doc.promptVersion).toBeNull()
    expect(doc.requiredSlots).toEqual(REQUIRED_EMAIL_PROMPT_SLOTS)
  })

  it('only the prompt is configured → prompt config, voice still repo', () => {
    const custom = validPrompt('cfg')
    const doc = resolveEmailDraftingConfigDoc({
      prompt_version: 3,
      prompt_text: custom,
      house_voice_text: null,
    })
    expect(doc.promptSource).toBe('config')
    expect(doc.promptText).toBe(custom)
    expect(doc.houseVoiceSource).toBe('repo')
    expect(doc.houseVoiceText).toBe(loadHouseVoiceDoctrine())
    expect(doc.promptVersion).toBe(3)
  })

  it('only the doctrine is configured → voice config, prompt still repo', () => {
    const doc = resolveEmailDraftingConfigDoc({
      prompt_version: 1,
      prompt_text: null,
      house_voice_text: 'Be extra formal. Always sign "Regards,".',
    })
    expect(doc.promptSource).toBe('repo')
    expect(doc.houseVoiceSource).toBe('config')
    expect(doc.houseVoiceText).toBe('Be extra formal. Always sign "Regards,".')
  })

  it('a stored empty/whitespace override is treated as unset (repo fallback), not an empty string', () => {
    const doc = resolveEmailDraftingConfigDoc({
      prompt_version: 2,
      prompt_text: '   ',
      house_voice_text: '',
    })
    expect(doc.promptSource).toBe('repo')
    expect(doc.houseVoiceSource).toBe('repo')
  })
})

describe('composeEmailDraftingPrompt (pure, no DB)', () => {
  it('the pure repo-fallback doc composes BYTE-IDENTICAL to loadEmailDraftingPrompt()', () => {
    const doc = resolveEmailDraftingConfigDoc(null)
    expect(composeEmailDraftingPrompt(doc)).toBe(loadEmailDraftingPrompt())
  })

  it('substitutes a custom doctrine into the repo prompt template', () => {
    const doc = resolveEmailDraftingConfigDoc({
      prompt_version: 1,
      prompt_text: null,
      house_voice_text: 'CUSTOM DOCTRINE MARKER',
    })
    const composed = composeEmailDraftingPrompt(doc)
    expect(composed).toContain('CUSTOM DOCTRINE MARKER')
    expect(composed).not.toContain(HOUSE_VOICE_SLOT)
  })

  it('throws (never drafts undoctored email) when the resolved prompt lost the house-voice slot', () => {
    const doc: EmailDraftingConfigDoc = {
      promptText: 'A prompt with no doctrine slot at all.',
      promptSource: 'config',
      houseVoiceText: 'doctrine text',
      houseVoiceSource: 'repo',
      promptVersion: 1,
      requiredSlots: REQUIRED_EMAIL_PROMPT_SLOTS,
    }
    expect(() => composeEmailDraftingPrompt(doc)).toThrow(/house_voice_doctrine/)
  })
})

describe('emailVoiceChecks — unaffected by config-first (WP FB-D)', () => {
  it('checkEmailVoice takes only (subject, body) — it structurally cannot read a configured doctrine override', () => {
    expect(checkEmailVoice.length).toBe(2)
  })
})

// ── Live-DB coverage ─────────────────────────────────────────────────────────
const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url

// Whether migration 0180 (the email_drafting_config attribute/action kinds) has
// actually been applied to the wired DB. PLANNED ONLY as of this PR — until a
// future session applies it, the write-path round trip below skips instead of
// failing on "kind not found".
let migrationApplied = false
if (url) {
  const probe = new pg.Pool({ connectionString: url })
  try {
    const r = await probe.query(
      `SELECT 1 FROM attribute_kind_definition WHERE kind_name = 'email_drafting_config' AND status = 'active' LIMIT 1`,
    )
    migrationApplied = (r.rowCount ?? 0) > 0
  } catch {
    migrationApplied = false
  } finally {
    await probe.end()
  }
}

const TENANT = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002'
const runRead = describe.skipIf(!url)
const runWrite = describe.skipIf(!url || !migrationApplied)

runRead(
  'getEmailDraftingConfig — live-DB read path is migration-independent',
  { timeout: 90_000 },
  () => {
    it('a tenant with no config saved degrades safely to the byte-identical repo fallback (no throw, pre- or post-migration)', async () => {
      const ctx = { tenantId: TENANT, actorId: ATTORNEY }
      const doc = await getEmailDraftingConfig(ctx)
      // A prior test run against the SAME shared DB may have saved a config
      // (only possible once migration 0180 is applied) — assert the CONTRACT
      // (each half is either 'repo' with byte-identical text, or a legitimate
      // 'config' override), not a hardcoded 'repo' expectation.
      if (doc.promptSource === 'repo')
        expect(doc.promptText).toBe(loadEmailDraftingPromptTemplate())
      if (doc.houseVoiceSource === 'repo') expect(doc.houseVoiceText).toBe(loadHouseVoiceDoctrine())
      expect(doc.requiredSlots).toEqual(REQUIRED_EMAIL_PROMPT_SLOTS)
    })
  },
)

runWrite(
  'updateEmailDraftingConfig — live-DB round trip (post migration 0180)',
  { timeout: 90_000 },
  () => {
    const ctx = { tenantId: TENANT, actorId: ATTORNEY }

    it('set → get round-trips, bumps the version, and each half updates independently', async () => {
      const tag = randomUUID().slice(0, 8)
      const promptText = validPrompt(tag)

      const saved = await updateEmailDraftingConfig(ctx, { promptText })
      expect(saved.promptSource).toBe('config')
      expect(saved.promptText).toBe(promptText)
      const v1 = saved.promptVersion
      expect(v1).not.toBeNull()

      const fetched = await getEmailDraftingConfig(ctx)
      expect(fetched.promptText).toBe(promptText)
      expect(fetched.promptSource).toBe('config')
      expect(fetched.promptVersion).toBe(v1)

      // Update only the doctrine — the prompt override from above must survive.
      const voiceText = `Custom doctrine ${tag}`
      const savedVoice = await updateEmailDraftingConfig(ctx, { houseVoiceText: voiceText })
      expect(savedVoice.houseVoiceText).toBe(voiceText)
      expect(savedVoice.promptText).toBe(promptText) // untouched
      expect(savedVoice.promptVersion).toBe((v1 ?? 0) + 1)

      // Clearing the prompt back to default is itself a version-bumping change.
      const cleared = await updateEmailDraftingConfig(ctx, { promptText: null })
      expect(cleared.promptSource).toBe('repo')
      expect(cleared.promptText).toBe(loadEmailDraftingPromptTemplate())
      expect(cleared.houseVoiceText).toBe(voiceText) // untouched
      expect(cleared.promptVersion).toBe((v1 ?? 0) + 2)
    })

    it('rejects a prompt missing a required slot — no write happens', async () => {
      const before = await getEmailDraftingConfig(ctx)
      const bad = validPrompt('bad').replace('{{client_brief}}', '')
      await expect(updateEmailDraftingConfig(ctx, { promptText: bad })).rejects.toThrow(
        /client_brief/,
      )
      const after = await getEmailDraftingConfig(ctx)
      expect(after.promptVersion).toBe(before.promptVersion)
    })

    it('rejects a call with neither field set', async () => {
      await expect(updateEmailDraftingConfig(ctx, {})).rejects.toThrow(/nothing to update/i)
    })
  },
)
