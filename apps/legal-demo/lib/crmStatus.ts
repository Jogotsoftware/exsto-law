// Shared CRM status vocabulary (li-wp-j). Both clients and contacts are bucketed
// the same way server-side (verticals/legal/src/queries/contacts.ts
// deriveCrmBucket) — this is just the frontend's read of that same three-way
// split, used for the header-embedded status filter and the status chip on both
// CRM list tables and both detail pages.
export type CrmBucket = 'active' | 'prospective' | 'prior'

export interface CrmStatusMeta {
  label: string
  fg: string
  bg: string
}

export const CRM_STATUS_META: Record<CrmBucket, CrmStatusMeta> = {
  active: { label: 'Active', fg: 'var(--li-ok)', bg: 'var(--li-ok-bg)' },
  prospective: { label: 'Prospective', fg: 'var(--li-info)', bg: 'var(--li-info-bg)' },
  prior: { label: 'Prior', fg: 'var(--li-muted)', bg: 'var(--li-border-soft)' },
}

/** Options for the header-embedded status <select>, blank first (= no filter). */
export const CRM_STATUS_FILTER_OPTIONS: Array<{ value: '' | CrmBucket; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'prospective', label: 'Prospective' },
  { value: 'prior', label: 'Prior' },
]

export function formatCrmDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function crmInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase()
}
