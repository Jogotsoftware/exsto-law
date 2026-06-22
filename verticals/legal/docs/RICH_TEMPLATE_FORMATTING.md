# Rich template formatting (Contract H, evolved)

**Status:** Accepted 2026-06-22. Implements the beta ask for a Word-like template
editor with per-selection fonts, sizes, and alignment — visible in the editor AND
in the finished/signed document. Supersedes the "body renders as escaped plain
markdown" half of Contract H. The merge contract (deterministic `{{token}}`
substitution, `{{>include}}` composition, `{{type:key}}` e-sign anchors) is
UNCHANGED.

## Problem

Template bodies are stored as markdown and rendered to a finished document by two
renderers that both **HTML-escape the entire body**:

- client: `apps/legal-demo/lib/draftExport.ts` → `renderMarkdown` (powers the
  in-app preview, the public share page `/d/[versionId]`, the attorney review
  page, the e-sign prepare page, and PDF/Word export).
- server: `verticals/legal/src/lib/templates/render.ts` → `renderTemplate`
  (the deterministic merge engine).

Because both escape, any inline styling a user applies in the editor (font family,
font size, alignment) is either stripped on save (the turndown bridge drops
unknown spans) or shows up as literal `<span style=…>` text in the signed
document. So "make it look like Word" is impossible without changing the render
layer. This is the document clients actually sign — correctness and safety matter.

## Decision

### 1. The body stays markdown — no storage migration

The canonical body remains markdown with `{{token}}` syntax. Existing templates
(incl. the live NC SMLLC service) keep working untouched. Rich styling is carried
as a **small, allowlisted inline-HTML subset** embedded in the markdown:

- `<span style="font-family:…; font-size:…; text-decoration:…">…</span>` — per-run font/size.
- `text-align` on block elements (`<p>`, `<h1..3>`, `<li>`) for alignment.
- A signature-line block: `<div class="sig-line">…</div>` (a ruled line + label).

Markdown already permits raw HTML, so this is a superset, not a new format. The
merge engine treats the HTML as opaque text — token substitution is unaffected.

### 2. Renderers SANITIZE instead of escape (the security-critical change)

Both renderers stop escaping and instead run **markdown → HTML → `sanitize-html`
with a strict allowlist**. The allowlist is the whole security boundary:

- **Tags:** `p, br, hr, h1, h2, h3, strong, b, em, i, u, s, ul, ol, li, blockquote, span, div, a`.
  Everything else is dropped. No `script`, `style`, `iframe`, `img`, `object`,
  event-handler attributes, `<form>`, etc.
- **Attributes:** `style` (filtered, see below), `class` (only `sig-line` on `div`),
  `href` (only `http(s):`, `mailto:`, in-app `/…` — same scheme allowlist the old
  renderer enforced), `data-variable` (the editor's token chip marker), `target`/`rel`.
- **Style properties (allowlisted, value-validated):** `font-family`,
  `font-size` (only `\d+(pt|px|rem|em)`), `text-align`
  (`left|right|center|justify`), `text-decoration` (`underline|line-through`),
  `font-weight` (`bold|normal|\d00`), `font-style` (`italic|normal`). Any other
  property, and any value not matching its validator, is dropped.
- **Token values are escaped at substitution time** (as today) so a client-supplied
  answer can never inject markup; the template author's allowlisted HTML survives
  the final sanitize.

`{{token}}`, `{{>include}}`, and `{{type:key}}` e-sign tags are plain text and pass
through sanitize untouched — they are not HTML. The e-sign anchor-text matcher
still finds `{{sign:client}}` verbatim in the rendered document.

The client and server renderers MUST stay byte-aligned (same allowlist, same
markdown options) so the preview equals the produced document. The allowlist lives
in one shared module imported by both.

### 3. Document-level font/size is a page setting, per-run overrides it

The page's base font family + size (the "page setup" already in the editor) set the
document default via a CSS variable on the page root. Per-run `<span style>` from a
selection overrides locally, exactly like Word.

## Why not switch storage to canonical HTML

It would force a data migration of every existing template, a rewrite of the merge
engine's token logic to operate on HTML, and changes to AI-draft/import (which emit
markdown) — a large blast radius on the signed-document path for no user-visible
gain over the allowlist approach. Markdown-with-allowlisted-HTML delivers identical
fidelity with the change confined to the render layer.

## Testing / safety gates

- Sanitizer security tests: `<script>`, `onerror=`, `javascript:` href,
  `<iframe>`, `<style>` are all stripped; allowlisted font/size/align survive.
- Round-trip tests (`templateBody.test.ts`): a styled span + alignment + signature
  block survive editor HTML → markdown → HTML.
- Merge tests (`tests/vertical/template-merge.test.ts`): tokens/includes/e-sign
  tags still resolve with styling present; token values are still escaped.
- Preview tests (`templatePreview.test.ts`): preview HTML equals the server-merged
  HTML for the same body.
