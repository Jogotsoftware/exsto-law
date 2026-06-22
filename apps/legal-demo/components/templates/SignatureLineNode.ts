import { Node, mergeAttributes } from '@tiptap/core'

// A signature line: a ruled line to sign on with a small label beneath
// ("Signature", "Date", "Print name"). Serializes to the allowlisted markup the
// document sanitizer permits — <div class="sig-line"><span class="sig-line-label">
// …</span></div> — so it survives editor → markdown → finished/signed document.
// The ruled line itself is drawn in CSS (.sig-line::before); the node only carries
// the label. The save-bridge (templateBody.ts) keeps this div as raw HTML.

export interface SignatureLineOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    signatureLine: {
      /** Insert a signature line with the given label (default "Signature"). */
      insertSignatureLine: (label?: string) => ReturnType
    }
  }
}

export const SignatureLine = Node.create<SignatureLineOptions>({
  name: 'signatureLine',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      label: {
        default: 'Signature',
        // The label lives as the child span's text, not an attribute.
        parseHTML: (el) =>
          (el as HTMLElement).querySelector('.sig-line-label')?.textContent?.trim() || 'Signature',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div.sig-line' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'sig-line' }),
      ['span', { class: 'sig-line-label' }, node.attrs.label as string],
    ]
  },

  addCommands() {
    return {
      insertSignatureLine:
        (label = 'Signature') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { label } }),
    }
  },
})
