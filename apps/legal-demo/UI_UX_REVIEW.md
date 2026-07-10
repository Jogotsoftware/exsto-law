# UI/UX Review — `apps/legal-demo`

**Date:** 2026-06-19 · **Branch:** `s8/esign` · **App:** Next.js 15.5.18 (App Router), React 18.3.1
**Rubric:** [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) (via the `web-design-guidelines` skill) + core accessibility/UX priorities.

## How this was produced

Six parallel reviewers each read one surface of the app and checked it against the rubric. Every claim is verified against the real source: contrast ratios computed with the WCAG relative-luminance formula, "missing" items confirmed by `grep`, line numbers taken from the actual files in `~/dev/exsto-law`. Styling is **plain CSS + a CSS-variable design-token system** in `app/globals.css` (5,479 lines; no Tailwind, no shadcn). Theme is **light-only**. Icons are hand-rolled SVGs.

**Severity scale:** `P0` critical (a11y blocker / broken UX) · `P1` high · `P2` medium · `P3` low/polish. No P0 was found.

**Finding format:** `[SEV] CATEGORY — path:line — issue → fix`

---

## Verdict

A **well-built foundation with a consistent, deliberate design system.** The issues are not "it looks bad" — they are mostly invisible-until-they-bite gaps: screen-reader support, keyboard support, deep-linking, and two places where a CSS class is referenced but never defined (so a screen renders unstyled). The highest-leverage fixes are cross-cutting: change the shared layer once and 5–6 screens improve together.

### What's genuinely good

- Color tokens **deliberately tuned for AA contrast** — `--muted` darkened to `#475569` (7.6:1) with an explanatory comment; badges and nav icons clear 7:1.
- Global a11y baseline: app-wide `:focus-visible` ring and a `prefers-reduced-motion` reset.
- Icons accessible **by construction** — the shared `<Svg>` wrapper sets `aria-hidden`/`focusable={false}` on every icon.
- E-signature **consent checkbox is correct** (real wrapped `<label>`, single hit target, starts unchecked) and **double-submit is genuinely prevented** (disabled + spinner + guard).
- Security-conscious auth: anti-enumeration messaging, open-redirect hardening (`safeInternalPath`), XSS-aware markdown rendering in the AI chat.
- Real empty/loading states almost everywhere.

---

## Cross-cutting fixes (highest leverage — fix once, help everywhere)

These recurred across multiple surfaces. Ordered by impact.

### 1. [P1] No `aria-live` regions anywhere → app is largely silent to screen readers
Every async update happens with no announcement. The booking flow already does this right (`app/book/page.tsx:642`) — copy that pattern.
- `app/attorney/page.tsx:225` — 45s calendar poll swaps data silently (use the "Live · updated" span at `WeeklyCalendar.tsx:233-246` as the live region)
- `components/UnifiedAssistantChat.tsx:471-535` — streaming AI replies
- `components/SignDocument.tsx:196-200` & `79-81` — signature submit error / success banners (legally consequential)
- `app/sign/[token]/page.tsx:38` & `app/portal/sign/[requestId]/page.tsx:33` — loading→loaded transition
- `app/portal/page.tsx:84-93,205-223` — timeline / messages
- `components/SearchBar.tsx:172` & `components/AttorneyTopNav.tsx:187-195` — search / notification results

### 2. [P1] Two referenced CSS classes have no definition → screens render unstyled
Verified independently by two reviewers.
- `.sign-panel` (`components/SignDocument.tsx:149`) has zero rules → the consent + Sign/Decline panel on the legal signing screen has no card/border/padding. → add a bordered card rule.
- `.doc-rendered` (used in 4 components, incl. public shared-draft `app/d/[versionId]/page.tsx:77`) has zero rules → document body spans full 820px with default styling and no readable measure. → add `max-width: 65ch; margin-inline:auto` + paragraph/heading/list spacing.

### 3. [P1] No skip link + no focus-to-main on route change
`app/layout.tsx:30-38` — keyboard users tab the full 11-item nav on every page; no `.sr-only`/skip utility exists. → add a visually-hidden "Skip to content" link as the first `<body>` child, `<main id="main" tabIndex={-1}>`, and focus it on pathname change.

### 4. [P1] App state isn't in the URL → no deep-link, broken Back, lost-on-refresh
- `components/WeeklyCalendar.tsx:86-88` & `app/attorney/calendar/page.tsx:104-105` — calendar view+date
- `app/book/page.tsx:136,151` — booking step (refresh → step 1; Back exits the flow)
- `app/attorney/matters/page.tsx:60-64` — matter filters/search/sort
- `components/Tabs.tsx` — active tab
- `app/portal/page.tsx:139-150` — selected matter
→ sync to query params (`useSearchParams` + `router.replace`).

