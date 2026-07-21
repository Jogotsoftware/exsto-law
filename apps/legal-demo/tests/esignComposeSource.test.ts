// ESIGN-UNIFY-1 (ES-5b) — the unified EsignComposer's launch-mode pre-seed
// shapes, pinned against the pure helpers the compose page / composer / draft
// hook actually use. Three source modes: any-PDF upload, document-mode query
// params (the review-toolbar / matter-docs / chat launch), and workflow-step.
import { describe, expect, it } from 'vitest'
import {
  composerSourceFromParams,
  workflowStepRecipientRows,
  workflowStepUsesSigningOrder,
} from '@/lib/esignComposeSource'
import type { WorkflowStepRecipientSeed } from '@/components/esign/EsignComposer'

// A URLSearchParams-style getter over a plain record (null for absent keys),
// mirroring how the compose page passes `(k) => params.get(k)`.
function getter(params: Record<string, string>): (key: string) => string | null {
  return (key) => (key in params ? params[key]! : null)
}

describe('composerSourceFromParams — any-PDF upload mode', () => {
  it('no documentVersionId → upload mode (the eSign list CTA / blank chat launch)', () => {
    expect(composerSourceFromParams(getter({}))).toEqual({ kind: 'upload' })
  })

  it('an empty documentVersionId is treated as absent → upload mode', () => {
    expect(composerSourceFromParams(getter({ documentVersionId: '' }))).toEqual({ kind: 'upload' })
  })
})

describe('composerSourceFromParams — document mode (query-param launch)', () => {
  it('full launch (review toolbar / matter docs) carries version + entity + matter + title', () => {
    expect(
      composerSourceFromParams(
        getter({
          documentVersionId: 'ver-1',
          documentEntityId: 'doc-1',
          matterEntityId: 'mat-1',
          title: 'Engagement Letter',
        }),
      ),
    ).toEqual({
      kind: 'document',
      documentVersionId: 'ver-1',
      documentEntityId: 'doc-1',
      matterEntityId: 'mat-1',
      title: 'Engagement Letter',
    })
  })

  it('bare documentVersionId → document mode with optionals undefined, never empty string', () => {
    expect(composerSourceFromParams(getter({ documentVersionId: 'ver-2' }))).toEqual({
      kind: 'document',
      documentVersionId: 'ver-2',
      documentEntityId: undefined,
      matterEntityId: undefined,
      title: undefined,
    })
  })
})

describe('workflow-step mode — pre-seeded recipient rows', () => {
  const seeds: WorkflowStepRecipientSeed[] = [
    {
      name: 'Ada Client',
      email: 'ada@example.com',
      title: 'Managing Member',
      role: 'needs_to_sign',
      order: 1,
      key: 'client',
      label: 'Client',
    },
    {
      name: '',
      email: '',
      title: '',
      role: 'needs_to_sign',
      order: 2,
      key: 'attorney',
      label: 'Attorney of record',
    },
  ]

  it('keeps name/email/title/role/order/key and drops the display-only label', () => {
    expect(workflowStepRecipientRows(seeds)).toEqual([
      {
        name: 'Ada Client',
        email: 'ada@example.com',
        title: 'Managing Member',
        role: 'needs_to_sign',
        order: 1,
        key: 'client',
      },
      { name: '', email: '', title: '', role: 'needs_to_sign', order: 2, key: 'attorney' },
    ])
  })

  it('signing order OFF when every role is order 1 (parallel)', () => {
    expect(workflowStepUsesSigningOrder([{ order: 1 }, { order: 1 }])).toBe(false)
  })

  it('signing order ON when any role has order > 1 (sequential template)', () => {
    expect(workflowStepUsesSigningOrder(seeds)).toBe(true)
  })

  it('no recipients → signing order OFF', () => {
    expect(workflowStepUsesSigningOrder([])).toBe(false)
  })
})
