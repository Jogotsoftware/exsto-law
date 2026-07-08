# BOOKING-CALENDAR-VIEW-1 — calendar view with blocked-off times on public /book/{slug}

Session 2026-07-08 · branch `booking-calendar-view-1` (off `main` @ `fda1d8f`, post-#305) · PR only · NO migration (presentational).

Replaces the public `/book/{slug}` flat slot-list with a CALENDAR view where unavailable times are visually blocked off (anonymous) and open times are clickable. Calendar is the default; the #305 list is a toggle. Presentational only — availability computation, booking write, contact creation, actor attribution, and the in-service path are untouched.

## Which component was reused + why (NOT the attorney WeeklyCalendar)
The brief pointed at the attorney calendar-section (`WeeklyCalendar.tsx`). Reading it: it renders `wcal-block-client` (client name / event title), `wcal-block-service` (event TYPE), and per-category colors — it is the attorney's PRIVATE view, and the brief forbids modifying it or leaking any of that. It cannot be reused on a public surface without either modifying it or leaking event detail.

**Reused `AvailabilityCalendar.tsx` instead** — the repo's EXISTING public availability calendar (the in-service `/book` page uses it). It is a weekly 7-column grid (+ a mobile day-accordion) whose `CalendarSlot` is `{ startIso, endIso, label, available }` — **it has no field for event detail at all**, and it already renders `available:false` cells as anonymous greyed disabled "taken" buttons. Reusing it IS the privacy-safe realization of the brief's "reuse the grid, strip all event detail": there is nothing to strip because the public component never had detail. The page already sits under the root `I18nProvider` and `bk-cal-*` CSS is global, so no wiring was needed.

## What changed (3 files, additive)
1. `getPublicAvailability` gained a `gridSlots: PublicGridSlot[]` field — the FULL computed candidate set (open + blocked), each cell `{ startIso, endIso, label, available }`. Same computed set as `slots`, just unfiltered and tagged. `slots` (open-only) is unchanged, so the list view AND the confirm no-double-book re-check are byte-identical. The availability COMPUTATION (`getGoogleAvailability`) is untouched.
2. `/book/[slug]/page.tsx` — a Calendar|List toggle (calendar default). Calendar view renders `<AvailabilityCalendar slots={gridSlots} onSelect={…} live />`; list view is the #305 day-grouped buttons. Both feed the SAME unchanged name/email/phone/reason form → confirm.
3. `public-booking-availability.test.ts` — added the data-layer anonymity assertion.

## THE PRIVACY GUARANTEE — busy/free only, never "what" (by construction)
Event detail cannot reach the public calendar, at three layers:
- The availability read uses the Google **freebusy** API (`queryBusyBlocks` → `calendar.freebusy.query`), which returns busy INTERVALS `{ start, end }` with **no titles** — not `events.list` (which has summaries). So a "Smith Deposition" title never enters the data path.
- `computeAvailabilityFromBusy` takes busy as `{ start:number; end:number }[]` — no title field exists to carry.
- `gridSlots` / `CalendarSlot` carry only `{ startIso, endIso, label, available }`; `label` is a time string from `generateCandidateSlots`. `AvailabilityCalendar` renders a blocked cell as a greyed "taken" button showing only the time.

## Acceptance
**A — calendar default + open/blocked.** `/book/{slug}` opens in the calendar view (`view` defaults to `'calendar'`). Real payload for `pacheco-law` (read-only): `gridTotal:98` → `gridOpen:96` (clickable) + `gridBlocked:2` (anonymous greyed). The 2 blocked are real-Google-busy times.

**B — PRIVACY (load-bearing).** The live `pacheco-law` gridSlots payload's keys are EXACTLY `["startIso","endIso","label","available"]` — no title, no client, no type, no color. Pacheco's 2 busy times render as `available:false` with `label:"Thu, Jul 9, 4:00 PM"` (the TIME only — no event title). Unit test asserts a blocked cell's label is identical to its free label (the busy state adds `available:false` and nothing else). Event detail is structurally impossible (freebusy carries no titles; the type has no detail field). A real seeded "Smith Deposition" would render exactly as this 4:00 PM block does — an anonymous "unavailable."

**C — honest intersection.** Real-Google-busy times → `available:false` (blocked); the true intersection (inside rules ∩ free) → `available:true` (clickable). Mapping for `pacheco-law` (10-day window): 96 open clickable + 2 blocked. Times outside bookable hours/days are not offered (absent from the grid / empty day column). Unit test (4/4) proves a busy interval + its buffer-adjacent slot are blocked, a free slot stays open.

**D — booking unchanged.** `git status` shows only 3 changed files; `submitPublicBooking`, the confirm route, contact creation, and actor attribution are byte-identical (the only `publicBooking.ts` change is the additive `gridSlots` field; the write path's `slots`-based check is unchanged). Booking an open cell runs the identical #305 flow (contact → Google hold → `booking.create` public-intake → confirmation).

**E — no calendar → no open availability.** Sandbox (no Google) → `configured:false`, `gridSlots:[]`, `slots:[]`; the page shows "hasn't connected a calendar yet." No fabricated open slots (unchanged from #305).

**F — no double-book.** `submitPublicBooking` still re-checks `slots` (open-only) at confirm and the Google event is the reservation — unchanged.

**G — mobile.** `AvailabilityCalendar` ships a `bk-cal-mobile` day-accordion (open counts per day, tap a day → its open/blocked slots); an open slot is tappable → the form. The list view is the graceful small-screen fallback via the toggle.

**Local gate:** `build` ✓ · `typecheck` ✓ · `lint` ✓ · `format:check` ✓ · `test:unit` **55/55** (public-booking-availability now 4/4) · invariants 16 pass / 77 DB-skipped (storage-guard 3/3).

## Files
`apps/legal-demo/app/book/[slug]/page.tsx` (calendar view + Calendar|List toggle) · `verticals/legal/src/api/publicBooking.ts` (additive `gridSlots`) · `tests/vertical/public-booking-availability.test.ts` (anonymity assertion). Reused read-only: `apps/legal-demo/components/AvailabilityCalendar.tsx` (unmodified). `WeeklyCalendar.tsx` untouched.

## Notes
- No migration; frontier untouched (booking stamped 0119; other sessions may claim 0120+).
- Did NOT modify `AvailabilityCalendar` or `WeeklyCalendar`, the availability computation, the booking write, settings, or the slug resolver.
- "Outside bookable hours" shows as an empty/absent column rather than an explicit greyed region (the grid lists bookable-hours candidates). A denser always-on time-grid (every hour greyed except open) is a future visual polish; the current rendering is honest (only true-open is clickable) and privacy-safe.
