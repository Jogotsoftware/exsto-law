// Model-facing record of an assistant turn that spoke through cards (WP4.1).
// Tool-call turns (ask_build_question, propose_*) often carry no prose, so their
// committed `content` is '' — and a turn absent from history means the model
// forgets it ever asked or proposed. Worse, the old stub ("[You presented N
// proposal card(s)]") dropped the CONTENT of every proposal, so mid-build the
// model could not see the service key, the template tokens, the questionnaire
// fields, or the workflow it had itself authored. Encode each card's actual
// substance compactly so the next request replays what was built.
//
// Deliberately structural/defensive over loose shapes (no imports from the card
// components): history encoding must never crash a send over a missing field.

interface BuildQuestionLike {
  key?: string
  question?: string
}
interface CardsLike {
  buildQuestions: BuildQuestionLike[]
  workflowProposals: Array<{
    serviceKey?: string
    summary?: string
    graph?: Array<{
      key?: string
      action?: { kind?: string }
      advances_to?: Array<{ gate?: string }>
    }>
  }>
  serviceProposals: Array<{
    displayName?: string
    derivedKey?: string
    route?: string
    generationMode?: string
    description?: string | null
  }>
  questionnaireProposals: Array<{
    serviceKey?: string
    schema?: {
      sections?: Array<{ fields?: Array<{ id?: string; memberFields?: Array<{ id?: string }> }> }>
    }
    missingForTokens?: string[]
    unusedFields?: string[]
  }>
  templateProposals: Array<{
    serviceKey?: string
    name?: string
    docKind?: string
    tokens?: string[]
    orphanTokens?: string[]
  }>
  costProposals: Array<{
    serviceKey?: string
    costType?: string
    amount?: string
    hours?: number | null
  }>
  enableProposals: Array<{ serviceKey?: string }>
  kindProposals: Array<{
    registry?: string
    kindName?: string
    onEntityKind?: string | null
    valueType?: string | null
  }>
  // Non-fatal warnings surfaced on this turn (e.g. the tool-round cap) — replayed
  // so the model knows a step was cut off and can resume it.
  notices?: string[]
}

// Each card's note is capped so one huge artifact can't blow the history budget;
// the full artifact lives on the card/substrate, the note is a reminder.
const MAX_NOTE_CHARS = 1500

function note(text: string): string {
  return text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)} …]` : text
}

function questionnaireFieldIds(
  schema: CardsLike['questionnaireProposals'][number]['schema'],
): string[] {
  const ids: string[] = []
  for (const s of schema?.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f.id) ids.push(f.id)
      for (const m of f.memberFields ?? []) if (m.id) ids.push(m.id)
    }
  }
  return ids
}

export function assistantHistoryContent(reply: string, cards: CardsLike): string | undefined {
  const notes: string[] = []
  for (const q of cards.buildQuestions) {
    notes.push(
      note(`[You asked via ask_build_question (key "${q.key ?? ''}"): ${q.question ?? ''}]`),
    )
  }
  for (const p of cards.serviceProposals) {
    notes.push(
      note(
        `[You proposed service "${p.displayName ?? ''}" (key ${p.derivedKey ?? '?'}; route=${p.route ?? '?'}, generation_mode=${p.generationMode ?? '?'}) as an approval card.]`,
      ),
    )
  }
  for (const p of cards.templateProposals) {
    notes.push(
      note(
        `[You proposed document template "${p.name ?? ''}" (${p.docKind ?? '?'}) for ${p.serviceKey ?? '?'}; tokens: ${(p.tokens ?? []).join(', ') || '(none)'}${p.orphanTokens?.length ? `; not yet covered by a question: ${p.orphanTokens.join(', ')}` : ''}. Body shown on the card.]`,
      ),
    )
  }
  for (const p of cards.questionnaireProposals) {
    const ids = questionnaireFieldIds(p.schema)
    notes.push(
      note(
        `[You proposed a questionnaire for ${p.serviceKey ?? '?'} with fields: ${ids.join(', ') || '(none)'}${p.missingForTokens?.length ? `; still missing for tokens: ${p.missingForTokens.join(', ')}` : ''}${p.unusedFields?.length ? `; unused fields: ${p.unusedFields.join(', ')}` : ''}.]`,
      ),
    )
  }
  for (const p of cards.workflowProposals) {
    const steps = (p.graph ?? [])
      .map(
        (s) =>
          `${s.key ?? '?'}(${s.action?.kind ?? 'manual_task'}/${s.advances_to?.[0]?.gate ?? 'terminal'})`,
      )
      .join(' → ')
    notes.push(note(`[You proposed a workflow for ${p.serviceKey ?? '?'}: ${steps || '(empty)'}]`))
  }
  for (const p of cards.costProposals) {
    notes.push(
      note(
        `[You proposed billing for ${p.serviceKey ?? '?'}: ${p.costType ?? '?'} ${p.amount ?? '?'}${p.hours ? ` (${p.hours}h)` : ''}.]`,
      ),
    )
  }
  for (const p of cards.kindProposals) {
    notes.push(
      note(
        `[You proposed a new ${p.registry ?? '?'} kind "${p.kindName ?? ''}"${p.onEntityKind ? ` on ${p.onEntityKind}` : ''}${p.valueType ? ` (${p.valueType})` : ''}.]`,
      ),
    )
  }
  for (const p of cards.enableProposals) {
    notes.push(note(`[You proposed ENABLING ${p.serviceKey ?? '?'} — the terminal card.]`))
  }
  if (notes.length || cards.notices?.length) {
    notes.push(
      '[The attorney approves cards in the UI; a confirmation message follows each approval.]',
    )
  }
  for (const n of cards.notices ?? []) notes.push(note(`[Notice shown to the attorney: ${n}]`))
  if (!notes.length) return undefined
  return [reply, ...notes].filter(Boolean).join('\n')
}
