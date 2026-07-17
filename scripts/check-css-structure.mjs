#!/usr/bin/env node
// Structural guard for plain-CSS files: rejects selector-rules nested inside
// other selector-rules and unbalanced braces. Both are silently tolerated by
// prettier and cssnano (parsed as CSS Nesting), which let PR #359 splice the
// li-rev family inside `.li-set-btn` and dead-drop 136 rules on prod for a
// week. Run against globals.css before every push; wired into CI's verify job.
//
// Usage: node scripts/check-css-structure.mjs <file.css> [...more files]
// Exit 0 = clean, 1 = findings (printed).

import { readFileSync } from 'node:fs'

function check(path) {
  const css = readFileSync(path, 'utf8')
  const findings = []
  const stack = []
  let inComment = false
  let inString = null
  let line = 1
  let buf = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    const n = css[i + 1]
    if (c === '\n') line++
    if (inComment) {
      if (c === '*' && n === '/') {
        inComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && n === '*') {
      inComment = true
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inString = c
      continue
    }
    if (c === '{') {
      const sel = buf.trim().replace(/\s+/g, ' ')
      const parent = stack[stack.length - 1]
      const isAt = sel.startsWith('@')
      // Selector nested inside another selector-rule: valid CSS Nesting, but
      // in this codebase it is always an accident (a bad merge splice).
      if (parent && !parent.isAt && !isAt) {
        findings.push(
          `${path}:${line} selector "${sel.slice(0, 60)}" nested inside "${parent.sel.slice(0, 60)}" (opened line ${parent.line})`,
        )
      }
      stack.push({ sel, isAt, line })
      buf = ''
    } else if (c === '}') {
      if (stack.length === 0) findings.push(`${path}:${line} extra closing brace at top level`)
      else stack.pop()
      buf = ''
    } else if (c === ';') {
      buf = ''
    } else {
      buf += c
    }
  }
  for (const open of stack)
    findings.push(`${path}: unclosed block "${open.sel.slice(0, 60)}" opened line ${open.line}`)
  return findings
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: check-css-structure.mjs <file.css> [...]')
  process.exit(2)
}
let total = 0
for (const f of files) {
  const findings = check(f)
  total += findings.length
  for (const msg of findings) console.error(msg)
}
console.log(`css-structure: ${total} finding(s) across ${files.length} file(s)`)
process.exit(total === 0 ? 0 : 1)
