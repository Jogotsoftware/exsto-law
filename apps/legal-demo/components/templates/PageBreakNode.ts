import { Node, mergeAttributes } from '@tiptap/core'

// A page break: a full-width ruled separator the author drops between pages /
// sections of a legal document. Serializes to an allowlisted, self-contained
// <div class="page-break"></div> (the rule + "Page break" label are drawn in CSS,
// .page-break) so it survives editor → markdown → finished/printed document. The
// save-bridge (templateBody.ts) keeps this div as raw HTML; the document sanitizer
// (documentHtml.ts) allows the class. In print/PDF it also forces a page break.

export interface PageBreakOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a full-width page break at the cursor. */
      insertPageBreak: () => ReturnType
    }
  }
}

export const PageBreak = Node.create<PageBreakOptions>({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  parseHTML() {
    return [{ tag: 'div.page-break' }]
  },

  // The <hr> child is load-bearing, not decorative: turndown drops a *blank*
  // block before any keep() rule runs, so an empty <div> would vanish on save. A
  // void child (hr) makes the node non-blank, so the save-bridge preserves it —
  // and it doubles as the rule the CSS draws the break line from.
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'page-break' }),
      ['hr'],
    ]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})
