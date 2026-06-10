import { Node, mergeAttributes } from '@tiptap/react'

// Custom inline node for template variables. Renders in the editor as a
// styled chip; serializes to <span data-variable="name">{{name}}</span> so
// the server-side turndown rule can collapse it back to {{name}} for the
// markdown body.

export interface TemplateVariableOptions {
  HTMLAttributes: Record<string, string>
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
})
