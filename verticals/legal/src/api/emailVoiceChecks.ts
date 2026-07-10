// STYLE-FIX-2 — deterministic house-voice checks for the EMAIL drafting path.
// Mirrors templates/house-voice.md — change both together.
//
// Mechanical, high-precision checks ONLY: em dash, exact banned phrases, the
// named adverb list, newsletter-header line shapes, and the plain sign-off.
// Anything that needs judgment (passive voice, evaluative interjections,
// binary contrasts) is the model's job via the doctrine in the prompt — a
// false positive here burns a corrective model call and cries wolf, so when
// in doubt a check stays out. The validator never blocks a draft: worst case
// is a flagged draft in the review queue, never a missing one.

export interface VoiceViolation {
  rule: 'em_dash' | 'banned_phrase' | 'filler_adverb' | 'body_header' | 'sign_off'
  where: 'subject' | 'body'
  offending: string
}

const MAX_VIOLATIONS = 20
const SNIPPET_MAX = 140

// The machine-checkable subset of house-voice.md's banned phrase lists: exact
// substring matches (case-insensitive, curly apostrophes normalized) that have
// no legitimate reading in a client email. Doctrine-only entries (e.g. "in
// today's [X]", vague declaratives) are deliberately absent — they need
// context a regex can't judge.
const BANNED_PHRASES: string[] = [
  // Throat-clearing openers (email register)
  'i hope this email finds you well',
  "i hope you're doing well",
  'i hope you are doing well',
  'i wanted to reach out',
  'i wanted to follow up',
  'just following up',
  'touching base',
  // Throat-clearing openers (stop-slop core)
  "here's the thing",
  "here's what",
  'here is what',
  "here's this",
  'here is this',
  "here's that",
  'here is that',
  "here's why",
  'here is why',
  'the uncomfortable truth',
  'it turns out',
  'let me be clear',
  'the truth is,',
  "i'm going to be honest",
  'i am going to be honest',
  'can we talk about',
  // Emphasis crutches
  'let that sink in',
  'this matters because',
  'make no mistake',
  // Filler phrases
  'at its core',
  "it's worth noting",
  'it is worth noting',
  'at the end of the day',
  'when it comes to',
  'in a world where',
  'the reality is',
  // Meta-commentary
  'let me walk you through',
  "as we'll see",
  'as we will see',
  'a feature, not a bug',
]

// The named adverb list from the doctrine, word-boundary matched. Deliberately
// the short list (not every -ly word): these eight are unambiguous filler in
// this register.
const BANNED_ADVERBS = [
  'really',
  'just',
  'simply',
  'actually',
  'truly',
  'genuinely',
  'honestly',
  'literally',
] as const

const ADVERB_RE = new RegExp(`\\b(${BANNED_ADVERBS.join('|')})\\b`, 'i')

// Newsletter-header line shapes (the exact 5/8-draft failure modes): a markdown
// heading, a whole-line bold "header", or a bold lead-in label ending with a
// colon. Plain prose lines ending with a colon are NOT flagged — a lead-in to a
// legitimate bullet list is normal writing.
const MD_HEADING_RE = /^\s{0,3}#{1,6}\s+\S/
const WHOLE_LINE_BOLD_RE = /^\s*\*\*[^*\n]+\*\*[:.]?\s*$/
const BOLD_LEADIN_COLON_RE = /^\s*\*\*[^*\n]{1,120}?(?::\*\*|\*\*\s*:)/
const SIGN_OFF_RE = /^(best|thanks),/i

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase()
}

function snippet(text: string): string {
  const t = text.trim()
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t
}

function collectTextViolations(
  where: 'subject' | 'body',
  text: string,
  out: VoiceViolation[],
): void {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (line.includes('—')) {
      out.push({ rule: 'em_dash', where, offending: snippet(line) })
    }
    const norm = normalize(line)
    for (const phrase of BANNED_PHRASES) {
      if (norm.includes(phrase)) {
        out.push({ rule: 'banned_phrase', where, offending: `"${phrase}" in "${snippet(line)}"` })
      }
    }
    const adverb = ADVERB_RE.exec(line)
    if (adverb) {
      out.push({
        rule: 'filler_adverb',
        where,
        offending: `"${adverb[1]!.toLowerCase()}" in "${snippet(line)}"`,
      })
    }
  }
}

