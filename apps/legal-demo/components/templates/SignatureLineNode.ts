import { Node, mergeAttributes } from '@tiptap/core'

// A signature line: a ruled line to sign on with a small label beneath
// ("Signature", "Date", "Print name"). Serializes to the allowlisted markup the
// document sanitizer permits — <div class="sig-line"><span class="sig-line-label">
// …</span></div> — so it survives editor → markdown → finished/signed document.
// The ruled line itself is drawn in CSS (.sig-line::before); the node only carries
// the label. The save-bridge (templateBody.ts) keeps this div as raw HTML.
//
// ESIGN-UNIFY-1 ES-3 (15.16b): the node can ALSO carry an e-sign marker —
// data-sig-type + data-sig-key (e.g. sign/client for {{sign:client}}). A
// marker-carrying line renders as the SAME ruled line (the attorney never sees
// raw {{sign:…}} text) while the save-bridge (templateBody.ts) converts it BACK
// to the marker line (`{{type:key}}` / `Label: {{type:key}}`) — the markers
// stay the storage. Legacy label-only lines keep the raw-HTML round trip.

export interface SignatureLineOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    signatureLine: {
      /** Insert a signature line with the given label (default "Signature"). */
      insertSignatureLine: (label?: string) => ReturnType
      /**
       * ES-3: insert a marker-carrying ruled line ({{type:key}} in storage,
       * a ruled line captioned `label` in the editor).
       */
      insertMarkerLine: (type: string, key: string, label: string) => ReturnType
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
      // ES-3 marker provenance. Null on legacy label-only lines.
      sigType: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-sig-type'),
        renderHTML: (attrs) => (attrs.sigType ? { 'data-sig-type': attrs.sigType as string } : {}),
      },
      sigKey: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-sig-key'),
        renderHTML: (attrs) => (attrs.sigKey ? { 'data-sig-key': attrs.sigKey as string } : {}),
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
      insertMarkerLine:
        (type: string, key: string, label: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { label, sigType: type, sigKey: key },
          }),
    }
  },
})
