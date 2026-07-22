// The ONE place the attorney app styles + orders a matter's STATUS chip. The label
// itself is derived server-side from the matter's live workflow (verticals/legal
// lifecycle/statusDisplay) and arrives on MatterSummary.stage / MatterDetail.stage —
// this module only maps its `category` to a color and a sort/filter order, so the
// matters list, the home dashboard, and the matter header all read identically.
//
// Kept in sync with StageCategory in verticals/legal/src/lifecycle/statusDisplay.ts.

export type StageCategory =
  | 'waiting_client'
  | 'waiting_attorney'
  | 'awaiting_billing'
  | 'awaiting_payment'
  | 'ready_to_close'
  | 'cancelled'
  | 'unknown'

export interface Stage {
  category: StageCategory
  label: string
}

interface StageStyle {
  fg: string
  bg: string
  // Fallback label for the filter dropdown when no matter of this category is loaded.
  filterLabel: string
  // Left-to-right lifecycle order for sorting the Status column.
  order: number
}

const STAGE_STYLE: Record<StageCategory, StageStyle> = {
  waiting_client: {
    fg: 'var(--li-info)',
    bg: 'var(--li-info-bg)',
    filterLabel: 'Waiting on client',
    order: 1,
  },
  waiting_attorney: {
    fg: 'var(--li-warn)',
    bg: 'var(--li-warn-bg)',
    filterLabel: 'Waiting on attorney',
    order: 2,
  },
  awaiting_billing: {
    fg: 'var(--li-gold)',
    bg: 'var(--li-gold-bg)',
    filterLabel: 'Awaiting billing',
    order: 3,
  },
  awaiting_payment: {
    fg: 'var(--li-gold)',
    bg: 'var(--li-gold-bg)',
    filterLabel: 'Awaiting payment',
    order: 4,
  },
  ready_to_close: {
    fg: 'var(--li-ok)',
    bg: 'var(--li-ok-bg)',
    filterLabel: 'Ready to close',
    order: 5,
  },
  cancelled: {
    fg: 'var(--li-danger)',
    bg: 'var(--li-danger-bg)',
    filterLabel: 'Cancelled',
    order: 6,
  },
  unknown: {
    fg: 'var(--li-neutral)',
    bg: 'var(--li-neutral-bg)',
    filterLabel: 'In progress',
    order: 7,
  },
}

const FALLBACK: StageStyle = STAGE_STYLE.unknown

export function stageStyle(category: string): { fg: string; bg: string } {
  const s = STAGE_STYLE[category as StageCategory] ?? FALLBACK
  return { fg: s.fg, bg: s.bg }
}

export function stageOrder(category: string): number {
  return (STAGE_STYLE[category as StageCategory] ?? FALLBACK).order
}

export function stageFilterLabel(category: string): string {
  return (STAGE_STYLE[category as StageCategory] ?? FALLBACK).filterLabel
}

// The categories that exist, in lifecycle order — for building a filter dropdown
// that always offers the full set rather than only the categories currently loaded.
export const STAGE_CATEGORIES: StageCategory[] = (Object.keys(STAGE_STYLE) as StageCategory[]).sort(
  (a, b) => STAGE_STYLE[a].order - STAGE_STYLE[b].order,
)