### 5. [P1] Reusable interactive components miss keyboard/ARIA wiring
- `components/Tabs.tsx:23-41` — `role="tablist"` with no arrow-key nav / roving tabindex; tab↔panel not linked
- `components/SearchBar.tsx:155-170` — search input unlabeled; results not arrow-key navigable, no live count
- `app/attorney/matters/page.tsx:121-128` — sort headers are `<th onClick>` (not buttons) → keyboard-unreachable
- `components/WeeklyCalendar.tsx:323-332` — `role="grid"`/`gridcell` with no `role="row"` and no keyboard nav → broken ARIA contract that misleads AT

### 6. [P2] Touch targets below 44px — base button is the root cause
`globals.css:186-200` base `button` has no `min-height` (~36px). Specifics also short: nav icon buttons 38px (`globals.css:546-550`), booking slot buttons ~31px (`globals.css:4849`), calendar view buttons, language toggle ~26px. → `min-height: 44px` on base button + slot/nav controls; add `touch-action: manipulation`.

### 7. [P2] Two color tokens fail contrast as text
- `--warn` `#d97706` as small text = **3.19:1** (`globals.css:3446,3487`) → use `#92400e` for warn text (keep `#d97706` for fills)
- `--bk-slate-400` `#94a3b8` as info text = **~2.6:1** (`globals.css:3988`, used at `4703,4781,4823,4875,4928`) → use slate-500 `#64748b`

### 8. [P2] No `tabular-nums` anywhere → numbers jitter / columns misalign
Zero `font-variant-numeric` in the codebase, yet there are number columns everywhere (billing, calendar times, time/expense totals, matter dates). → add one `.tabular` utility, apply to numeric/time/money/date columns.

### 9. [P2] Dates & money hand-formatted, not `Intl` → hydration risk + wrong localization
`timeAgo` hardcoded (`app/attorney/page.tsx:96`); currency built as `` `$${x}` `` (`TimeExpensePanel.tsx:345`, `clients/page.tsx:186`); bare `toLocaleString()` in render (`sign/status:99`, `portal/page.tsx:166,179,288`, `d/[versionId]:67`). → `Intl.DateTimeFormat`/`Intl.NumberFormat` (with the matter currency), after mount or with `suppressHydrationWarning`.

### 10. [P2] Six `transition: all` declarations
`globals.css:4129,4325,4359,4730,4859,5156` → enumerate animated properties (transform, opacity, background, color, box-shadow).

### 11. [P3] No explicit `viewport` / `themeColor` / safe-area config
`app/layout.tsx:24-28`. Zoom is **not** broken (Next injects a default viewport), but there's no branded mobile chrome and no `env(safe-area-inset-*)`, so the sticky navy bar can collide with the iOS notch/home indicator. → export a `viewport` with `themeColor: '#0e1f3f'` and `viewportFit:'cover'`; add safe-area insets to sticky bars.

---

## Surface 1 — Global Design System & Foundation

### Strengths
- Strong, intentionally tuned text contrast: `--muted: #475569` (7.58:1, comment notes the AA tuning), all badge text colors clear 7:1, nav icons `#cdd9ea` hit 11.43:1 on navy, body `--fg` 17.85:1.
- App-wide `:focus-visible` ring (`globals.css:118-122`) + `prefers-reduced-motion` block (`123-132`).
- Icons accessible by construction: `<Svg>` sets `aria-hidden`/`focusable={false}` (`components/icons.tsx:18-19`).
- Icon-only nav buttons correctly labeled with `aria-label` + `aria-expanded`/`aria-haspopup` (`AttorneyTopNav.tsx:128-131,180-183,204-206`); `aria-current="page"` on active link (`:156`).
- Self-hosted fonts with `display:'swap'` as CSS vars (`layout.tsx:11-22`); `html lang="en"` set.
- Most `outline:none` instances are replaced with a box-shadow ring (`globals.css:263-268`).

