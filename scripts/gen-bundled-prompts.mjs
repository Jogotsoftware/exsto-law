#!/usr/bin/env node
// Generates verticals/legal/src/templates/bundledPrompts.ts from the 6
// canonical prompt .md files in verticals/legal/templates/. Same rationale as
// bundledBodies.ts (see its header): the legal vertical deploys as a Next.js
// standalone serverless bundle on Netlify, and a runtime readFileSync of a
// repo .md asset — even one listed in next.config's outputFileTracingIncludes
// — is not reliably present in the relocated function bundle (ENOENT in
// prod). Inlining the prompt bodies as string constants makes them part of
// the compiled JS, so they resolve in every environment with no filesystem
// dependency. ITEM-12 WP-1.
//
// Run `pnpm prompts:gen` after editing any of the 6 source .md files, then
// commit the regenerated bundledPrompts.ts alongside the .md change.
// `pnpm prompts:check` (wired into CI) fails the build if they drift apart.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const templatesDir = resolve(repoRoot, 'verticals/legal/templates')
const outFile = resolve(repoRoot, 'verticals/legal/src/templates/bundledPrompts.ts')

// [source .md file, exported constant name] — the 6 prompt files loader.ts
// currently reads via readFileSync at runtime.
export const PROMPT_FILES = [
  ['drafting-prompt.md', 'DRAFTING_PROMPT_BODY'],
  ['document-review-prompt.md', 'DOCUMENT_REVIEW_PROMPT_BODY'],
  ['document-redline-prompt.md', 'DOCUMENT_REDLINE_PROMPT_BODY'],
  ['email-drafting-prompt.md', 'EMAIL_DRAFTING_PROMPT_BODY'],
  ['house-voice.md', 'HOUSE_VOICE_DOCTRINE_BODY'],
  ['transcript-extraction-prompt.md', 'TRANSCRIPT_EXTRACTION_PROMPT_BODY'],
]

// Escape a raw string for embedding as a JS template literal: backslash,
// backtick, and `${` (the only three sequences that would otherwise break out
// of or corrupt the literal). Order matters — backslash first.
export function escapeForTemplateLiteral(raw) {
  return raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

export function renderBundledPromptsSource() {
  const parts = []
  parts.push(
    `// GENERATED FILE — DO NOT EDIT BY HAND.`,
    `// Produced by scripts/gen-bundled-prompts.mjs from the canonical .md files in`,
    `// verticals/legal/templates/. Edit the .md source, then run \`pnpm prompts:gen\``,
    `// to regenerate this file (\`pnpm prompts:check\`, wired into CI, fails the build`,
    `// if they drift apart).`,
    `//`,
    `// Why these live in code as string constants instead of being read from`,
    `// templates/*.md at runtime: the legal vertical is consumed by apps/legal-demo,`,
    `// which deploys as a Next.js standalone serverless bundle. \`readFileSync\` of a`,
    `// repo asset (even one listed in next.config \`outputFileTracingIncludes\`) is not`,
    `// reliably present in the relocated function bundle — the runtime path computed`,
    `// from \`import.meta.url\` does not match where the traced asset lands, so the`,
    `// read throws ENOENT in production (see bundledBodies.ts for the sibling`,
    `// document-body fix; this is the same problem for the 6 prompt files). Inlining`,
    `// the prompt bodies makes them part of the compiled JS, so they resolve in`,
    `// every environment with no filesystem dependency.`,
    ``,
  )
  for (const [file, constName] of PROMPT_FILES) {
    const raw = readFileSync(resolve(templatesDir, file), 'utf8')
    const escaped = escapeForTemplateLiteral(raw)
    parts.push(
      `// Mirrors verticals/legal/templates/${file}. Keep in sync via \`pnpm prompts:gen\`.`,
    )
    parts.push(`export const ${constName} = \`${escaped}\``)
    parts.push(``)
  }
  return parts.join('\n')
}

function main() {
  const source = renderBundledPromptsSource()
  writeFileSync(outFile, source, 'utf8')
  console.log(`prompts:gen wrote ${outFile}`)
}

// Only run when executed directly (not when imported by check-bundled-prompts.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
