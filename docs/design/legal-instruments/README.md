# Legal Instruments — attorney app redesign (source of truth)

This folder is the **binding design spec** for the attorney console redesign. It is a Claude Design export produced
and refined by Joe (2026-07-16). Every redesign work package (WP) implements against it.

## Contents

- `legal-instruments.dc.html` — the full interactive comp (open in a browser with `support.js` alongside). Contains
  every screen: shell (left rail + top bar), dashboard, matters list/detail, review queue + reader (incl. the AI
  tracked-changes redline flow), services + service editor, templates gallery + editor, intake forms, questions,
  CRM, calendar, mail, eSign, billing, settings (all sections), the assistant panel + service-builder flow, and all
  modals.
- `support.js` — the comp's runtime (required to open the `.dc.html`).
- `screenshots/` — 61 per-screen PNG captures. WPs reference these instead of loading the whole comp.
- `WIRING.md` — the control-by-control wiring matrix and per-WP acceptance checklists.

## Rules (from the approved plan, `docs/design/legal-instruments/WIRING.md` §Conventions)

1. The comp is the **spec**, not inspiration: pixel-faithful proportions, spacing, states, and animations.
2. **No dead controls** ship. Everything visible must work; gaps are built, not stubbed.
3. **Simpler wins**: information/chrome the comp doesn't show gets dropped by default.
4. The comp's demo data (Rosa Pacheco, Teo Marsh, …) is placeholder — never hardcode it.
5. Documents render as proportional letter pages everywhere via the shared `DocumentSheet` component.
6. AI affordances use the shared animated `<GemSparkle>` / `<GemShimmer>` components — never re-implemented.
