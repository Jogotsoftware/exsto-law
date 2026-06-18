// Stub e-sign driver — a host-free implementation used by tests and local dev
// so the envelope lifecycle (WP5.2) is verifiable WITHOUT standing up a paid
// OpenSign host. It is NOT a fallback for production: production selects the
// real provider via DEFAULT_ESIGN_PROVIDER. Selecting 'stub' is explicit.
//
// It proves the seam from WP5.1: a second driver behind the same interface,
// added with zero changes to any caller.
import type {
  EsignCallbackEvent,
  EsignDriver,
  EnvelopeStatusReport,
  SendEnvelopeInput,
  SendEnvelopeResult,
} from '../types.js'

export const stubDriver: EsignDriver = {
  provider: 'stub',

  async sendEnvelope(_tenantId: string, input: SendEnvelopeInput): Promise<SendEnvelopeResult> {
    // No network call. A deterministic synthetic ref derived from our
    // correlation id, so callbacks crafted in tests map back predictably.
    return {
      providerEnvelopeRef: `stub-${input.correlationId}`,
      signerLinks: input.signers.map((s) => ({
        email: s.email,
        url: `https://stub.invalid/sign/${input.correlationId}/${encodeURIComponent(s.email)}`,
      })),
    }
  },

  async getEnvelopeStatus(
    _tenantId: string,
    providerEnvelopeRef: string,
  ): Promise<EnvelopeStatusReport> {
    return { providerEnvelopeRef, status: 'sent', signers: [], executedDocument: null }
  },

  // Tests pass an already-canonical JSON body; the stub trusts it (no secret).
  async parseCallback(args: {
    tenantId: string
    rawBody: string
    signature: string | null
  }): Promise<EsignCallbackEvent> {
    const p = JSON.parse(args.rawBody) as Partial<EsignCallbackEvent> & {
      raw?: Record<string, unknown>
    }
    return {
      providerEnvelopeRef: p.providerEnvelopeRef ?? null,
      correlationId: p.correlationId ?? null,
      status: p.status ?? 'sent',
      signerEmail: p.signerEmail ?? null,
      executedDocument: p.executedDocument ?? null,
      raw: p.raw ?? (JSON.parse(args.rawBody) as Record<string, unknown>),
    }
  },
}
