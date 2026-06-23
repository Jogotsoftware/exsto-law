// Canonical parser/formatter for substrate timestamps.
//
// Substrate reads serialize timestamps with Postgres
// `to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SSOF')`, which produces an HOUR-ONLY UTC
// offset for whole-hour zones — e.g. "2026-06-23T00:13:00+00" (or "-05").
// JS `new Date()` only accepts "Z", "±HH:MM", or "±HHMM"; a bare "±HH" offset
// parses to `Invalid Date`. That is the bug behind "every date on the review
// queue is showing invalid" — and it hits every surface that does
// `new Date(recordedAt)`. Normalizing the offset here fixes them all.

// A full ISO time followed by a bare ±HH offset (no minutes). Anchored on the
// time so a date-only string like "2026-06-23" is never mistaken for an offset.
const BARE_HOUR_OFFSET = /(T\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})$/

export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.replace(BARE_HOUR_OFFSET, '$1$2:00')
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

// Date + time, e.g. "6/22/2026, 8:13:00 PM". Falls back to a dash, never "Invalid Date".
export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  const d = parseTimestamp(value)
  return d ? d.toLocaleString() : fallback
}

// Date only, e.g. "6/22/2026".
export function formatDate(value: string | null | undefined, fallback = '—'): string {
  const d = parseTimestamp(value)
  return d ? d.toLocaleDateString() : fallback
}