### Findings
- `[P1] ACCESSIBILITY — app/layout.tsx:24-28 — no viewport meta exported (relies on Next default, unaudited) → add export const viewport = { width:'device-width', initialScale:1 } (do NOT set maximum-scale/user-scalable=no).`
- `[P1] ACCESSIBILITY — app/layout.tsx:30-37 — no skip-to-content link and no sr-only utility exists; keyboard users tab the whole 11-item nav on every page → add a .skip-link + reusable .sr-only.`
- `[P1] FOCUS — app/globals.css:1444-1448 — global search input sets outline:none and replaces it with only a 1px border-color change (near-invisible) → give .search-input:focus the box-shadow ring from :268.`
- `[P1] ACCESSIBILITY — components/SearchBar.tsx:155-170 — global search input has no label/aria-label and no autoComplete="off" → add aria-label + autoComplete="off" + spellCheck={false}.`
- `[P1] CONTRAST — app/globals.css:3446,3487 — --warn (#d97706) used as --text-xs foreground (3.19:1) fails AA → use #92400e for warn text, keep #d97706 for fills.`
- `[P2] ANIMATION — app/globals.css:4129,4325,4359,4730,4859,5156 — six transition:all declarations animate layout/paint props → enumerate transform/opacity/background/color/box-shadow.`
- `[P2] TYPOGRAPHY — app/globals.css (whole file) — no tabular-nums token/class, yet number columns exist → add .tabular utility, apply to numeric columns/times.`
- `[P2] TYPOGRAPHY — app/globals.css:161 — no text-wrap:balance on headings → add to h1–h3 to avoid widows.`
- `[P2] ACCESSIBILITY — components/AttorneyTopNav.tsx:188,210 — role="menu" popovers contain non-menuitem children → drop role="menu" on the notif popover; ensure every direct child of a real menu is a menuitem.`
- `[P2] TOUCH — app/globals.css:546-550,584-589 — nav icon buttons 38×38 and avatar button ~38px, under 44px → bump .att-icon-btn/.att-user-btn to 44px.`
- `[P2] ACCESSIBILITY — components/AttorneyTopNav.tsx:187-195 / SearchBar.tsx:172-194 — results/empty popovers update with no aria-live → wrap in aria-live="polite".`
- `[P3] THEMING — app/layout.tsx:24-28 — no themeColor; mobile chrome won't match navy (#0e1f3f) → add themeColor.`
- `[P3] LAYOUT/SAFE-AREA — app/globals.css (whole file) — no env(safe-area-inset-*); sticky navy bar + fixed footers collide with notch/home indicator → add safe-area padding.`
- `[P3] PERFORMANCE — app/globals.css:110 — background-attachment:fixed + backdrop-filter:blur(14px) on every section is scroll-jank prone on low-end devices → drop fixed attachment or reduce blur on long pages.`
- `[P3] I18N — components/AttorneyTopNav.tsx:140 — brand wordmark (FIRM_NAME/PRODUCT_NAME) has no translate="no" → add it so MT doesn't mangle the firm name.`

### Notes
- `globals.css` (5,479 lines) assessed via targeted greps + section reads, not a full dump. Contrast ratios computed (not estimated). `color-scheme: light` IS correctly set on `:root` and native inputs/selects get explicit `background`/`color` — light-only is by design, so dark-mode absence is acceptable. Roving-focus keyboard nav inside dropdowns is not implemented (flagged as the role-mismatch item).

---

## Surface 2 — Attorney Dashboard & Calendar

### Strengths
- Decorative SVGs hidden from AT app-wide (`icons.tsx:18-19`).
- Calendar event blocks are real semantic elements: app consultations are `<button>` (`WeeklyCalendar.tsx:130-137`), external events are `<a rel="noopener noreferrer">` (`:111-119`), each with a descriptive `aria-label`.
- Color tokens AA-tuned (`globals.css:21`).
- Good empty/loading states: per-section spinners (`page.tsx:221-250`), "No bookings yet." (`:251`), calendar empty state with a "jump to next event" button (`WeeklyCalendar.tsx:277-302`).
- Connected-but-failed Google reads surfaced explicitly (`page.tsx:212-219`, `calendar/page.tsx:394-406`).

