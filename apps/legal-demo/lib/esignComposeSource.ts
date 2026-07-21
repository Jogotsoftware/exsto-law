// ESIGN-UNIFY-1 (ES-5b) — pure launch-mode helpers for the unified EsignComposer,
// extracted so the composer's three source modes (any-PDF upload, document-mode
// query params, workflow-step) have their pre-seed shapes pinned by unit tests
// without loading the client component. Type-only imports are erased at build.
import type { ComposerSource, WorkflowStepRecipientSeed } from '@/components/esign/EsignComposer'
import type { DraftRecipient } from '@/components/esign/useEnvelopeDraft'

// The /attorney/esign/compose page mapping: with a documentVersionId the composer
// opens in DOCUMENT mode locked to that version (review toolbar / matter docs /
// chat launches carry the matter + title too); with none it opens in any-PDF
// UPLOAD mode. Optional params degrade to undefined, never '' — the composer
// treats absent matter/entity/title as "not provided".
export function composerSourceFromParams(get: (key: string) => string | null): ComposerSource {
  const documentVersionId = get('documentVersionId')
  if (!documentVersionId) return { kind: 'upload' }
  return {
    kind: 'document',
    documentVersionId,
    documentEntityId: get('documentEntityId') ?? undefined,
    matterEntityId: get('matterEntityId') ?? undefined,
    title: get('title') ?? undefined,
  }
}

// Workflow-step pre-seed: the template's pre-resolved role recipients become
// draft rows verbatim — name/email/title/role/order/key are kept so anchor-seeded
// fields and the send payload bind to the config's signer; the display-only
// `label` is dropped (it names an unresolved role, not a recipient).
export function workflowStepRecipientRows(seeds: WorkflowStepRecipientSeed[]): DraftRecipient[] {
  return seeds.map((r) => ({
    name: r.name,
    email: r.email,
    title: r.title,
    role: r.role,
    order: r.order,
    key: r.key,
  }))
}

// The signing-order toggle reflects what the template declared: any order > 1
// means a real sequential order; all-equal (all 1) means parallel (toggle OFF).
export function workflowStepUsesSigningOrder(rows: Array<{ order: number }>): boolean {
  return rows.some((r) => r.order > 1)
}
