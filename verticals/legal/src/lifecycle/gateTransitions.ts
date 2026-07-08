// WORKFLOW-AUTHORING-1 — the gate-transition vocabulary. Same disease as the
// invoke_capability config bug on a second axis: an edge's `via` (attorney/client
// gate) or `on` (system gate) must be an EXACT action/event kind the runtime
// dispatches on, but nothing ever told the builder which tokens exist, so it wrote
// prose ("Client submits intake and uploads…") or wrong punctuation ("invoice_paid"
// vs "invoice.paid") — producing a workflow that renders and approves but never
// advances at a client/system gate. Fix: hand the builder the exact tokens (context)
// and reject a non-vocabulary token with a specific error (validator).
//
// SINGLE SOURCE — these are the tokens the runtime matches on, verbatim:
//   • client `via`  → dispatchClientDelivery matches `e.via === actionKind`
//     (handlers/booking.ts 'booking.create', handlers/documentUpload.ts
//      'document.upload', handlers/clientMessage.ts 'client.message.post').
//   • system `on`   → dispatchLifecycleEvent(eventKind) (handlers/invoice.ts
//     'invoice.paid', handlers/esign.ts 'esign.completed', handlers/call.ts
//     'transcript.received').
//   • attorney `via`→ the two attorney advances (handlers/matterWorkflow.ts
//     'legal.matter.advance', handlers/draft.ts advanceInstanceOnApprove
//     'draft.approve').
// The `gate-transition-vocabulary` unit test pins these sets to those dispatch
// call sites, so a divergence is caught in CI rather than silently shipping a
// builder that offers a dead token. `automatic` edges are driven by advanceMatter,
// which follows any automatic edge regardless of `on`, so an automatic `on` is
// free-form (descriptive) and NOT constrained here.
import type { GateKind } from './types.js'

export interface GateTransitionOption {
  // The exact token to put in the edge (`via` for attorney/client, `on` for system).
  token: string
  // Plain-language description of what fires it — shown to the builder so it can
  // pick the right one from the attorney's words without guessing the token.
  label: string
}

// The advance tokens per gate. attorney/client edges name the token in `via`;
// system edges name it in `on`; automatic edges have no fixed vocabulary.
export const GATE_TRANSITION_VOCABULARY: Record<
  GateKind,
  { field: 'via' | 'on' | null; options: GateTransitionOption[] }
> = {
  attorney: {
    field: 'via',
    options: [
      {
        token: 'legal.matter.advance',
        label: 'The attorney clicks Continue in the matter window to move it forward.',
      },
      {
        token: 'draft.approve',
        label: 'The attorney approves the generated/reviewed document in the review queue.',
      },
    ],
  },
  client: {
    field: 'via',
    options: [
      { token: 'booking.create', label: 'The client books a consultation on the booking page.' },
      {
        token: 'document.upload',
        label: 'The client uploads a document (e.g. the requested materials) to the matter.',
      },
      {
        token: 'client.message.post',
        label: 'The client sends a reply/message in the portal thread.',
      },
    ],
  },
  system: {
    field: 'on',
    options: [
      { token: 'invoice.paid', label: 'The invoice for the matter is paid.' },
      { token: 'esign.completed', label: 'All signers finish a sent e-signature envelope.' },
      { token: 'transcript.received', label: 'A consultation transcript is imported.' },
    ],
  },
  // Automatic edges advance immediately via the worker/engine; `on` is descriptive
  // (advanceMatter follows any automatic edge), so no fixed token set applies.
  automatic: { field: 'on', options: [] },
}

// The allowed tokens for a gate that HAS a constrained vocabulary (attorney, client,
// system). Returns null for `automatic` (free-form).
export function allowedTransitionTokens(gate: GateKind): string[] | null {
  const entry = GATE_TRANSITION_VOCABULARY[gate]
  if (gate === 'automatic') return null
  return entry.options.map((o) => o.token)
}

// A precise error when an edge names a `via`/`on` token outside its gate's
// vocabulary — the exact analogue of diagnoseCapabilityStepConfig for gate
// transitions. Pure (no DB): the whole vocabulary is static. Names the offending
// token AND the allowed set so ONE correction lands it. An automatic edge is never
// constrained; an attorney/client edge with no `via` or a system edge with no `on`
// is left to validateLifecycle (which already requires them) so errors don't double.
export function diagnoseEdgeTransition(
  fromKey: string,
  toKey: string,
  gate: GateKind,
  via: string | undefined,
  on: string | undefined,
): string | null {
  const allowed = allowedTransitionTokens(gate)
  if (allowed === null) return null // automatic — free-form
  const field = GATE_TRANSITION_VOCABULARY[gate].field
  const token = (field === 'via' ? via : on)?.trim()
  if (!token) return null // absence is validateLifecycle's job, not this check
  if (allowed.includes(token)) return null
  return `stage "${fromKey}" → "${toKey}" is a ${gate} edge whose ${field} is "${token}", which is not a real advance token — the matter would never advance here. Use one of: ${allowed.join(', ')} (put it in the edge's "${field}").`
}
