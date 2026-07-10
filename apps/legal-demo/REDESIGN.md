# Exsto Law (legal-demo) — UI Redesign Plan & Review Findings

**Direction chosen:** Modern legal-tech — navy `#1E3A8A` + trust gold `#B45309`, clean sans-serif, generous whitespace, soft depth, 150–300ms motion, accessible by default.
**Locked decisions:** Inter UI + EB Garamond wordmark/hero · one unified navy+gold accent system (client = warmer bg) · flagship screen = public `/book` flow · dark mode in Phase 3 · attorney nav = sidebar on desktop, collapse to header menu on mobile.
**Build health at review:** ✅ typecheck clean (2 test-only TS errors) · ✅ eslint 0/0. The redesign is *not* fighting broken code.

---

## TL;DR — why it looks generic today (all verified in code)

The design *intent* was scaffolded but never wired up. Five root causes do ~80% of the damage:

1. **The premium fonts are dead.** EB Garamond + Lato are referenced in a comment but there is **no `next/font`, no `@import`, no `@font-face`** anywhere. `body` uses the system sans stack. The whole app renders in plain Helvetica/Arial.
2. **The palette is off-brand.** `--accent-attorney` is generic royal blue `#1d4ed8`; client is forest green `#14532d`. Navy `#1E3A8A` appears **0 times**; gold `#B45309` exists only as the *warning* color.
3. **No depth, no polish, no a11y baseline.** Motion is 100ms, there is **no `:focus-visible`**, **no `prefers-reduced-motion`**, **no dark mode**, and many touch targets are 26–36px (min should be 44px).
4. **Consistency is gone.** ~280 inline `style={{}}` props + 39 hardcoded hex bypass the tokens; **three different page-header patterns**; emoji `✓ ✗ → ↑` used as icons in ~18 files despite an SVG icon set.
5. **Whole client screens are unstyled.** `.public-draft*` and `.lang-toggle*` are used by the portal / public doc view / login / language toggle but **defined 0 times** in CSS, and the `surface-client` theme class is never applied.

**The leverage:** almost all of this lives in one ~2,950-line stylesheet with a real token system. Fixing tokens + loading fonts transforms *every page at once*.

---

# Part 1 — The new design system

## 1.1 Color tokens (light)

| Token | Value | Use |
|---|---|---|
| `--navy-900` | `#0B1B3A` | sidebar, deepest headings |
| `--navy-700` | `#14306B` | heading accent |
| `--navy` (primary) | `#1E3A8A` | primary buttons, links, active nav |
| `--navy-500` | `#2D4DA0` | hover |
| `--navy-100` | `#E5EBF7` | selected row / soft tint |
| `--gold` (accent) | `#B45309` | premium accents, active indicators, key CTAs |
| `--gold-400` | `#D08A3E` | gold hover / dark-mode accent |
| `--gold-100` | `#FBEFDD` | gold soft tint, focus glow |
| `--bg` | `#F6F8FB` | app background |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F1F5F9` | cards / inset panels, table headers |
| `--fg` | `#0F172A` | body text |
| `--muted` | `#475569` | secondary text — **darkened from `#6b7280`** for AA |
| `--border` / `--border-strong` | `#E2E8F0` / `#CBD5E1` | hairlines / emphasis |
| `--ok` / `--warn` / `--danger` | `#15803D` / `#D97706` / `#DC2626` | semantic — **warn moves to amber so gold reads as brand** |
| `--ring` | `var(--navy)` | focus rings |

**Identity rule:** navy carries primary actions and chrome; gold is the accent used sparingly. That restraint reads as "expensive," not "busy."

## 1.2 Dark mode (Phase 3)
Re-express colors as semantic tokens, then add `@media (prefers-color-scheme: dark)` + `.theme-dark`: `--bg #0B1220`, `--surface #131C2E`, `--fg #E6EDF7`, `--muted #9AA7BD`, gold brightened to `#D4A24C`. Light stays default.

## 1.3 Typography
- **Body + UI:** **Inter** via `next/font/google` (self-hosted, `display: swap`), `--font-sans`, weights 400/500/600/700.
- **Serif accent:** **EB Garamond** (`--font-serif`) applied **only** to the firm wordmark + booking hero.
- **Base 16px** (was ~15px); floor secondary text at `0.8rem` (today 23 styles sit at 0.7–0.78rem). Scale 12.8/14/16/18/20/24/30/36. Line-height 1.55 body / 1.2 headings; headings `letter-spacing: -0.01em`.

