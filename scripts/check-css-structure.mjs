#!/usr/bin/env node
// Structural guard for plain-CSS files: rejects selector-rules nested inside
// other selector-rules and unbalanced braces. Both are silently tolerated by
// prettier and cssnano (parsed as CSS Nesting), which let PR #359 splice the
// li-rev family inside `.li-set-btn` and dead-drop 136 rules on prod for a
// week. Run against globals.css before every push; wired into CI's verify job.
//
// Additional checks:
// - Title font drift: attorney page-title classes must not declare font-family (unless allowlisted).
// - One-off tab families: tab class families must not be hand-rolled (unless allowlisted).
//
// Usage: node scripts/check-css-structure.mjs <file.css> [...more files]
// Exit 0 = clean, 1 = findings (printed).

import { readFileSync } from 'node:fs'

// Allowlist for CHECK 1: title classes that legitimately declare font-family
// (serif/mono exceptions are intentional: client-portal hero, assistant empty state, editor head)
const TITLE_FONT_ALLOWLIST = new Set([
  'li-uac-empty-title', // serif - assistant empty state
  'li-cp-auth-title', // serif - client portal
  'li-edtr-head-title', // mono - editor head
])

// Allowlist for CHECK 2: tab classes currently defined
// (extend deliberately when adding a legit tab surface).
// li-tabs* = the shared controlled Tabs component; li-crm/mat/svc-tabs = NavTabs
// route variants; li-cp-tab = the client portal's dark-band variant (same
// underline pattern, portal palette — intentionally kept).
// Retired 2026-07-20 (consolidated onto Tabs.tsx): li-mail-tab*, li-bill-tab*,
// li-mat-billtab*, li-set-window-tab* — do NOT re-add.
const TAB_CLASS_ALLOWLIST = new Set([
  'li-tabs',
  'li-tabs-tab',
  'li-cp-tab',
  'li-crm-tabs',
  'li-mat-tabs',
  'li-svc-tabs',
])

function check(path) {
  const css = readFileSync(path, 'utf8')
  const findings = []
  const stack = []
  let inComment = false
  let inString = null
  let line = 1
  let buf = ''
  const rules = [] // Track top-level rules for additional checks

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
      stack.push({ sel, isAt, line, declStart: i + 1, declLine: line })
      buf = ''
    } else if (c === '}') {
      if (stack.length === 0) findings.push(`${path}:${line} extra closing brace at top level`)
      else {
        const rule = stack.pop()
        // For top-level rules, capture the full rule for additional checks
        if (stack.length === 0) {
          rules.push({ ...rule, declEnd: i, line: rule.declLine })
        }
      }
      buf = ''
    } else if (c === ';') {
      buf = ''
    } else {
      buf += c
    }
  }
  for (const open of stack)
    findings.push(`${path}: unclosed block "${open.sel.slice(0, 60)}" opened line ${open.line}`)

  // Run additional checks on top-level rules
  findings.push(...checkTitleFontDrift(path, css, rules))
  findings.push(...checkTabFamilies(path, css, rules))

  return findings
}

function checkTitleFontDrift(path, css, rules) {
  const findings = []
  const titlePattern = /\.li-[a-z0-9-]*title\b/
  const fontFamilyPattern = /font-family\s*:/i

  for (const rule of rules) {
    if (rule.isAt) continue // skip at-rules
    const selector = rule.sel
    // Check if selector contains a title class
    const titleMatches = selector.match(titlePattern)
    if (!titleMatches) continue

    // Extract the class name
    const classMatch = selector.match(titlePattern)
    if (!classMatch) continue
    const className = classMatch[0].slice(1) // remove the dot

    // Check if this class is in the allowlist
    if (TITLE_FONT_ALLOWLIST.has(className)) continue

    // Extract declarations
    const declStart = rule.declStart
    const declEnd = rule.declEnd
    const declarations = css.substring(declStart, declEnd)

    // Check for font-family declaration
    if (fontFamilyPattern.test(declarations)) {
      findings.push(
        `${path}:${rule.line} title class "${className}" declares font-family (not in allowlist); use base h1 rule instead`,
      )
    }
  }
  return findings
}

function checkTabFamilies(path, css, rules) {
  const findings = []
  const tabPattern1 = /\.li-[a-z0-9-]+-tabs?\b/
  const tabPattern2 = /\.li-tabs?\b/

  for (const rule of rules) {
    if (rule.isAt) continue // skip at-rules
    const selector = rule.sel

    // Check if selector contains a tab class
    let tabMatch = null
    let tabClass = null

    // Try pattern 1: .li-*-tabs or .li-*-tab
    const match1 = selector.match(tabPattern1)
    if (match1) {
      tabMatch = match1[0]
      tabClass = match1[0].slice(1) // remove the dot
    }

    // Try pattern 2: .li-tabs or .li-tab
    if (!tabMatch) {
      const match2 = selector.match(tabPattern2)
      if (match2) {
        tabMatch = match2[0]
        tabClass = match2[0].slice(1) // remove the dot
      }
    }

    if (!tabMatch || !tabClass) continue

    // Check if this class is in the allowlist
    if (TAB_CLASS_ALLOWLIST.has(tabClass)) continue

    findings.push(
      `${path}:${rule.line} tab class "${tabClass}" not in allowlist; tabs must go through Tabs.tsx (.li-tabs) or NavTabs (.nav-tabs variants)`,
    )
  }
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
