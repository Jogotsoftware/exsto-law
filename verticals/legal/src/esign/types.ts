// Provider-agnostic e-signature driver contract (Session 5, WP5.1).
//
// The substrate never learns which provider executed a signature. Callers, the
// substrate kinds (signature_envelope / signature_request / envelope_of), and
// the UI all speak this neutral vocabulary. OpenSign is the FIRST driver
// (drivers/opensign.ts); a DocuSign driver drops in behind this same interface
// via the registry (registry.ts) with zero changes to any caller — that is the
// seam the WP5.1 acceptance asks for.
//
// AGPL note (anti-pattern §6): OpenSign is integrated over its REST API as a
// separate self-hosted service. None of its source is vendored here.

// 'native' is the substrate's own sign-by-link engine — the default, no external
// host (the 2026-06-17 "rebuild within" decision). The others are external
// drivers behind the same seam (opensign/docusign dormant; stub for tests).
export type EsignProvider = 'native' | 'opensign' | 'docusign' | 'stub'

/** Canonical envelope lifecycle, identical across providers. */
export type EsignStatus = 'sent' | 'signed' | 'completed' | 'declined'

/** Per-signer state inside an envelope. */
export type SignerStatus = 'pending' | 'signed' | 'declined'

export interface EsignSigner {
  email: string
  name?: string
  /** 1-based signing order for sequential signing; omit for parallel. */
  order?: number
}

/** The bytes to be signed, content-type tagged (markdown today, PDF later). */
export interface EsignDocument {
  contentType: string
  body: string
  filename?: string
}

export interface SendEnvelopeInput {
  /** Neutral subject/title shown to signers — never carries a provider name. */
  subject: string
  document: EsignDocument
  signers: EsignSigner[]
  /**
   * Our envelope's correlation id. Round-tripped to the provider so an inbound
   * callback maps back to the substrate envelope even before we know the
   * provider's own id.
   */
  correlationId: string
}

export interface SendEnvelopeResult {
  /** The provider's own identifier for the dispatched envelope/document. */
  providerEnvelopeRef: string
  /** Per-signer signing URLs, when the provider returns them. */
  signerLinks?: Array<{ email: string; url: string }>
}

export interface EnvelopeStatusReport {
  providerEnvelopeRef: string
  status: EsignStatus
  signers: Array<{ email: string; status: SignerStatus }>
  /** The executed copy, present once the provider has produced it. */
  executedDocument?: EsignDocument | null
}

/** A verified, normalized inbound callback — same shape for every provider. */
export interface EsignCallbackEvent {
  providerEnvelopeRef: string | null
  /** Our round-tripped correlation id, when the provider echoes it back. */
  correlationId?: string | null
  status: EsignStatus
  /** The signer this event is about (for `signed` / `declined`). */
  signerEmail?: string | null
  /** The executed copy, present on `completed`. */
  executedDocument?: EsignDocument | null
  /** The raw provider payload, retained for raw_event_log provenance. */
  raw: Record<string, unknown>
}

/**
 * One driver per provider. Implementations are thin adapters over the
 * provider's API; all substrate writes happen in the action handlers, never
 * here (vertical CLAUDE.md: every write flows through submitAction).
 */
export interface EsignDriver {
  readonly provider: EsignProvider
  /** Dispatch an envelope. Requires a live host + credentials (Contract A). */
  sendEnvelope(tenantId: string, input: SendEnvelopeInput): Promise<SendEnvelopeResult>
  /** Reconciliation fallback: poll the provider for current envelope status. */
  getEnvelopeStatus(tenantId: string, providerEnvelopeRef: string): Promise<EnvelopeStatusReport>
  /** Verify + normalize an inbound webhook body into the canonical event. */
  parseCallback(args: {
    tenantId: string
    rawBody: string
    signature: string | null
  }): Promise<EsignCallbackEvent>
}

/** Raised when a driver is invoked without a connected provider host/creds.
 *  Callers treat this as "stop at the activation boundary", not a failure. */
export class EsignNotConfiguredError extends Error {
  readonly code = 'ESIGN_PROVIDER_NOT_CONFIGURED'
  constructor(message: string) {
    super(message)
    this.name = 'EsignNotConfiguredError'
  }
}