## 1.4 Spacing / radius / shadow / motion
- Keep the 4px space scale. Radius: inputs/buttons 8px, cards 12px, big surfaces 16px.
- Softer layered shadows (`--shadow-md: 0 2px 8px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04)`; `--shadow-lg: 0 12px 32px -8px rgba(15,23,42,.12)`).
- Motion `--transition: 180ms cubic-bezier(.2,0,0,1)`; exits ~70% of enter; replace literal `0.1s`/`0.08s` durations.

## 1.5 Accessibility, baked in
- Global `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` — never strip an outline without a replacement.
- `@media (prefers-reduced-motion: reduce)` neutralizing animation/transition.
- **44px minimum** interactive size on buttons, inputs, nav, tabs, slot/calendar buttons.
- Darkened `--muted` + 0.8rem floor fix the contrast/size failures.

## 1.6 Components to restyle (centralized win)
Buttons (navy primary · gold `.accent` · `.ghost` · `.danger`, 44px) · inputs (44px, focus ring, error) · cards/`section` (radius 12, soft shadow, roomier padding) · tables (rounded container, `--surface-2` header, navy-50 hover) · **PageHead as the only header** · AttorneyHeader (navy brand, gold active) · AttorneySidebar (navy, gold active, **mobile collapse**) · Tabs (focus + arrow roving) · SearchBar (combobox a11y + restyle) · the two calendars (shared base, navy/gold tokens) · **define `.public-draft*`, `.lang-toggle*`, `.alert-success`**.

## 1.7 Consistency rules going forward
1. One header (`PageHead`) on every route. 2. No inline `style={{}}` for reusable styling — promote to classes. 3. SVG icons only (extend `icons.tsx`); no emoji. 4. Colors from tokens — no raw hex. 5. One accent system (navy+gold) across both surfaces.

---

# Part 2 — Rollout plan (two parallel tracks)

### Visual track
- **Phase 0 — Foundation (low risk, no markup changes):** load Inter+EB Garamond via `next/font`; rewrite tokens to navy+gold (light); base 16px; darken muted; global `:focus-visible`; `prefers-reduced-motion`; 180ms motion; 44px control minimums. *Every page improves immediately.*
- **Phase 1 — Core chrome & components:** header, sidebar (+mobile collapse), buttons/inputs/cards/tables/badges; unify `PageHead`; define missing class families + `.alert-success`.
- **Phase 2 — Flagship screens:** `/book` (conversion, mobile, inline validation, `role="alert"`), attorney dashboard, client portal — layout, hierarchy, spacing, real empty/loading/error states.
- **Phase 3 — Dark mode + cleanup:** dark token set + toggle; emoji→SVG; eliminate inline styles + hardcoded hex; de-dupe `.cal-*`/`.wcal-*`.

### Correctness track (interleave anytime)
Fix the P0/P1 items in Part 3: document-generation bugs, calendar/booking races, a11y semantics (modal focus-trap/Escape, keyboard-dead mail rows, chat live-regions, combobox), backend tenancy/security.

**First build step (your pick):** Phase 0 + fully polish the public `/book` flow so you can see the new look before it rolls everywhere.

---

# Part 3 — Prioritized findings (~120 across 5 review passes)

Severity: **P0** broken/blocker · **P1** high · **P2** medium · **P3** polish.

## P0 — broken / blocks the "slick" goal
| # | Cat | Location | Problem → Fix |
|---|---|---|---|
| 1 | UX | globals.css:76 | No webfont loaded; app is system sans → wire `next/font` Inter + EB Garamond. |
| 2 | UX | `.public-draft*` undefined (portal, d/[versionId], portal/login) | Client portal / public doc / login render unstyled → define layout classes. |
| 3 | UX | `.lang-toggle*` undefined (LanguageToggle.tsx) | EN/ES switch is unstyled default buttons → pill-group styles, 44px. |
| 4 | CONSISTENCY | layout.tsx:13 / AttorneyHeader.tsx:11 | `surface-client` only removed, never added; client wears attorney theme → set it (or unify palette). |
| 5 | A11Y | globals.css | No `prefers-reduced-motion`; spinners/pulses always animate → add reduce block. |
| 6 | UX | globals.css (`color-scheme:light`) | No dark mode → tokenize + dark override (Phase 3). |
| 7 | BUG | book/page.tsx:114-123 | `?service=` preset can set a non-existent key and strand the user → validate against loaded services. |
| 8 | BUG | book/page.tsx:131-160 | Slot fetch has no abort/sequence guard + double-fires on horizon change → stale availability. Add AbortController/sequence guard. |