### Findings
- `[P1] ACCESSIBILITY — app/attorney/page.tsx:225 — 45s poll swaps calendar data with no aria-live/aria-busy → wrap the "Live · updated" indicator (WeeklyCalendar.tsx:233-246) in aria-live="polite".`
- `[P1] ACCESSIBILITY — components/WeeklyCalendar.tsx:323-332 — role="grid"/gridcell with no role="row" and no keyboard nav → either drop the grid roles or implement a full grid (rows + arrow keys).`
- `[P1] NAV & STATE — components/WeeklyCalendar.tsx:86-88 — view/anchor in local useState, not deep-linkable, resets to today/week on reload → reflect in URL (?view=&date=).`
- `[P1] NAV & STATE — app/attorney/calendar/page.tsx:104-105 — same: view/anchor local state; reads ?create= once but never writes view/date back → put view+anchor in the URL.`
- `[P2] ACCESSIBILITY — components/WeeklyCalendar.tsx:201-208 — view switcher uses role="tablist"/tab/aria-selected but has no tabpanels/arrow-key semantics → use <button aria-pressed> (segmented toggle), or implement full tablist.`
- `[P2] TYPOGRAPHY — components/WeeklyCalendar.tsx:138,240-243 — event times / "updated" / month times have no tabular-nums → add font-variant-numeric:tabular-nums.`
- `[P2] FOCUS — components/WeeklyCalendar.tsx:209-217 — view-switch buttons are fully inline-styled (classes have no CSS) and active state is color-only → pair active state with weight/border; confirm inline styles don't suppress the global ring.`
- `[P2] TOUCH — components/WeeklyCalendar.tsx:209-211 — view buttons (padding .2rem .55rem), month chips (:472-491), reschedule/cancel (calendar/page.tsx:259-282) all well under 44px → bump to ≥44px hit area.`
- `[P2] CONTENT — app/attorney/page.tsx:48-49,251-269 — RecentBooking.status is fetched but never rendered; cancelled vs live look identical → render a status badge (or drop the unused field).`
- `[P2] I18N — app/attorney/page.tsx:96-107 — timeAgo hardcodes strings instead of Intl.RelativeTimeFormat and is computed from Date.now() in render (hydration drift) → use Intl.RelativeTimeFormat, guard hydration.`
- `[P2] HYDRATION — components/WeeklyCalendar.tsx:88,160 — anchor/today from new Date() in render; keep strictly client-only (currently is) and comment, or seed today in useEffect.`
- `[P3] ANIMATION — app/globals.css:2781-2787 — .wcal-block hover transform is fine; verify inline-styled month cells (WeeklyCalendar.tsx:454-466) have an intentional hover (currently none).`
- `[P3] ACCESSIBILITY — app/attorney/page.tsx:202 — no skip link; <main> has no landmark label → add skip link targeting <main>.`
- `[P3] FOCUS — components/FeedbackChat.tsx:38-56 — role="dialog" with no focus trap, no Escape, no return-focus → add them (open-focus into textarea at :20-22 is good).`
- `[P3] COPY — components/WeeklyCalendar.tsx:192,227 — prev/next labeled "Previous"/"Next" with no object → make view-aware ("Previous week").`
- `[P3] PERFORMANCE — components/WeeklyCalendar.tsx:103-105,260 — itemsOn(day) re-filters the full list per cell (7 week / 42 month) → bucket by day in a useMemo if volumes grow.`

### Notes
- `AttorneyTopNav.tsx` confirmed (via grep) to have no skip link / no aria-live, but not read in full. `UnifiedAssistantChat` (inside FeedbackChat) not reviewed here. Contrast pairings verified by token value.

---

## Surface 3 — Public Booking / Intake Flow

### Strengths
- Real multi-step progress indicator (desktop rail + mobile bar), accessible `<nav aria-label="Step n of N">`, working Back on every step (`book/page.tsx:722-765,554-558,594-601,676-679`).
- Inputs largely correct: `type="email"`/`inputMode="email"`, `type="number"`/`inputMode="decimal"`, `autoComplete`, real `<label htmlFor>` via `useId()` (`:517-525,784-805,869-897`). Phone uses `react-phone-number-input`.
- "Taken" slots disabled + disambiguated by line-through + label (not color-only), with `aria-label`/`title` (`AvailabilityCalendar.tsx:223-227`).
- Honest live-vs-sample availability: green "Live" badge suppressed for stub data (`AvailabilityCalendar.tsx:170-177`).
- Dates/times localize via `toLocaleString` with `es-US` when Spanish; slots show resolved timezone; `<html lang>` updates on toggle.
- Slot-conflict (`SLOT_TAKEN`) re-fetches + clears stale selection; single-use CAPTCHA token reset after failed submit.

