// Granola adapter — STUB for v1.
//
// In production, this module will:
// 1. Accept a webhook POST from Granola when a call recording completes.
// 2. Validate the signature.
// 3. Fetch the transcript via Granola's API.
// 4. Insert a raw_event_log row, then project to a call_session + transcript
//    entity pair through the action layer (legal.call.simulate semantics
//    move to legal.call.received).
//
// For v1 (the wedge), the only entry point is `buildStubCallSession`, which
// produces a synthetic Granola-shaped payload from supplied inputs. The
// attorney UI exposes this as a "simulate call" button so we can exercise the
// end-to-end draft loop without a real call.

export interface StubCallInput {
  matterClientName: string
  matterCompanyName: string
  matterSummary: string
  questionnaireHighlights: Record<string, unknown>
}

export interface StubGranolaPayload {
  external_call_id: string
  started_at: string
  ended_at: string
  transcript_text: string
  transcript_source: 'stub'
}

export function buildStubCallSession(input: StubCallInput): StubGranolaPayload {
  const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const endedAt = new Date().toISOString()
  const transcript = renderStubTranscript(input)
  return {
    external_call_id: `stub-${Date.now()}`,
    started_at: startedAt,
    ended_at: endedAt,
    transcript_text: transcript,
    transcript_source: 'stub',
  }
}

function renderStubTranscript(input: StubCallInput): string {
  const highlights = Object.entries(input.questionnaireHighlights)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

  return [
    `[STUB CONSULTATION TRANSCRIPT — generated locally for the legal wedge demo, not a real Granola payload]`,
    ``,
    `Attorney (Juan Carlos): Thanks for taking the time today, ${input.matterClientName}. I want to confirm a few details about ${input.matterCompanyName}.`,
    `Client: Sure, ready when you are.`,
    `Attorney: From the intake form you sent in, here's what I'm working with:`,
    highlights,
    ``,
    `Attorney: Anything in there you want to change?`,
    `Client: No, that all matches our intent.`,
    `Attorney: Got it. I'll have Sage assemble the first draft and circulate it for revisions.`,
    ``,
    `Summary: ${input.matterSummary}`,
  ].join('\n')
}
