// ITEM-12 WP-1 — drift guard #2 (vitest-side; scripts/check-bundled-prompts.mjs
// is guard #1, wired into CI's `prompts:check` step). Proves each loader.ts
// prompt-loading function returns content byte-identical to the canonical .md
// file it mirrors in verticals/legal/templates/ — i.e. bundledPrompts.ts (the
// generated inlined-constants file that fixes the prod ENOENT on Netlify's
// standalone serverless bundle, see bundledPrompts.ts's header) has not
// drifted from its source. fs IS available in this test environment (unlike
// the deployed serverless bundle), so this can read the .md files directly
// and compare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  loadDraftingPrompt,
  loadReviewPrompt,
  loadRedlinePrompt,
  loadEmailDraftingPromptTemplate,
  loadHouseVoiceDoctrine,
  loadTranscriptExtractionPrompt,
} from '../../verticals/legal/src/templates/loader.js'

function readMd(file: string): string {
  return readFileSync(new URL(`../../verticals/legal/templates/${file}`, import.meta.url), 'utf8')
}

describe('bundled prompts stay in sync with their .md sources', () => {
  it('loadDraftingPrompt() === drafting-prompt.md', () => {
    expect(loadDraftingPrompt()).toBe(readMd('drafting-prompt.md'))
  })

  it('loadReviewPrompt() === document-review-prompt.md', () => {
    expect(loadReviewPrompt()).toBe(readMd('document-review-prompt.md'))
  })

  it('loadRedlinePrompt() === document-redline-prompt.md', () => {
    expect(loadRedlinePrompt()).toBe(readMd('document-redline-prompt.md'))
  })

  it('loadEmailDraftingPromptTemplate() === email-drafting-prompt.md', () => {
    expect(loadEmailDraftingPromptTemplate()).toBe(readMd('email-drafting-prompt.md'))
  })

  it('loadHouseVoiceDoctrine() === house-voice.md (trimmed)', () => {
    // loadHouseVoiceDoctrine() trims the raw file — same contract pre- and
    // post-bundling, so mirror that here rather than asserting raw equality.
    expect(loadHouseVoiceDoctrine()).toBe(readMd('house-voice.md').trim())
  })

  it('loadTranscriptExtractionPrompt() === transcript-extraction-prompt.md', () => {
    expect(loadTranscriptExtractionPrompt()).toBe(readMd('transcript-extraction-prompt.md'))
  })
})