### Findings
- `[P1] A11Y/FORMS — app/book/page.tsx:450-454 — on validation failure a top banner renders but focus isn't moved to it or the first invalid field → move focus on setError; set aria-invalid + aria-describedby on fields.`
- `[P1] FORMS — app/book/page.tsx:794-802,857-897,962-1024 — no required/aria-required on contact step; "*" baked into the translated label string → pass required/aria-required={field.required}, render asterisk as separate aria-hidden mark.`
- `[P1] A11Y — components/AddressAutocomplete.tsx:115-164 — Google Places field has no combobox semantics (no role="combobox", aria-expanded/controls/autocomplete/activedescendant) → add combobox ARIA + aria-live result count, or adopt PlaceAutocompleteElement.`
- `[P2] A11Y/CONTRAST — app/globals.css:3988 — --bk-slate-400 (#94a3b8) ≈2.6:1 used for info text (calendar meta, timezone, day headers, taken-slot times, day count) → darken to ~#64748b.`
- `[P2] TOUCH/CORE UX — app/globals.css:4849-4860 — slot buttons ~31px (padding .5rem .35rem, no min-height) — the flow's primary tap target → set min-height:44px on .bk-slot.`
- `[P2] TOUCH — app/globals.css:4720-4724,4120-4127 — calendar arrows 40×40, language-toggle ~26px → bump arrows to 44px, add min-height to .lang-toggle-btn.`
- `[P2] FORMS — app/book/page.tsx (whole flow) — no draft persistence and no warn-before-unload; multi-step intake lost on refresh/close → add beforeunload guard + sessionStorage autosave of contact/intakeResponses/members.`
- `[P2] NAV & STATE — app/book/page.tsx:136,151-160 — step in React state only; refresh drops to step 1, Back exits the flow → reflect step in URL, wire Back/Next to history.`
- `[P3] FORMS — app/book/page.tsx:517-525 — email input lacks spellCheck={false}/autoCapitalize="none" → add them.`
- `[P3] PERFORMANCE — app/layout.tsx:30-37 / components/Turnstile.tsx:18 / AddressAutocomplete.tsx — no preconnect to challenges.cloudflare.com or maps.googleapis.com → add <link rel="preconnect">.`
- `[P3] THEMING/LAYOUT — app/layout.tsx:24-28 — no theme-color, no viewport-fit=cover, no safe-area insets → export viewport (themeColor + viewportFit:'cover') and apply insets.`
- `[P3] HOVER/A11Y — app/globals.css:4906-4920 — empty days are focusable <button disabled> showing "—", adding keyboard tab stops with no action → render empty days as non-button elements.`
- `[P3] COPY — lib/i18n.tsx:21 + app/book/page.tsx:500,563,599 — every step CTA is generic "Continue" → use step-specific labels.`

### Notes
- `.bk-*`/`.lang-toggle`/slot/calendar sections assessed, not the whole CSS file. Server-side counterparts (`/api/client/mcp`, `lib/captcha.ts`) out of scope. Reduced-motion handled globally (incl. `bkShake`). Touch/contrast computed from CSS tokens + box model.

---

## Surface 4 — E-Signature Flow

### Strengths
- Consent checkbox correct: `<label>` wraps the `<input type="checkbox">` + disclosure (`SignDocument.tsx:188-194`), one hit target, starts unchecked (`:47`). The single most important legal-UX detail, done right.
- Double-submit prevented: Sign disabled on `busy || !signatureName.trim() || !consent` with spinner + "Signing…" (`:203-210`); Decline disabled while busy; handlers guard with `finally` (`:110-134`).
- Decline is confirmed + subordinate: in-app confirm dialog (native confirm replaced in RUNNER-FIXES-1), secondary `.danger` style, specific copy.
- Strong state coverage: distinct screens for already-resolved, not-your-turn, signed, all-completed, declined (`:69-108`).
- Attorney prepare validates before send: blocks on zero signers + unknown signer keys with a fixable message (`prepare/[versionId]/page.tsx:121-131,303-307`).
- Public token page degrades gracefully: failed load → "invalid or expired" + fallback (`sign/[token]/page.tsx:22,28-34`).

