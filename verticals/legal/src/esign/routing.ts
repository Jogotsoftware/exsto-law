// ESIGN-UNIFY-1 (ES-1) — pure role-aware routing decisions (design §9.2).
//
// The esign.send / esign.sign handlers (handlers/esign.ts) delegate their
// dispatch and completion decisions here so the role matrix is unit-testable
// without a live DB. Pure module: no DB, no React (same discipline as
// fields.ts / placements.ts).
//
// Rules (§9.2):
//   • needs_to_sign — routing-group delivery exactly as before roles existed:
//     the lowest-order unresolved group is active; blocks completion.
//   • needs_to_view — delivered WITH the first routing group regardless of its
//     own order (viewers gate nothing); never blocks completion; never
//     re-delivered by later groups.
//   • receives_copy — never delivered at send; notified only at completion.
//   • A request with NO role (every envelope sent before migration 0186) reads
//     as needs_to_sign — the only role that existed.

export type SignerRole = 'needs_to_sign' | 'needs_to_view' | 'receives_copy'

/** Defensive read: absent/unknown role values collapse to needs_to_sign. */
export function normalizeRole(role: string | null | undefined): SignerRole {
  return role === 'needs_to_view' || role === 'receives_copy' ? role : 'needs_to_sign'
}

export interface DispatchRecipient {
  role?: SignerRole | string | null
  order?: number | null
  // PRESIGN-1 — an attorney whose standing signature is applied automatically at
  // send (template role marked pre-signed). Such a recipient starts 'signed', is
  // never delivered/emailed, and is excluded from the first-signing-group
  // computation so the FIRST HUMAN signer (the client) is delivered instead.
  presigned?: boolean | null
}

// The initial signer_status for each recipient at send time. Index-aligned
// with the input. Orders default 1-based by position (the handler's existing
// rule); Math.min over no signing recipients yields Infinity → no signing
// group is delivered (the builder refuses signer-less envelopes upstream).
// A pre-signed recipient (PRESIGN-1) starts 'signed' and never counts toward the
// first deliverable group — so a pre-signed attorney at order 1 still lets the
// client at order 2 be the first delivered signer.
export function planInitialDispatch(
  recipients: DispatchRecipient[],
): Array<'delivered' | 'pending' | 'signed'> {
  const orders = recipients.map((r, i) => Number(r.order ?? i + 1) || 1)
  const firstSigningOrder = Math.min(
    ...recipients.flatMap((r, i) =>
      normalizeRole(r.role as string) === 'needs_to_sign' && !r.presigned ? [orders[i]!] : [],
    ),
  )
  return recipients.map((r, i) => {
    if (r.presigned) return 'signed'
    const role = normalizeRole(r.role as string)
    if (role === 'needs_to_view') return 'delivered'
    if (role === 'receives_copy') return 'pending'
    return orders[i] === firstSigningOrder ? 'delivered' : 'pending'
  })
}

export interface RoutingRequestState {
  requestId: string
  order: number
  status: string
  role: SignerRole
}

export interface NextDeliveryPlan {
  /** Request ids to promote pending → delivered now. */
  deliver: string[]
  /** True when every needs_to_sign request has signed/declined-resolved. */
  completed: boolean
}

// The post-sign routing decision: which pending SIGNING requests become active,
// or whether the envelope is complete. Viewers and copy recipients are ignored
// entirely — "all signers signed" iterates ONLY needs_to_sign requests
// (§9.2's completion rule), so an envelope whose last signer just signed
// completes even while a viewer never opened their link.
export function planNextDelivery(requests: RoutingRequestState[]): NextDeliveryPlan {
  const signing = requests.filter((r) => r.role === 'needs_to_sign')
  if (signing.length === 0) return { deliver: [], completed: false }
  const unresolved = signing.filter((r) => r.status !== 'signed' && r.status !== 'declined')
  if (unresolved.length === 0) return { deliver: [], completed: true }
  const minOrder = Math.min(...unresolved.map((r) => r.order))
  return {
    deliver: unresolved
      .filter((r) => r.order === minOrder && r.status === 'pending')
      .map((r) => r.requestId),
    completed: false,
  }
}

/** The receives_copy requests to notify once the envelope completes. */
export function copyRecipients(requests: RoutingRequestState[]): string[] {
  return requests.filter((r) => r.role === 'receives_copy').map((r) => r.requestId)
}

// esign-executed-copy-complete — once the envelope completes, EVERY signer
// (needs_to_sign — they already signed, since completion only fires once
// every needs_to_sign request is resolved) and every receives_copy recipient
// gets the executed document (sendEnvelopeCompletionCopies, api/esign.ts).
// needs_to_view is excluded: they never sign, and already got their view link
// at send (delivered with the first routing group, §9.2).
export function completionRecipients(requests: RoutingRequestState[]): string[] {
  return requests
    .filter((r) => r.role === 'needs_to_sign' || r.role === 'receives_copy')
    .map((r) => r.requestId)
}
