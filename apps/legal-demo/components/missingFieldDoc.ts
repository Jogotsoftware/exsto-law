// EDITOR-FIX-1 (item 4) — render `[[MISSING: field]]` merge-gap markers as warn
// chips INSIDE the tracked-changes editor, without altering the document model.
// A ProseMirror decoration plugin (like TrackChangesDecorations): for each marker
// it hides the raw marker text (an inline decoration — the text stays in the
// model, so the tracked-changes text diff and Save round-trip see the marker
// verbatim, append-only truth) and draws a humanized warn chip widget in its
// place. Rebuilt on every doc change so a chip follows its marker as the attorney
// edits around it.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { missingFieldRegex, missingChipLabel } from '@/lib/missingFields'

const missingFieldKey = new PluginKey<DecorationSet>('liMissingFields')

function buildMissingDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const re = missingFieldRegex()
    let m: RegExpExecArray | null
    while ((m = re.exec(node.text)) !== null) {
      const from = pos + m.index
      const to = from + m[0].length
      const field = m[1]!
      // Keep the marker text in the model, hidden from view …
      decos.push(Decoration.inline(from, to, { class: 'li-missing-raw' }))
      // … and show the humanized warn chip at its start.
      decos.push(
        Decoration.widget(
          from,
          () => {
            const span = document.createElement('span')
            span.className = 'li-missing-chip'
            span.textContent = missingChipLabel(field)
            span.title = `Merge gap: ${field}`
            return span
          },
          { side: -1, key: `missing-${from}-${field}` },
        ),
      )
    }
    return true
  })
  return DecorationSet.create(doc, decos)
}

export const MissingFieldDecorations = Extension.create({
  name: 'liMissingFields',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: missingFieldKey,
        state: {
          init: (_config, instance) => buildMissingDecorations(instance.doc),
          apply: (tr, old) => (tr.docChanged ? buildMissingDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return missingFieldKey.getState(state)
          },
        },
      }),
    ]
  },
})
