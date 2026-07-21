// EDITOR-FIND-1 — find-match highlighting for the tracked-changes editor.
// A decoration plugin in the TrackChangesDecorations mold: the editor component
// computes matches (in extractDocText text-space, mapped to doc positions via
// posAt) and pushes a DecorationSet; the plugin maps it through intermediate
// transactions so highlights stay glued to their text until the debounced
// recompute refreshes them. Presentation only — the document model never
// carries search state.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocTextMap } from '@/components/trackedChangesDoc'

export const searchKey = new PluginKey<DecorationSet>('liEditorSearch')

export const SearchDecorations = Extension.create({
  name: 'liEditorSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(searchKey) as DecorationSet | undefined
            if (meta) return meta
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state)
          },
        },
      }),
    ]
  },
})

// A match in text-space (extractDocText offsets), the shared coordinate system
// of the tracked-changes model. The find bar's query is single-line, so a match
// can never span the '\n' that extractDocText inserts at block boundaries.
export interface SearchTextMatch {
  start: number
  end: number
}

export function findMatches(text: string, query: string): SearchTextMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hay = text.toLowerCase()
  const matches: SearchTextMatch[] = []
  let idx = hay.indexOf(q)
  while (idx !== -1) {
    matches.push({ start: idx, end: idx + q.length })
    idx = hay.indexOf(q, idx + q.length)
  }
  return matches
}

export function buildSearchDecorations(
  doc: PMNode,
  map: DocTextMap,
  matches: SearchTextMatch[],
  activeIndex: number,
): DecorationSet {
  const decos: Decoration[] = []
  matches.forEach((m, i) => {
    const from = map.posAt(m.start, 'start')
    const to = map.posAt(m.end, 'end')
    if (to > from) {
      decos.push(
        Decoration.inline(from, to, {
          class: i === activeIndex ? 'li-edtr-findhit li-edtr-findhit--active' : 'li-edtr-findhit',
        }),
      )
    }
  })
  return DecorationSet.create(doc, decos)
}

export function setSearchDecorations(view: EditorView, set: DecorationSet): void {
  view.dispatch(view.state.tr.setMeta(searchKey, set).setMeta('addToHistory', false))
}
