import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

// Variable autocomplete: typing `{{` opens a dropdown of the known variables
// (library questions, the template's own fields, and the standard merge tokens);
// arrow keys move, Enter/Tab inserts the chosen variable as a {{name}} chip.
//
// Self-contained ProseMirror plugin — no @tiptap/suggestion / tippy dependency.
// It manages a single floating <div> (appended to <body> so the editor's
// fit-to-width transform never clips it) and drives it imperatively. The chip it
// inserts is the existing `templateVariable` node, so coloring + the markdown
// round-trip are unchanged. The node input rule (`{{name}}` → chip) still handles
// the case where an author types a full token by hand.

const KEY = new PluginKey('variableSuggestion')
// The open trigger: `{{` followed by an in-progress token, with NO closing `}}`
// yet (that case is the input rule's). Matches at the end of the text before the
// caret only.
const TRIGGER = /\{\{([a-zA-Z0-9_]*)$/
const MAX_ITEMS = 8

export interface VariableSuggestionOptions {
  // The known variable names, read live (the reference sets load asynchronously).
  items: () => string[]
}

interface ActiveState {
  active: boolean
  from: number
  to: number
  items: string[]
  index: number
}

export const VariableSuggestion = Extension.create<VariableSuggestionOptions>({
  name: 'variableSuggestion',

  addOptions() {
    return { items: () => [] }
  },

  addProseMirrorPlugins() {
    const getItems = () => this.options.items()
    return [variablePlugin(getItems)]
  },
})

function variablePlugin(getItems: () => string[]): Plugin {
  let state: ActiveState = { active: false, from: 0, to: 0, items: [], index: 0 }
  let dropdown: HTMLDivElement | null = null

  // The `{{query` immediately before an empty selection, or null.
  function detect(view: EditorView): { query: string; from: number; to: number } | null {
    const { selection } = view.state
    if (!selection.empty) return null
    const $from = selection.$from
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const m = TRIGGER.exec(textBefore)
    if (!m) return null
    const to = $from.pos
    return { query: m[1], from: to - m[0].length, to }
  }

  function hide() {
    if (state.active) state = { ...state, active: false }
    if (dropdown) dropdown.style.display = 'none'
  }

  function commit(view: EditorView, name: string) {
    if (!name) return
    const type = view.state.schema.nodes.templateVariable
    if (!type) return
    const tr = view.state.tr.replaceWith(state.from, state.to, type.create({ name }))
    view.dispatch(tr)
    hide()
    view.focus()
  }

  function paint(view: EditorView) {
    if (!dropdown) return
    dropdown.innerHTML = ''
    state.items.forEach((name, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = `tpl-var-suggest-item${i === state.index ? ' active' : ''}`
      item.textContent = name
      // mousedown (not click) + preventDefault so the editor never blurs first.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        commit(view, name)
      })
      dropdown!.appendChild(item)
    })
    const coords = view.coordsAtPos(state.from)
    dropdown.style.display = 'block'
    dropdown.style.left = `${coords.left}px`
    dropdown.style.top = `${coords.bottom + 2}px`
  }

  return new Plugin({
    key: KEY,
    view() {
      dropdown = document.createElement('div')
      dropdown.className = 'tpl-var-suggest'
      dropdown.setAttribute('role', 'listbox')
      dropdown.style.display = 'none'
      document.body.appendChild(dropdown)
      return {
        update(view) {
          const hit = detect(view)
          if (!hit) return hide()
          const q = hit.query.toLowerCase()
          const all = getItems()
          const items = (q ? all.filter((n) => n.toLowerCase().includes(q)) : all).slice(
            0,
            MAX_ITEMS,
          )
          if (items.length === 0) return hide()
          const index = state.active && state.index < items.length ? state.index : 0
          state = { active: true, from: hit.from, to: hit.to, items, index }
          paint(view)
        },
        destroy() {
          dropdown?.remove()
          dropdown = null
        },
      }
    },
    props: {
      // Drive selection from the keyboard while the dropdown is open.
      handleKeyDown(view, event) {
        if (!state.active || state.items.length === 0) return false
        if (event.key === 'ArrowDown') {
          state.index = (state.index + 1) % state.items.length
          paint(view)
          return true
        }
        if (event.key === 'ArrowUp') {
          state.index = (state.index - 1 + state.items.length) % state.items.length
          paint(view)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          commit(view, state.items[state.index])
          return true
        }
        if (event.key === 'Escape') {
          hide()
          return true
        }
        return false
      },
      handleDOMEvents: {
        blur() {
          hide()
          return false
        },
      },
    },
  })
}