## P1 — high impact (grouped)
**Document generation (wrong output):** prompt/page.tsx:11-15 hardcodes `{{operating_agreement_template}}` for every kind (can't save other prompts); review/[versionId]:144-160 & matters/[id]:283-294 hardcode the document kind (wrong doc generated); matters/[id]:283-306 never polls async drafts.
**State/race:** questionnaire array-index keys (309/364/505) corrupt fields on move/remove; AvailabilityCalendar:101-119 never re-syncs weekStart; TimeExpensePanel:82-103 fetch race shows wrong matter; calendar reschedule:207-224 no event id; book load-more:530-536 double-fetch.
**A11y blockers:** no `:focus-visible` anywhere; mail rows:250-254 click-only `<tr>` (keyboard-dead); ConnectKeyModal & FeedbackChat:38-50 no focus trap/Escape; SearchBar:129-172 no combobox ARIA/keyboard; UnifiedAssistantChat:207-245 no `role="log"`; WeeklyCalendar:323-348 broken grid roles; AttorneySidebar:55-73 no `aria-current`.
**Visual/responsive:** generic blue/green accents; touch targets 26–36px; `--muted` fails AA on tints + 23 sub-0.8rem styles; sidebar fixed 208px no mobile collapse; `.field-row` 3-col no mobile breakpoint; review/page.tsx:30-31 unfinished (bare h1 + raw `<pre>`); portal:51-101 error takes over whole page; book:357 single top error banner, no inline validation, no `role="alert"`.
**Backend/security:** attorney/mcp:47-56 & client/auth/consume:28-51 `withSuperuser` bypasses RLS (CLAUDE.md hard-rule #2/#9; not request-injectable but route through tenant-scoped layer); auth/google/callback:18 `BASE_URL` silent hardcoded fallback (require/allowlist).

## P2 / P3 — by theme
- **Consistency (P2):** ~280 inline styles (worst: portal, services/[serviceKey], matters/[id], mail); 39 hardcoded hex; 3 page-head patterns; emoji-as-icons ~18 files; duplicated `humanizeService`; `.cal-*`/`.wcal-*` ~190-line dup; duplicate `.slot-grid`.
- **Bugs (P2):** TemplateEditor:26-47 stale content on switch; Tabs:19,38-40 inactive-tab state lost; WeeklyCalendar:148 DST-unsafe math; SearchBar:87-120 cap logic + unmemoized; calendar:177-187 uncontrolled→controlled select; settings:125-134 `google_error` param never cleared; import/page.tsx orphaned (no nav); native prompt/confirm for core actions (FIXED in RUNNER-FIXES-1 — in-app ConfirmModal/PromptModal everywhere).
- **Security (P2):** unscoped `/d/[versionId]` share links (no expiry/revoke; mitigated by UUID); magic-link tokens replayable within TTL (not single-use); raw `error.message` returned from MCP routes + reflected into OAuth `?error=`; in-memory spoofable rate limiting; webhook route missing `runtime='nodejs'`.
- **A11y (P2/P3):** glyph/icon-only buttons missing `aria-label` (questionnaire ↑↓, checklist ✓◯, template B/I); stepper missing `aria-current`; confidence bar missing `role="progressbar"`; loading states missing `role="status"`; stage badges sub-3:1 contrast.
- **Build (P3):** 2 test-only TS errors in tests/session.test.ts:191,195 (`NODE_ENV` read-only) — app code clean.

> **XSS scare cleared:** the public doc's `dangerouslySetInnerHTML` (d/[versionId]:79) was flagged then verified safe — `renderMarkdown` in `lib/draftExport.ts` escapes `<>&` first. Brittle (hand-rolled, no DOMPurify); if link/image markdown is ever added, sanitize the href. P3, not a vulnerability.

---

# Part 4 — Decisions (LOCKED)
1. **Type:** Inter UI + EB Garamond wordmark/hero. ✅
2. **Accents:** unified navy+gold (client = warmer bg). ✅
3. **Attorney nav:** sidebar on desktop, collapse to header menu on mobile. ✅
4. **Dark mode:** Phase 3. ✅
5. **Build order:** Phase 0 foundation → polish public `/book` first. ✅
