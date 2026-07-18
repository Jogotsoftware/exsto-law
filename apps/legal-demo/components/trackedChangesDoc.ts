// ProseMirror glue for the li-edtr tracked-changes editor: plain-text extraction
// with an offset→position map (so the pure hunk model in lib/trackedChanges can
// drive editor decorations and transactions), plus the decoration extension that
// paints pending insertions (green underline), pending deletions (red struck
// widgets) and accepted text (light-green highlight) over the live document.
//
// Everything positional lives here; everything textual lives in the pure model.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  mapBaseRangeToCurRanges,
  type AcceptedChange,
  type PendingHunk,
  type TrackRun,
} from '@/lib/trackedChanges'

// ── Text extraction ──────────────────────────────────────────────────────────

interface Seg {
  off: number
  pos: number
  len: number
}

export interface DocTextMap {
  text: string
  // Map a text offset to a ProseMirror position. 'start' biases forward (an
  // offset on a block boundary resolves to the next text), 'end' biases back.
  posAt: (off: number, side: 'start' | 'end') => number
}

// The document as diffable plain text: textblock contents joined by '\n', hard
// breaks contributing '\n' too. Inline atoms (merge-token chips, signature
// lines, page breaks) contribute no text — they are invisible to the text diff,
// so moving/removing one alone is not a tracked change (deliberate: the hunk
// model tracks language, not furniture).
export function extractDocText(doc: PMNode): DocTextMap {
  const segs: Seg[] = []
  let text = ''
  let firstBlock = true
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!firstBlock) text += '\n'
      firstBlock = false
      return true
    }
    if (node.isText && node.text) {
      segs.push({ off: text.length, pos, len: node.text.length })
      text += node.text
    }
    if (node.type.name === 'hardBreak') text += '\n'
    return true
  })

  const posAt = (off: number, side: 'start' | 'end'): number => {
    if (segs.length === 0) {
      // Empty document: position 1 is inside the first (empty) textblock.
      return Math.min(1, doc.content.size)
    }
    if (side === 'start') {
      for (const seg of segs) {
        if (off < seg.off + seg.len) {
          return seg.pos + Math.max(0, off - seg.off)
        }
      }
      const last = segs[segs.length - 1]!
      return last.pos + last.len
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i]!
      if (off > seg.off) {
        return seg.pos + Math.min(seg.len, off - seg.off)
      }
    }
    return segs[0]!.pos
  }

  return { text, posAt }
}

// ── Decoration plugin ────────────────────────────────────────────────────────

export const trackChangesKey = new PluginKey<DecorationSet>('liTrackedChanges')

// Holds the DecorationSet pushed by the editor component (via setTrackDecorations)
// and maps it through intermediate transactions so highlights stay glued to
// their text between debounced recomputes.
export const TrackChangesDecorations = Extension.create({
  name: 'liTrackedChanges',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: trackChangesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(trackChangesKey) as DecorationSet | undefined
            if (meta) return meta
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          },
        },
        props: {
          decorations(state) {
            return trackChangesKey.getState(state)
          },
        },
      }),
    ]
  },
})

// Build the decoration set for the current pending/accepted picture. `runs` is
// the diff of baseText (accepted state) vs the document's current text — the
// same runs the hunks were grouped from — used to map accepted base spans into
// current offsets.
export function buildTrackDecorations(
  doc: PMNode,
  map: DocTextMap,
  pending: PendingHunk[],
  accepted: AcceptedChange[],
  runs: TrackRun[],
): DecorationSet {
  const decos: Decoration[] = []
  for (const hunk of pending) {
    if (hunk.newText !== '') {
      const from = map.posAt(hunk.curStart, 'start')
      const to = map.posAt(hunk.curEnd, 'end')
      if (to > from) {
        decos.push(Decoration.inline(from, to, { class: 'li-edtr-run li-edtr-run--ins' }))
      }
    }
    if (hunk.oldText !== '') {
      const oldText = hunk.oldText
      const at = map.posAt(hunk.curStart, 'start')
      decos.push(
        Decoration.widget(
          at,
          () => {
            const span = document.createElement('span')
            span.className = 'li-edtr-delwidget'
            // A deleted paragraph break reads as a pilcrow in the struck run.
            span.textContent = oldText.replace(/\n/g, ' ¶ ')
            return span
          },
          { key: `del-${hunk.id}-${oldText.length}`, side: -1 },
        ),
      )
    }
  }
  for (const change of accepted) {
    const ranges = mapBaseRangeToCurRanges(runs, change.start, change.start + change.newText.length)
    for (const [s, e] of ranges) {
      const from = map.posAt(s, 'start')
      const to = map.posAt(e, 'end')
      if (to > from) {
        decos.push(Decoration.inline(from, to, { class: 'li-edtr-run li-edtr-run--acc' }))
      }
    }
  }
  return DecorationSet.create(doc, decos)
}

// Push a freshly built set into the plugin (a no-op metadata transaction).
export function setTrackDecorations(view: EditorView, set: DecorationSet): void {
  view.dispatch(view.state.tr.setMeta(trackChangesKey, set).setMeta('addToHistory', false))
}
