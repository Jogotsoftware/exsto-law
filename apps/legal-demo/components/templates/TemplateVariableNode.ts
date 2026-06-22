import { Node, mergeAttributes, nodeInputRule } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Custom inline node for template variables. Renders in the editor as a
// styled chip; serializes to <span data-variable="name">{{name}}</span> so
// the server-side turndown rule can collapse it back to {{name}} for the
// markdown body.
//
// Two extras layered on the base node:
//   • an INPUT RULE so typing `{{name}}` is auto-converted into a chip, and
//   • a decoration plugin that COLORS each chip by validity (resolve()):
//       'matched'  → the normal blue chip (a known variable with a question)
//       'orphaned' → yellow (a known variable with no corresponding question)
//       'unknown'  → red (no matching platform variable at all)

export type VariableStatus = 'matched' | 'orphaned' | 'unknown'

export interface TemplateVariableOptions {
  HTMLAttributes: Record<string, string>
  // Classify a variable name for coloring. Stable closure (the editor reads the
  // latest reference sets through it); returns 'matched' when unset so the chip
  // simply keeps its default style.
  resolve?: (name: string) => VariableStatus
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    templateVariable: {
      insertVariable: (name: string) => ReturnType
    }
  }
}

export const TemplateVariable = Node.create<TemplateVariableOptions>({
  name: 'templateVariable',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      resolve: undefined,
    }
  },

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-variable') ?? '',
        renderHTML: (attrs) => ({ 'data-variable': String(attrs.name) }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-variable]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const name = HTMLAttributes['data-variable'] ?? ''
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'tpl-var-chip',
      }),
      `{{${name}}}`,
    ]
  },

  renderText({ node }) {
    return `{{${node.attrs.name}}}`
  },

  addCommands() {
    return {
      insertVariable:
        (name: string) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { name },
            })
            .run(),
    }
  },

  // Typing `{{client_name}}` converts to a chip as soon as the closing `}}` is
  // entered. Letters/digits/underscore only — the same token shape used elsewhere.
  addInputRules() {
    return [
      nodeInputRule({
        find: /\{\{([a-zA-Z0-9_]+)\}\}$/,
        type: this.type,
        getAttributes: (match) => ({ name: match[1] }),
      }),
    ]
  },

  // Color each chip by validity. The plugin re-runs on every transaction, so
  // dispatching an empty tr (from the editor when the reference sets load) is
  // enough to recolor without recreating nodes.
  addProseMirrorPlugins() {
    const resolve = this.options.resolve
    const nodeName = this.name
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (!resolve) return null
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== nodeName) return
              const status = resolve(String(node.attrs.name ?? ''))
              const cls =
                status === 'unknown'
                  ? 'tpl-var-chip--unknown'
                  : status === 'orphaned'
                    ? 'tpl-var-chip--orphaned'
                    : 'tpl-var-chip--matched'
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls }))
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