function collectStructureViolations(body: string, out: VoiceViolation[]): void {
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    if (
      MD_HEADING_RE.test(line) ||
      WHOLE_LINE_BOLD_RE.test(line) ||
      BOLD_LEADIN_COLON_RE.test(line)
    ) {
      out.push({ rule: 'body_header', where: 'body', offending: snippet(line) })
    }
  }
}

function collectSignOffViolation(body: string, out: VoiceViolation[]): void {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const tail = lines.slice(-2)
  if (!tail.some((l) => SIGN_OFF_RE.test(l))) {
    out.push({
      rule: 'sign_off',
      where: 'body',
      offending: tail.length ? snippet(tail.join(' / ')) : '(empty body)',
    })
  }
}

export function checkEmailVoice(subject: string, body: string): VoiceViolation[] {
  const out: VoiceViolation[] = []
  collectTextViolations('subject', subject, out)
  collectTextViolations('body', body, out)
  collectStructureViolations(body, out)
  collectSignOffViolation(body, out)
  const seen = new Set<string>()
  const deduped = out.filter((v) => {
    const key = `${v.rule}|${v.where}|${v.offending}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return deduped.slice(0, MAX_VIOLATIONS)
}

const RULE_LABELS: Record<VoiceViolation['rule'], string> = {
  em_dash: 'No em dashes anywhere (subject or body)',
  banned_phrase: 'Banned phrase',
  filler_adverb: 'Banned filler adverb',
  body_header: 'No section headers or bold lead-in lines in the body',
  sign_off: 'Plain sign-off: "Best," or "Thanks," plus the sender\'s name',
}

// The ONE corrective-regenerate section appended to the assembled prompt when
// the first draft fails the checks. Names every violation with the offending
// text and shows the failing draft so "corrected" means keep the substance,
// fix the voice.
export function buildVoiceCorrectionSection(
  prev: { subject: string; body: string },
  violations: VoiceViolation[],
): string {
  const list = violations
    .map((v) => `- ${RULE_LABELS[v.rule]} (${v.where}): ${v.offending}`)
    .join('\n')
  return (
    `\n\n## House-voice correction (one retry)\n\n` +
    `Your previous draft violated these house-voice rules:\n\n${list}\n\n` +
    `Your previous draft, for reference:\n\n` +
    `SUBJECT: ${prev.subject}\n\n${prev.body}\n\n` +
    `Produce a corrected draft: keep the same substance and facts, remove every ` +
    `violation above, and re-check the full house-voice section before answering. ` +
    `Use the exact same output format (the SUBJECT line, a blank line, the body, ` +
    `the horizontal rule, the trace JSON).`
  )
}

// Payload-boundary sanitizer for the draft.generate handler: the violations
// travel as action payload JSON, so coerce back to the exact shape (or null when
// the producing path never ran the validator — documents, template merges).
export function sanitizeVoiceViolations(raw: unknown): VoiceViolation[] | null {
  if (!Array.isArray(raw)) return null
  const rules = new Set(['em_dash', 'banned_phrase', 'filler_adverb', 'body_header', 'sign_off'])
  const out: VoiceViolation[] = []
  for (const item of raw.slice(0, MAX_VIOLATIONS)) {
    if (!item || typeof item !== 'object') continue
    const v = item as Record<string, unknown>
    if (typeof v.rule !== 'string' || !rules.has(v.rule)) continue
    out.push({
      rule: v.rule as VoiceViolation['rule'],
      where: v.where === 'subject' ? 'subject' : 'body',
      offending: typeof v.offending === 'string' ? v.offending.slice(0, SNIPPET_MAX + 1) : '',
    })
  }
  return out
}
