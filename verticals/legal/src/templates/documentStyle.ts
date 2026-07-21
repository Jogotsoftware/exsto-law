// Shared document-formatting standard injected into EVERY document-generation
// path (draft generation, draft revision, template AI authoring, and — in a
// condensed form — the build-wizard's propose_template tool). Its job: make
// produced documents and templates read as polished, professional legal
// instruments — proper structure, headings, typography, and complete operative
// wording — instead of the thin, flatly-formatted prose the beta surfaced.
//
// PURE POLICY, NO IO. Like generateDraft.ts's system-facts block (#444), this is
// injected programmatically rather than baked into drafting-prompt.md, so one
// source of truth reaches all four paths (and the bundled-prompts drift guard,
// which only covers the .md ⇄ bundledPrompts.ts mirror, is untouched).
//
// EVERY formatting instruction below is matched to what
// apps/legal-demo/lib/documentHtml.ts (marked + the sanitize allowlist) actually
// renders. Underline survives ONLY as a literal <u> tag; centering survives ONLY
// as a block element with style="text-align:center". Telling the model to use,
// say, markdown underline syntax would render as literal garbage — so we never
// do. Keep this list in lockstep with DOCUMENT_SANITIZE_OPTIONS if the renderer
// allowlist changes.

export const DOCUMENT_STYLE_INSTRUCTION = `--- Document formatting and drafting standard (produce a polished, professional legal document; obey these exactly) ---

STRUCTURE
- Open with a centered title in full capitals, using this exact form (the only supported way to center text): \`<p style="text-align:center"><strong>TITLE OF THE DOCUMENT</strong></p>\`.
- Where the document type calls for it, follow the title with a preamble/recitals paragraph that names the parties (each party name in **bold** at first mention) and the effective date.
- Number the main sections as Title Case markdown H2 headings — \`## 1. Definitions\`, \`## 2. Formation\`, \`## 3. Capital Contributions\`, and so on — and use H3 (\`###\`) for sub-sections.
- Break long provisions into numbered sub-clauses instead of dense paragraphs. Use numbered lists for enumerated obligations, conditions, or representations; use bulleted lists only for genuinely parallel, non-sequential items.
- End any document that gets signed with a proper signature/execution block.

TYPOGRAPHY
- Put a defined term in **bold** (\`**Term**\`) at its first (defining) use, and bold party names in the preamble.
- Use \`<u>underline</u>\` only where legal convention expects it (for example emphasized NOTICE or WAIVER language). Underline is available ONLY through the literal \`<u>…</u>\` tag.
- Reserve ALL CAPS for conventional blocks only — the title, party identification lines, and statutory notice/disclaimer provisions. Never set whole paragraphs of ordinary body text in capitals.
- Headings in Title Case; all ordinary text in proper sentence case with correct capitalization and punctuation.

WORDING
- Write complete operative language: state grants, representations, warranties, covenants, and conditions in full, in a formal and precise legal register — never as one-line sketches or summaries.
- Once a term is defined, use it consistently; do not silently reintroduce or redefine it.
- No thin placeholder prose, no marketing language, no emojis, and no markdown code fences wrapping the document.

RENDERER LIMITS (anything outside this set renders as literal text — do not use it)
- Supported markdown: headings \`#\`–\`######\`, \`**bold**\`, \`*italic*\`, \`~~strikethrough~~\`, numbered and bulleted lists, \`> blockquote\`, \`---\` horizontal rule, and links.
- Underline: ONLY the literal \`<u>…</u>\` tag. Centering: ONLY a block element carrying \`style="text-align:center"\` (e.g. \`<p style="text-align:center">…</p>\`). No other raw HTML and no other markdown is available for styling.`

// Condensed variant for tight budgets (tool-description text, where a full block
// does not fit). References the same conventions in a few sentences. Underline
// and centering constraints are kept verbatim because getting them wrong renders
// as literal garbage.
export const DOCUMENT_STYLE_BRIEF =
  'Make the document polished and professional: a centered ALL-CAPS title as ' +
  '`<p style="text-align:center"><strong>TITLE</strong></p>`, Title Case numbered ' +
  'section headings (`## 1. Heading`), a recitals/preamble naming the parties in ' +
  '**bold** where the type calls for it, numbered sub-clauses for enumerated ' +
  'obligations, complete operative wording (not one-line sketches), and a proper ' +
  'signature block. Bold defined terms at first use; ALL CAPS only for the title, ' +
  'party identification, and notice provisions. Underline renders ONLY via `<u>…</u>`; ' +
  'centering ONLY via `style="text-align:center"`; no emojis, no code fences.'
