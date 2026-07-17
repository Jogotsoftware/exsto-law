// Canonical parser/formatter for substrate timestamps.
//
// Substrate reads used to serialize timestamps with Postgres
// `to_char(ts, '...SSOF')`, whose hour-only offset ("+00") JS `new Date()`
// rejects — the bug behind "every date shows Invalid Date". The server now
// emits full offsets ("+00:00" via `SSTZH:TZM`), but this normalizer keeps
// accepting the bare form: old strings live on in persisted payloads (saved
// threads, cached responses) and any straggler query.

// A full ISO time followed by a bare ±HH offset (no minutes). Anchored on the
// time so a date-only string like "2026-06-23" is never mistaken for an offset.
const BARE_HOUR_OFFSET = /(T\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})$/

export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  // A date-only value (e.g. an invoice due date) means that calendar day where
  // the user is — parse as LOCAL midnight. Bare `new Date('2026-07-06')` is UTC
  // midnight, which renders as the previous day in western timezones.
  const normalized =
    value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00`
      : value.replace(BARE_HOUR_OFFSET, '$1$2:00')
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

// Compact date + time, e.g. "Jul 13, 2026, 1:15 PM" — en-US short month, no
// seconds. Used where the comp shows a short "Generated <date>" timestamp
// (the review reader header) rather than formatDateTime's longer, seconds-
// bearing locale string.
export function formatDateTimeShort(value: string | null | undefined, fallback = '—'): string {
  const d = parseTimestamp(value)
  if (!d) return fallback
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
