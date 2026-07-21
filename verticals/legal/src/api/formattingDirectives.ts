// EDITOR-FIX-1 (item 5) — the ONE formatting/drafting-standards block injected
// into EVERY document generation path (founder verbatim: "we need to create a
// formatting prompt that lives in every document generation… correct
// capitalizations, bolding… robust legal verbiage; the lines at the bottom where
// a date or signature would go are all dashed. its awful").
//
// It rides the system-facts seam: buildSystemFactsBlock (generateDraft.ts)
// appends it, so it reaches the AI draft path and the stage regenerate (both
// build systemFactsText via that helper), and buildRevisionPrompt (reviseDraft.ts)
// includes it, so Edit-with-AI revisions carry it too. Single-sourced here so the
// standards can never drift between paths, and snapshot-pinned in
// generation-integrity.test.ts.
//
// Kept model-agnostic and document-kind-agnostic (it says "this document", never
// "operating agreement") so it is correct for every drafting entry point.
export const FORMATTING_DIRECTIVES = [
  '--- Formatting and drafting standards (apply to the ENTIRE document) ---',
  'Produce a professionally formatted, execution-ready legal document:',
  '- STRUCTURE: organize the document into consistently numbered Articles and Sections (e.g. "Article I", "Section 1.1") in a logical order; never a wall of unstructured text.',
  '- HEADINGS & CAPITALIZATION: write the document title and every article/section heading in Title Case with correct capitalization throughout. NEVER a lowercase or mixed-case title such as "operating agreement OF Acme LLC" — titles and headings read as proper titles.',
  '- DEFINED TERMS & SECTION LEADS: bold each defined term where it is first defined, and bold the lead-in phrase of each section (e.g. "**Governing Law.** This Agreement is governed by …").',
  '- REGISTER: use a formal, precise, robust legal register — complete sentences, defined terms used consistently, no casual phrasing, filler, or hedging.',
  '- SIGNATURE, DATE & EXECUTION LINES: NEVER draw signature, date, or execution lines with underscores or dashes ("______", "Date: ____", "-----", "—"). Emit the canonical execution markers instead — {{sign:key}} for a signature line, {{date:key}} for a date line, and {{name:key}} / {{title:key}} where a printed name or capacity is needed — each on its own line, carrying the signer\'s key (e.g. client, member). The platform renders these as clean ruled lines and anchors the e-signature to them.',
  '- TABLES: present genuinely tabular content — member/ownership schedules, capital contributions, fee schedules, distribution waterfalls — as a GFM pipe table (a `| Header |` row, a `| --- |` separator row, then data rows). The platform renders these as proper ruled tables. Use tables ONLY for tabular data, never for layout or ordinary prose.',
  '--- End formatting and drafting standards ---',
].join('\n')