### Findings
- `[P1] FORMS — components/SignDocument.tsx:205-207 — Sign button disabled until name+consent present → a user who forgets a field gets a dead, unexplained button → keep enabled, validate on click, inline error (aria-live) + focus first empty required field.`
- `[P1] FORMS — components/SignDocument.tsx:150-174 — signer inputFields have no required validation; can sign with required text/date/initial blank → validate each required field on submit, aria-invalid, focus first invalid before onSign.`
- `[P1] ACCESSIBILITY — components/SignDocument.tsx:196-200 — submit error banner has no aria-live/role="alert" (legally consequential) → add role="alert"; same for success/decline alerts (:79-81).`
- `[P1] CONTENT — components/SignDocument.tsx:149 — .sign-panel has NO CSS rule anywhere → the signature/consent/actions panel renders unstyled → add a bordered card rule (or reuse a card token).`
- `[P1] ACCESSIBILITY — app/attorney/sign/prepare/[versionId]/page.tsx:251-268 — signer-row inputs are placeholder-only (no label); email lacks type="email"/inputMode/autoComplete → add labels + type="email" inputMode="email" autoComplete="email".`
- `[P2] FORMS — components/SignDocument.tsx:180-187 — adopted-signature name input has no autoComplete="name", no aria-required, placeholder isn't an example → add them + mark required.`
- `[P2] FORMS — components/SignDocument.tsx:155-163 — per-field <label> not associated (no htmlFor/id); check-type checkbox unlabeled → add id+htmlFor or wrap input in label.`
- `[P2] THEMING — app/layout.tsx:24-29 — no viewport export (risks unscaled mobile rendering of a wide legal doc) → add viewport (width=device-width, initial-scale=1; do NOT disable zoom) + themeColor.`
- `[P2] TOUCH — app/globals.css:186-200 — base button has no min-height (~36px), no touch-action; Sign/Decline below 44px where signing happens → min-height:44px + touch-action:manipulation.`
- `[P2] I18N — app/attorney/sign/status/[envelopeId]/page.tsx:99 — signedAt is bare new Date().toLocaleString() in render (hydration risk; ignores i18n locale; absolute-only) → Intl.DateTimeFormat from the provider; consider relative+absolute.`
- `[P2] NAV & STATE — components/SignDocument.tsx:46-194 — no unsaved-changes guard; typed name/consent/fields lost on refresh mid-signature → beforeunload warning when dirty and unresolved.`
- `[P3] COPY — components/SignDocument.tsx:209,211 — "Adopt & Sign" / "Decline" → "Adopt & Sign Document" / "Decline to Sign" so the action is self-describing.`
- `[P3] ACCESSIBILITY — app/sign/[token]/page.tsx:38-42 / app/portal/sign/[requestId]/page.tsx:33-37 — loading block has no role="status"/aria-live → wrap loading + mount region in aria-live="polite".`
- `[P3] TYPOGRAPHY — app/attorney/sign/prepare/[versionId]/page.tsx:248,271 — placeholders don't follow …/example convention; ✕ remove button is icon-only with no aria-label → add aria-label="Remove signer".`
- `[P3] CONTENT — app/attorney/sign/status/[envelopeId]/page.tsx:104-107 — status is text+badge (good, not color-only) but no auto-refresh, Refresh has no busy state, no empty state for signers=[] → add busy indicator + empty row.`

