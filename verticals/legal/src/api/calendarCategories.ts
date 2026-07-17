// ───────────────────────────────────────────────────────────────────────────
// Calendar categories / call types (color-coding). The firm's category PALETTE
// is config-as-data (hard rule 8): a SINGLETON workflow_definition row per tenant
// (kind_name `firm.calendar_categories`) whose `transitions.categories` is a
// list of {key,label,color}, written through legal.calendar.categories.update
// (versioned + audited, exactly like firm.booking_rules / 0059). A booking's
// chosen category is the `consultation_category` attribute on its matter, written
// through legal.booking.categorize. Reads default to a built-in starter palette
// until the firm saves one.
// ───────────────────────────────────────────────────────────────────────────
import { withActionContext, submitAction, type ActionContext } from '@exsto/substrate'

export interface CalendarCategory {
  key: string
  label: string
  color: string // hex, e.g. #2e7d52
}

// Starter palette (also the fallback when the firm has never configured one).
// Colors match the Legal Instruments comp's calendar legend exactly (WP-H).
export const DEFAULT_CALENDAR_CATEGORIES: CalendarCategory[] = [
  { key: 'consultation', label: 'Consultation', color: '#3b6fd4' },
  { key: 'follow_up', label: 'Follow-up', color: '#7a5ad1' },
  { key: 'court', label: 'Court', color: '#c4443b' },
  { key: 'internal', label: 'Internal', color: '#6b7690' },
]

const KIND = 'firm.calendar_categories'
const HEX = /^#[0-9a-fA-F]{6}$/

// Coerce a stored (possibly partial/stale) value into a clean, non-empty list.
// A malformed blob still yields a usable palette — reads never throw.
export function normalizeCalendarCategories(stored: unknown): CalendarCategory[] {
  const raw = (stored as { categories?: unknown })?.categories ?? stored
  if (!Array.isArray(raw)) return DEFAULT_CALENDAR_CATEGORIES
  const seen = new Set<string>()
  const out: CalendarCategory[] = []
  for (const item of raw) {
    const o = item as Partial<CalendarCategory>
    const key =
      typeof o?.key === 'string'
        ? o.key
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
        : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label = typeof o?.label === 'string' && o.label.trim() ? o.label.trim() : key
    const color =
      typeof o?.color === 'string' && HEX.test(o.color.trim()) ? o.color.trim() : '#64748b'
    out.push({ key, label, color })
  }
  return out.length ? out : DEFAULT_CALENDAR_CATEGORIES
}

async function readStoredCategories(ctx: ActionContext): Promise<unknown> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ transitions: unknown }>(
      `SELECT transitions FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        ORDER BY version DESC LIMIT 1`,
      [ctx.tenantId, KIND],
    )
    return res.rows[0]?.transitions ?? null
  })
}

// The firm's active palette, normalized (defaults when never configured).
export async function getCalendarCategories(ctx: ActionContext): Promise<CalendarCategory[]> {
  return normalizeCalendarCategories(await readStoredCategories(ctx))
}

// Same read, plus whether a row has ever been saved (`configured`). Callers
// (the Calendar page) use this to seed the starter palette as a REAL firm-
// category row on first load — config-as-data, not a code-only fallback —
// without re-seeding a firm that has genuinely saved its own palette.
export async function getCalendarCategoriesState(
  ctx: ActionContext,
): Promise<{ categories: CalendarCategory[]; configured: boolean }> {
  const stored = await readStoredCategories(ctx)
  return { categories: normalizeCalendarCategories(stored), configured: stored !== null }
}

// Persist the palette through the action layer. Returns the normalized result.
export async function updateCalendarCategories(
  ctx: ActionContext,
  categories: CalendarCategory[],
): Promise<CalendarCategory[]> {
  const next = normalizeCalendarCategories({ categories })
  await submitAction(ctx, {
    actionKindName: 'legal.calendar.categories.update',
    intentKind: 'adjustment',
    payload: { categories: next },
  })
  return next
}

// Set a matter's consultation category (a palette key). Empty/unknown clears it.
export async function categorizeBooking(
  ctx: ActionContext,
  input: { matterEntityId: string; categoryKey: string },
): Promise<{ matterEntityId: string; categoryKey: string }> {
  await submitAction(ctx, {
    actionKindName: 'legal.booking.categorize',
    intentKind: 'adjustment',
    payload: { matter_entity_id: input.matterEntityId, category_key: input.categoryKey },
  })
  return { matterEntityId: input.matterEntityId, categoryKey: input.categoryKey }
}
