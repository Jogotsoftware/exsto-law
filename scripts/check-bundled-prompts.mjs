#!/usr/bin/env node
// Drift guard: fails (exit 1) if verticals/legal/src/templates/bundledPrompts.ts
// is not byte-identical to what gen-bundled-prompts.mjs would produce right
// now from the canonical .md files — i.e. someone edited a .md prompt (or the
// generated file) without re-running `pnpm prompts:gen`. Wired into CI
// alongside css:check (see .github/workflows/ci.yml). ITEM-12 WP-1.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderBundledPromptsSource } from './gen-bundled-prompts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const outFile = resolve(repoRoot, 'verticals/legal/src/templates/bundledPrompts.ts')

function main() {
  const expected = renderBundledPromptsSource()
  let actual
  try {
    actual = readFileSync(outFile, 'utf8')
  } catch (err) {
    console.error(`prompts:check: ${outFile} does not exist — run \`pnpm prompts:gen\`.`)
    process.exit(1)
  }
  if (actual !== expected) {
    console.error(
      `prompts:check: verticals/legal/src/templates/bundledPrompts.ts is out of date ` +
        `with its source .md files under verticals/legal/templates/. Run \`pnpm prompts:gen\` ` +
        `and commit the result.`,
    )
    // Cheap line-count diff hint, no dependency on a diff library.
    const expectedLines = expected.split('\n')
    const actualLines = actual.split('\n')
    const max = Math.max(expectedLines.length, actualLines.length)
    let firstDiff = -1
    for (let i = 0; i < max; i++) {
      if (expectedLines[i] !== actualLines[i]) {
        firstDiff = i
        break
      }
    }
    if (firstDiff >= 0) {
      console.error(`  first differing line: ${firstDiff + 1}`)
      console.error(`  expected: ${(expectedLines[firstDiff] ?? '<EOF>').slice(0, 120)}`)
      console.error(`  actual:   ${(actualLines[firstDiff] ?? '<EOF>').slice(0, 120)}`)
    }
    process.exit(1)
  }
  console.log('prompts:check: bundledPrompts.ts is in sync with its .md sources')
}

main()