### Notes
- API routes (`/api/sign/*`) and MCP tools out of scope. `.doc-rendered` IS used here but has no CSS (see cross-cutting #2); renderer (`lib/draftExport.ts`) escapes HTML before injecting, so `dangerouslySetInnerHTML` is not an XSS finding. Long-document mobile readability worth a manual check. Reduced-motion + focus-visible pass app-wide.

---

## Surface 5 — Client Portal & Auth

### Strengths
- Magic-link login is the best-built form in the app: single labeled `<input id="portal-email">` with `type="email"`, `required`, `autoComplete="email"`, real example placeholder; distinct consuming/sent/error phases incl. "Check your email" and an expired-link retry (`portal/login/page.tsx:78-125`).
- Security-conscious: anti-enumeration messaging (`:58-65`); `safeInternalPath` hardens every post-auth redirect against open-redirect (callback + `auth/complete/page.tsx:21`).
- Pay route honestly scoped: a "coming soon" page with no invoice fetch and no pay button → no double-charge risk today (`pay/[invoice]/page.tsx:1-7`).
- Consistent loading affordance (spinner + "Loading…") across portal/shared-draft/callback.
- Proper ellipsis + curly apostrophes; specific button labels ("Send sign-in link", "Sign in with Google"). Cmd/Ctrl+Enter to send messages (`portal/page.tsx:309-311`).

### Findings
- `[P1] ACCESSIBILITY — app/layout.tsx:30-38 — no skip link, no focus-to-main on route change anywhere (no template.tsx) → add skip link → #main, <main id="main" tabIndex={-1}>, focus on pathname change.`
- `[P1] CONTENT — app/d/[versionId]/page.tsx:77-80 — .doc-rendered has zero CSS → shared-draft body spans full 820px with default spacing, no readable measure → add .doc-rendered rule (max-width:65ch; margin-inline:auto + spacing).`
- `[P1] I18N — app/portal/page.tsx:166,179,288 — consultation time, milestone dates, message timestamps use toLocaleString/toLocaleDateString with no options/guard (hydration + uncontrolled format) → fixed Intl.DateTimeFormat, render after mount.`
- `[P1] HYDRATION — app/d/[versionId]/page.tsx:67 — new Date(recordedAt).toLocaleDateString() on a public indexable page → stable Intl.DateTimeFormat.`
- `[P2] ACCESSIBILITY — app/portal/page.tsx:84-93,205-223 — timeline/messages load with no aria-live → wrap async region in aria-live="polite".`
- `[P2] ACCESSIBILITY — app/portal/page.tsx:154-186 — status conveyed by bold text only → add a status badge with shape/label, not just bold.`
- `[P2] FORMS — app/portal/login/page.tsx:116-125 — email input missing inputMode="email"/spellCheck={false}/autoCapitalize="none" → add them.`
- `[P2] CORE UX — app/portal/login/page.tsx:48-66 — on network failure the form shows the "sent" success state → keep neutrality for server responses, but surface a real "Couldn't reach the server" on fetch rejection.`
- `[P2] CONTENT — app/portal/page.tsx:95-101 — top-level errors render the raw thrown message full-bleed, replacing the page, no retry → friendly message + "Try again", keep page chrome.`
- `[P2] NAV & STATE — app/portal/page.tsx:139-150 — selected matter is component state only, not deep-linkable → store in ?matter=.`
- `[P2] ACCESSIBILITY — app/portal/page.tsx:51-64 — 401 redirect via window.location.href causes a full reload flash → consider router.replace for the in-app bounce.`
- `[P3] PERFORMANCE — app/layout.tsx:24-28 — no themeColor / viewport-fit=cover → add viewport/themeColor + safe-area insets on .public-draft.`
- `[P3] TYPOGRAPHY — app/portal/page.tsx:160 / app/d/[versionId]/page.tsx:64 — headings lack text-wrap:balance → add to h1,h2.`
- `[P3] TOUCH — app/globals.css:186-241 — buttons/inputs have no touch-action:manipulation / tap-highlight reset; .public-draft lacks overscroll-behavior → add them.`
- `[P3] HOVER/FOCUS — app/page.tsx:47-50 — Google sign-in button has no loading state; stays clickable during redirect → set submitting state, "Redirecting to Google…" + disable.`
- `[P3] CONTENT — app/page.tsx:24-27,46 — OAuth error path renders decodeURIComponent(err) from the URL directly (text-only, no XSS, but attacker-controlled copy) → map to an allow-list of error codes + generic fallback.`
- `[P3] NAV & STATE — app/auth/complete/page.tsx:15-22 — on failed/looping auth the "Finishing up…" screen can flash indefinitely → add a timeout that surfaces "Something went wrong — return to sign-in".`

### Notes
- `app/page.tsx` is the Google OAuth sign-in (no separate marketing landing). The `.surface-client` theme the brief referenced is effectively **not applied** to portal/auth screens (only ever *removed* in `AttorneyTopNav.tsx:72`); these use `.public-draft` (820px). The pay screen's Intl/double-charge/disabled-button items are **N/A today** (no payment form built) — revisit when it lands. `app/portal/sign/` (s8/esign) covered under Surface 4. No `template.tsx`/focus-management found anywhere (drives the skip-link finding).

---

## Surface 6 — Matter Workspace, Lists & Panels

### Strengths
- `CollapsibleSection.tsx:21` builds on native `<details>`/`<summary>` — keyboard + `aria-expanded` for free; chevron correctly `aria-hidden`.
- Global a11y baseline solid (`globals.css:118,123`).
- Matters list uses a semantic `<table>` with real `<thead>/<th>` and `aria-sort` on the active column (`matters/page.tsx:121-128`), sensible default sort per column type (`:88`).
- Base form controls declare explicit `background`/`color` (`globals.css:243-253`) → native dropdowns render correctly under light theme.
- `UnifiedAssistantChat.tsx` hardens output: `isHttpUrl` (`:78`) blocks `javascript:`/`data:`; markdown escaped before formatting.
- Differentiated empty states — "No matters yet." vs "No matches." (`matters/page.tsx:192`).

### Findings
- `[P1] ACCESSIBILITY — components/Tabs.tsx:23-41 — role="tablist" with no arrow-key nav / roving tabIndex; tab↔panel not linked → add Left/Right/Home/End handlers, id+aria-controls on tabs, id+aria-labelledby+tabIndex on panel.`
- `[P1] ACCESSIBILITY — components/Tabs.tsx:38 — single role="tabpanel" reused for every tab, no aria-labelledby/tabIndex → label from active tab, make focusable.`
- `[P1] ACCESSIBILITY — app/attorney/matters/page.tsx:121-128 — sort headers are <th onClick> (not buttons) → wrap label in <button type="button"> inside <th> (keep aria-sort on th).`
- `[P1] ACCESSIBILITY — components/UnifiedAssistantChat.tsx:471-535 — streaming message list has no aria-live → add aria-live="polite" aria-atomic="false" (or a visually-hidden mirror of the latest reply).`
- `[P1] ACCESSIBILITY — components/UnifiedAssistantChat.tsx:538-545 — composer <textarea> has only a placeholder → add visually-hidden <label htmlFor> or aria-label="Message the assistant".`
- `[P1] ACCESSIBILITY — components/SearchBar.tsx:155-170 — global search has no label; results have no aria-live count and aren't keyboard-navigable (no role=listbox/combobox, no arrow keys) → add aria-label, aria-live "N results", Up/Down/Enter handling.`
- `[P1] FORMS — components/UnifiedAssistantChat.tsx:185-256 — no stop/cancel control while a reply streams → add a "Stop" button (abort the stream) while busy.`
- `[P1] NAV & STATE — app/attorney/matters/page.tsx:60-64 — search/status/service filters + sort in useState only → reflect in URL query params.`
- `[P2] ACCESSIBILITY — components/Tabs.tsx — active tab not in URL → sync to ?tab=.`
- `[P2] TYPOGRAPHY — app/attorney/matters/page.tsx:227-232 & components/TimeExpensePanel.tsx:312-345 — amounts/durations/dates render in proportional figures (no tabular-nums anywhere) → add font-variant-numeric:tabular-nums.`
- `[P2] I18N — components/TimeExpensePanel.tsx:345,362 & app/attorney/clients/page.tsx:186 — currency hand-built as \`$${x}\` → Intl.NumberFormat(undefined,{style:'currency',currency}) (panel already carries expenses.currency).`
- `[P2] FORMS — components/TimeExpensePanel.tsx:221-238 — Hours/Minutes number inputs lack inputMode (full keyboard on mobile) and inline range feedback (minutes max=59 only via native stepper) → add inputMode="numeric" + inline error when minutes>59.`
- `[P2] FORMS — app/attorney/matters/[id]/page.tsx:315-335,666-678 — transcript & client-reply textareas have no label (placeholder only) → add visually-hidden labels; aria-label the Cmd/Ctrl+Enter send affordance.`
- `[P2] CONTENT — app/attorney/matters/page.tsx:216-220 — matter summary renders untruncated with no min-w-0/line-clamp → clamp to 1-2 lines, allow min-width:0.`
- `[P2] NAV & STATE — components/TimeExpensePanel.tsx:115-165 — entries can be created but never edited/deleted, no confirm/undo for a mis-keyed billable entry → add delete-with-confirm (or correcting entry).`
- `[P2] COPY — app/attorney/matters/[id]/page.tsx:167-184 — emailDraftLink used native prompt/confirm (unstyled, blocking) → FIXED in RUNNER-FIXES-1: in-app PromptModal + ConfirmModal.`
- `[P3] CONTENT — app/attorney/clients/page.tsx:181 — client list is a stack of <Link> rows, metadata doesn't align into columns → consider a semantic table or column alignment + tabular-nums.`
- `[P3] PERFORMANCE — app/attorney/matters/page.tsx:195-237 & components/SearchBar.tsx:181-193 — no virtualization; SearchBar loads all contacts+matters+clients and filters per keystroke → add virtualization/debounce before ~50-100 rows.`
- `[P3] ACCESSIBILITY — app/attorney/matters/[id]/page.tsx:530 — reasoning-trace status is a bare ✓/— glyph; status badges convey state largely by color → add visually-hidden text + ensure badge text carries status.`
- `[P3] FORMS — app/attorney/clients/page.tsx:119-124 — "Client name" input has no autoComplete/name and no required indicator → add name/autoComplete + visible required marker.`

### Notes
- `MatterResearchPanel`, `PageHead`, `icons`, and various `lib/*` out of scope. Client *detail* page (`/attorney/clients/[id]`) billing-config form not reviewed. CSS class definitions for `.tabs-bar/.tab/.sortable-th/.uac-*/.search-*/.matter-row` exist and were read. Zero `tabular-nums` in the app (grep). `transition:all` appears only in the booking surface.

---

## Recommended fix order

1. **Quick wins (mostly `globals.css` + `app/layout.tsx`):** cross-cutting #2 (`.sign-panel` + `.doc-rendered`), #3 (skip link + `.sr-only`), #6 (base button `min-height:44px`), #7 (contrast tokens), #8 (`tabular-nums` utility), #10 (`transition:all`), #11 (`viewport`/`themeColor`). Lowest risk, broadest benefit.
2. **Screen-reader layer (#1):** add `aria-live` to the ~8 async regions.
3. **Deep-linking (#4) + reusable-component keyboard fixes (#5):** more involved, but touch many screens (`Tabs`, `SearchBar`, calendar, matters).
4. **Surface-specific P1s:** e-signature validation/labels, booking focus-on-error + required state, AI-chat stop button.

---

## Appendix — rubric

Vercel Web Interface Guidelines categories applied: Accessibility, Focus States, Forms, Animation, Typography, Content Handling, Images, Performance, Navigation & State, Touch & Interaction, Safe Areas & Layout, Dark Mode & Theming (light-only app — mostly N/A), Locale & i18n, Hydration Safety, Hover & Interactive States, Content & Copy, plus the listed anti-patterns. Source: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`.
