import { submitAction, type ActionContext } from '@exsto/substrate'
import { listCapabilities, type CapabilitySpec } from '../queries/capabilities.js'

// Write API for the platform capability library. All writes go through the
// legal.capability.upsert action (hard rule #1); identified by stable slug so a
// re-seed / re-register updates in place.

export interface UpsertCapabilityInput {
  slug: string
  status?: 'available' | 'building' | 'requested' | 'deprecated'
  spec: CapabilitySpec
}

export async function upsertCapability(
  ctx: ActionContext,
  input: UpsertCapabilityInput,
): Promise<{ slug: string; status: string }> {
  await submitAction(ctx, {
    actionKindName: 'legal.capability.upsert',
    intentKind: input.status === 'requested' ? 'exploration' : 'enforcement',
    payload: { slug: input.slug, status: input.status ?? 'available', spec: input.spec },
  })
  return { slug: input.slug, status: input.status ?? 'available' }
}

// A slug is a stable, lowercase identifier derived from the capability name.
export function slugifyCapability(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// The service-builder's gap path: it wanted a capability the platform can't
// compose (a Tier-3 step/gate/field-type that needs code). File it into the
// library as `requested` so it's tracked and flips to `available` when built.
// Idempotent by slug: re-requesting the same capability updates it, never dupes.
export async function requestCapability(
  ctx: ActionContext,
  input: { name: string; purpose: string; whenToUse?: string; category?: string },
): Promise<{ slug: string; alreadyExists: boolean }> {
  const slug = slugifyCapability(input.name)
  const existing = (await listCapabilities(ctx)).find((c) => c.slug === slug)
  // Don't downgrade an already-available capability to requested — if it exists
  // and is live, the builder simply reuses it.
  if (existing && existing.status === 'available') {
    return { slug, alreadyExists: true }
  }
  await upsertCapability(ctx, {
    slug,
    status: 'requested',
    spec: {
      name: input.name,
      category: input.category ?? 'requested',
      purpose: input.purpose,
      when_to_use: input.whenToUse,
    },
  })
  return { slug, alreadyExists: false }
}
