'use client'

// The tracked-changes document editor — the review reader's Edit / AI-revision
// flagship (li-edtr, Joe's 4-screenshot comp spec, 2026-07-17). A full-screen
// modal: navy header, B/I/U + Track-changes toolbar, the document as a directly
// editable letter page (TipTap on the shared DocumentSheet, watermark kept), and
// an "Edit with AI" rail. Two change sources — typing on the page and
// legal.draft.revise — feed ONE pending-changes model (lib/trackedChanges):
// changes render inline (red struck deletions / green underlined insertions) AND
// as per-change cards with individual Reject / Accept; accepted changes highlight
// light-green until saved and can be undone. Nothing persists until "Save
// changes", which writes ONE new version through the existing append-only
// legal.draft.edit (preview-then-persist, the WP-C rationale); Cancel discards
// everything.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEditor, EditorContent, useEditorState, type Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { watermarkForStatus } from '@/lib/draftExport'
import { useFitToWidth } from '@/lib/useFitToWidth'
import {
  acceptAll,
  acceptHunk,
  buildSessionNote,
  carryOver,
  diffRuns,
  groupHunks,
  mapBaseRangeToCurStrict,
  undoAccept,
  type AcceptState,
  type PendingHunk,
  type TrackRun,
} from '@/lib/trackedChanges'
import { TemplateVariable } from '@/components/templates/TemplateVariableNode'
import { SignatureLine } from '@/components/templates/SignatureLineNode'
import { PageBreak } from '@/components/templates/PageBreakNode'
import {
  TrackChangesDecorations,
  buildTrackDecorations,
  extractDocText,
  setTrackDecorations,
} from '@/components/trackedChangesDoc'
import { DocumentSheet } from '@/components/DocumentSheet'
import { GemSparkle, GemShimmer } from '@/components/GemSparkle'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  XIcon,
  EditIcon,
  FileTextIcon,
} from '@/components/icons'

export interface TrackedEditorDraft {
  documentVersionId: string
  bodyMarkdown: string
  documentKind: string
  matterNumber: string
  clientName: string
  versionNumber: number
  status: string
}

// The four preset suggestion chips (comp-exact, same set as WP-C). Each runs
// immediately, like the superseded Revise-with-AI modal's chips did.
const AI_CHIPS = [
  'Make the tone firmer',
  'Shorten the deadline',
  'Add a confidentiality clause',
  'Simplify the language',
]

const HUNK_LABEL: Record<PendingHunk['kind'], string> = {
  replace: 'Replace',
  insertion: 'Insertion',
  deletion: 'Deletion',
}

// One rail card — a pending hunk or an accepted change, ordered by position.
interface ChangeCard {
  id: string
  kind: PendingHunk['kind']
  oldText: string
  newText: string
  pos: number
  pending: PendingHunk | null
}

// Render a hunk text for a rail card: paragraph breaks read as pilcrows.
function cardText(text: string): string {
  return text.replace(/\n/g, ' ¶ ').trim()
}

export function TrackedChangesEditor({
  draft,
  title,
  statusLine,
  aiEnabled,
  initialFocus = 'page',
  onClose,
  onSaved,
}: {
  draft: TrackedEditorDraft
  title: string
  statusLine: string
  aiEnabled: boolean
  initialFocus?: 'page' | 'ai'
  onClose: () => void
  onSaved: (newVersionId: string | null) => void
}) {
  const [trackOn, setTrackOnState] = useState(true)
  const trackOnRef = useRef(true)
  const setTrackOn = (v: boolean): void => {
    trackOnRef.current = v
    setTrackOnState(v)
  }

  const [acceptState, setAcceptState] = useState<AcceptState>({ baseText: '', accepted: [] })
  const acceptRef = useRef(acceptState)
  const setAccept = (s: AcceptState): void => {
    acceptRef.current = s
    setAcceptState(s)
  }

  const [pending, setPendingState] = useState<PendingHunk[]>([])
  const pendingRef = useRef<PendingHunk[]>([])
  const setPending = (h: PendingHunk[]): void => {
    pendingRef.current = h
    setPendingState(h)
  }

  const [aiPrompt, setAiPrompt] = useState('')
  const [aiWorking, setAiWorking] = useState(false)
  const [aiNoChange, setAiNoChange] = useState(false)
  const aiPromptsRef = useRef<string[]>([])
  const [aiPromptCount, setAiPromptCount] = useState(0)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const confirmRef = useRef(false)
  confirmRef.current = confirmDiscard

  const initialBaseTextRef = useRef('')
  const seedHtmlRef = useRef('')
  const untrackedEditsRef = useRef(false)
  const debounceRef = useRef<number | null>(null)
  const didFocusRef = useRef(false)
  const aiTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const requestCloseRef = useRef<() => void>(() => {})

  const seedHtml = useMemo(() => markdownToHtml(draft.bodyMarkdown), [draft.bodyMarkdown])

  // ── The recompute loop: editor text → diff vs accepted base → hunks + paint ──
  const recompute = useCallback((aiTag?: { prompt: string }): void => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const doc = ed.state.doc
    const map = extractDocText(doc)
    let runs: TrackRun[]
    if (!trackOnRef.current && !aiTag) {
      // Track changes OFF: edits are untracked — the accepted base follows the
      // text. Accepted highlights survive only where their text is intact.
      if (map.text !== acceptRef.current.baseText) {
        runs = diffRuns(acceptRef.current.baseText, map.text)
        const remapped = acceptRef.current.accepted.flatMap((c) => {
          const from = mapBaseRangeToCurStrict(runs, c.start, c.start + c.newText.length)
          return from === null ? [] : [{ ...c, start: from }]
        })
        setAccept({ baseText: map.text, accepted: remapped })
        untrackedEditsRef.current = true
      }
      runs = diffRuns(acceptRef.current.baseText, map.text)
      setPending([])
    } else {
      runs = diffRuns(acceptRef.current.baseText, map.text)
      const grouped = carryOver(
        pendingRef.current,
        groupHunks(runs),
        aiTag ? { origin: 'ai', prompt: aiTag.prompt } : undefined,
      )
      setPending(grouped)
    }
    setTrackDecorations(
      ed.view,
      buildTrackDecorations(doc, map, pendingRef.current, acceptRef.current.accepted, runs),
    )
    setChanged(
      acceptRef.current.accepted.length > 0 ||
        map.text !== initialBaseTextRef.current ||
        ed.getHTML() !== seedHtmlRef.current,
    )
  }, [])

  const scheduleRecompute = useCallback((): void => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      recompute()
    }, 250)
  }, [recompute])

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      // No font/size toolbar controls here (open founder decision — see PR), but
      // the marks must still PARSE so documents styled in the template editor
      // round-trip losslessly through this editor.
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TemplateVariable.configure({ resolve: () => 'matched' }),
      SignatureLine,
      PageBreak,
      TrackChangesDecorations,
    ],
    content: seedHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'doc-rendered li-edtr-body', spellcheck: 'true' },
    },
    onCreate: ({ editor }) => {
      const { text } = extractDocText(editor.state.doc)
      acceptRef.current = { baseText: text, accepted: [] }
      setAcceptState(acceptRef.current)
      initialBaseTextRef.current = text
      seedHtmlRef.current = editor.getHTML()
    },
    onUpdate: () => scheduleRecompute(),
  })
  editorRef.current = editor

  const marks = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor?.isActive('bold') ?? false,
      italic: ctx.editor?.isActive('italic') ?? false,
      underline: ctx.editor?.isActive('underline') ?? false,
    }),
  })

  // Full-screen dialog behavior: body scroll lock + Escape closes (unless the
  // discard-confirm is up — it owns Escape then).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !confirmRef.current) requestCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Initial focus: the AI rail when opened via "AI revision", else the page.
  useEffect(() => {
    if (!editor || didFocusRef.current) return
    didFocusRef.current = true
    if (initialFocus === 'ai' && aiEnabled) aiTextareaRef.current?.focus()
    else editor.commands.focus('start')
  }, [editor, initialFocus, aiEnabled])

  // ── Reject: revert the hunk's range in the editor itself ────────────────────
  const applyRejects = useCallback(
    (hunks: PendingHunk[]): void => {
      const ed = editorRef.current
      if (!ed || hunks.length === 0) return
      const map = extractDocText(ed.state.doc)
      // Back-to-front so earlier hunks' positions stay valid while later ones
      // splice.
      const ordered = [...hunks].sort((a, b) => b.curStart - a.curStart)
      let chain = ed.chain()
      for (const h of ordered) {
        // A range starting/ending on a paragraph break must include the block
        // boundary, so removing an inserted paragraph joins the blocks again.
        const from =
          h.newText.startsWith('\n') || (h.newText === '' && h.oldText.startsWith('\n'))
            ? map.posAt(h.curStart, 'end')
            : map.posAt(h.curStart, 'start')
        const to = h.newText.endsWith('\n')
          ? map.posAt(h.curEnd, 'start')
          : map.posAt(h.curEnd, 'end')
        if (h.oldText === '') {
          if (to > from) chain = chain.deleteRange({ from, to })
        } else {
          chain = chain.insertContentAt(
            { from: Math.min(from, to), to: Math.max(from, to) },
            textToInsertContent(h.oldText),
            { updateSelection: false },
          )
        }
      }
      chain.run()
      recompute()
    },
    [recompute],
  )

  const handleAccept = useCallback(
    (h: PendingHunk): void => {
      setAccept(acceptHunk(acceptRef.current, h))
      recompute()
    },
    [recompute],
  )

  const handleAcceptAll = useCallback((): void => {
    setAccept(acceptAll(acceptRef.current, pendingRef.current))
    recompute()
  }, [recompute])

  const handleRejectAll = useCallback((): void => {
    // Pristine shortcut: with nothing accepted yet, restoring the seed HTML also
    // restores formatting exactly (a text-level revert can only restore text).
    const ed = editorRef.current
    if (
      ed &&
      acceptRef.current.accepted.length === 0 &&
      acceptRef.current.baseText === initialBaseTextRef.current
    ) {
      ed.commands.setContent(seedHtmlRef.current, { emitUpdate: false })
      recompute()
      return
    }
    applyRejects(pendingRef.current)
  }, [applyRejects, recompute])

  const handleUndoAccept = useCallback(
    (id: string): void => {
      setAccept(undoAccept(acceptRef.current, id))
      recompute()
    },
    [recompute],
  )

  // ── Edit with AI (legal.draft.revise — proposal only, persists no version) ──
  const runAi = useCallback(
    async (instructionRaw: string): Promise<void> => {
      const ed = editorRef.current
      const instruction = instructionRaw.trim()
      if (!ed || !instruction || aiWorking || pendingRef.current.length > 0) return
      setAiWorking(true)
      setAiNoChange(false)
      setError(null)
      try {
        // Revise the attorney's CURRENT accepted working text (not the stored
        // version) so a revision composes with unsaved accepted changes.
        const baseMarkdown = htmlToMarkdown(ed.getHTML())
        const res = await callAttorneyMcp<{
          revisedMarkdown: string
          reasoningTraceId: string
          instruction: string
        }>({
          toolName: 'legal.draft.revise',
          input: { documentVersionId: draft.documentVersionId, instruction, baseMarkdown },
        })
        // AI output is always tracked, whatever the toggle said.
        setTrackOn(true)
        ed.commands.setContent(markdownToHtml(res.revisedMarkdown), { emitUpdate: false })
        aiPromptsRef.current = [...aiPromptsRef.current, res.instruction]
        setAiPromptCount(aiPromptsRef.current.length)
        setAiPrompt('')
        recompute({ prompt: res.instruction })
        if (pendingRef.current.length === 0) setAiNoChange(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setAiWorking(false)
      }
    },
    [aiWorking, draft.documentVersionId, recompute],
  )

  // ── Save: ONE new version through the append-only legal.draft.edit ──────────
  const canSave = changed && pending.length === 0 && !busy && !aiWorking
  const handleSave = useCallback(async (): Promise<void> => {
    const ed = editorRef.current
    if (!ed || busy) return
    setBusy(true)
    setError(null)
    try {
      const documentMarkdown = htmlToMarkdown(ed.getHTML()).trim()
      const note = buildSessionNote(
        acceptRef.current.accepted,
        aiPromptsRef.current,
        untrackedEditsRef.current,
      )
      const result = await callAttorneyMcp<{ effects: Array<{ documentVersionId?: string }> }>({
        toolName: 'legal.draft.edit',
        input: { documentVersionId: draft.documentVersionId, documentMarkdown, note },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId ?? null
      onSaved(newId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [busy, draft.documentVersionId, onSaved])

  const dirty = changed || pending.length > 0
  const requestClose = useCallback((): void => {
    if (busy) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }, [busy, dirty, onClose])
  requestCloseRef.current = requestClose

  // ── Rail cards: pending + accepted, in document order ───────────────────────
  const cards: ChangeCard[] = useMemo(() => {
    const list: ChangeCard[] = [
      ...pending.map((h) => ({
        id: h.id,
        kind: h.kind,
        oldText: h.oldText,
        newText: h.newText,
        pos: h.baseStart,
        pending: h,
      })),
      ...acceptState.accepted.map((c) => ({
        id: c.id,
        kind: c.kind,
        oldText: c.oldText,
        newText: c.newText,
        pos: c.start,
        pending: null,
      })),
    ]
    return list.sort((a, b) => a.pos - b.pos)
  }, [pending, acceptState.accepted])

  const watermark = watermarkForStatus(draft.status)?.toUpperCase()
  const fitRef = useFitToWidth<HTMLDivElement>(816)
  const latestPrompt = aiPromptCount > 0 ? aiPromptsRef.current[aiPromptCount - 1] : null
  const toggleBlocked = pending.length > 0

  const markBtn = (
    active: boolean,
    label: ReactNode,
    aria: string,
    onClick: () => void,
  ): ReactNode => (
    <button
      type="button"
      className={`li-edtr-tb-btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={aria}
      aria-label={aria}
      aria-pressed={active}
    >
      {label}
    </button>
  )

  return (
    <div className="li-edtr-root" role="dialog" aria-modal="true" aria-label={`Edit ${title}`}>
      {confirmDiscard && (
        <ConfirmModal
          title="Discard changes?"
          body="Nothing has been saved. Closing discards every tracked change and edit from this session."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            setConfirmDiscard(false)
            onClose()
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {/* navy header */}
      <div className="li-edtr-head">
        <span className="li-edtr-head-icon" aria-hidden>
          <FileTextIcon size={18} />
        </span>
        <div className="li-edtr-head-titles">
          <div className="li-edtr-head-title">
            {title} — <span className="li-edtr-mono">{draft.matterNumber}</span>
          </div>
          <div className="li-edtr-head-sub">
            {draft.clientName ? `${draft.clientName} · ` : ''}v{draft.versionNumber} · {statusLine}
          </div>
        </div>
        <button
          type="button"
          className="li-edtr-head-close"
          onClick={requestClose}
          aria-label="Close editor"
          disabled={busy}
        >
          <XIcon size={16} />
        </button>
      </div>

      {/* toolbar */}
      <div className="li-edtr-toolbar" role="toolbar" aria-label="Editing tools">
        {markBtn(marks?.bold ?? false, <BoldIcon size={15} />, 'Bold', () =>
          editor?.chain().focus().toggleBold().run(),
        )}
        {markBtn(marks?.italic ?? false, <ItalicIcon size={15} />, 'Italic', () =>
          editor?.chain().focus().toggleItalic().run(),
        )}
        {markBtn(marks?.underline ?? false, <UnderlineIcon size={15} />, 'Underline', () =>
          editor?.chain().focus().toggleUnderline().run(),
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        <button
          type="button"
          className={`li-edtr-track${trackOn ? ' is-on' : ''}`}
          onClick={() => {
            if (toggleBlocked) return
            setTrackOn(!trackOnRef.current)
            recompute()
          }}
          disabled={toggleBlocked}
          title={toggleBlocked ? 'Accept or reject the pending changes first' : 'Track changes'}
          aria-pressed={trackOn}
        >
          <span className="li-edtr-track-dot" aria-hidden />
          Track changes
        </button>
        {pending.length > 0 && (
          <div className="li-edtr-tb-right">
            <span className="li-edtr-pendcount">{pending.length} pending</span>
            <button
              type="button"
              className="li-edtr-tb-action li-edtr-tb-action--reject"
              onClick={handleRejectAll}
              disabled={aiWorking || busy}
            >
              × Reject all
            </button>
            <button
              type="button"
              className="li-edtr-tb-action li-edtr-tb-action--accept"
              onClick={handleAcceptAll}
              disabled={aiWorking || busy}
            >
              ✓ Accept all
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error li-edtr-alert">{error}</div>}

      {/* main: page canvas + AI/changes rail */}
      <div className="li-edtr-main">
        <div className="li-edtr-canvas" ref={fitRef}>
          <DocumentSheet variant="full" watermark={watermark}>
            {editor ? (
              <EditorContent editor={editor} />
            ) : (
              <div className="li-edtr-loading">Loading editor…</div>
            )}
            {aiWorking && <GemShimmer />}
          </DocumentSheet>
        </div>

        <aside className="li-edtr-rail">
          {aiEnabled && (
            <div className="li-edtr-ai">
              <div className="li-edtr-ai-head">
                <GemSparkle size={17} />
                <span>Edit with AI</span>
              </div>
              <textarea
                ref={aiTextareaRef}
                className="li-edtr-ai-prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe a change — e.g. make the tone firmer…"
                disabled={aiWorking}
                rows={3}
              />
              <div className="li-edtr-ai-chips">
                {AI_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="li-edtr-ai-chip"
                    onClick={() => void runAi(chip)}
                    disabled={aiWorking || toggleBlocked}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="li-edtr-ai-generate"
                onClick={() => void runAi(aiPrompt)}
                disabled={aiWorking || !aiPrompt.trim() || toggleBlocked}
                title={toggleBlocked ? 'Accept or reject the pending changes first' : undefined}
              >
                <GemSparkle size={16} />
                {aiWorking ? 'Generating…' : 'Generate tracked changes'}
              </button>
              {toggleBlocked && (
                <div className="li-edtr-ai-note">
                  Accept or reject the pending changes before generating more.
                </div>
              )}
              {aiNoChange && (
                <div className="li-edtr-ai-note">
                  The AI returned the document unchanged — try a more specific instruction.
                </div>
              )}
            </div>
          )}

          <div className="li-edtr-changes">
            <div className="li-edtr-changes-head">
              <span className="li-edtr-changes-title">Changes</span>
              <span className="li-edtr-changes-count">{cards.length}</span>
            </div>
            {latestPrompt && <div className="li-edtr-changes-prompt">“{latestPrompt}”</div>}
            {cards.length === 0 ? (
              <div className="li-edtr-empty">
                <EditIcon size={22} />
                <p>No tracked changes yet. Type on the page to edit, or use Edit with AI above.</p>
              </div>
            ) : (
              <div className="li-edtr-cards">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className={`li-edtr-card${c.pending ? '' : ' li-edtr-card--accepted'}`}
                  >
                    <div className="li-edtr-card-top">
                      <span className={`li-edtr-badge li-edtr-badge--${c.kind}`}>
                        {HUNK_LABEL[c.kind]}
                      </span>
                      {!c.pending && <span className="li-edtr-accchip">✓ Accepted</span>}
                    </div>
                    {c.oldText.trim() !== '' && (
                      <div className="li-edtr-card-old">{cardText(c.oldText)}</div>
                    )}
                    {c.newText.trim() !== '' && (
                      <div className="li-edtr-card-new">{cardText(c.newText)}</div>
                    )}
                    <div className="li-edtr-card-actions">
                      {c.pending ? (
                        <>
                          <button
                            type="button"
                            className="li-edtr-card-btn li-edtr-card-btn--reject"
                            onClick={() => applyRejects([c.pending!])}
                            disabled={aiWorking || busy}
                          >
                            × Reject
                          </button>
                          <button
                            type="button"
                            className="li-edtr-card-btn li-edtr-card-btn--accept"
                            onClick={() => handleAccept(c.pending!)}
                            disabled={aiWorking || busy}
                          >
                            ✓ Accept
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="li-edtr-card-btn"
                          onClick={() => handleUndoAccept(c.id)}
                          disabled={aiWorking || busy}
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* footer */}
      <div className="li-edtr-foot">
        <span className="li-edtr-foot-hint">
          {pending.length > 0
            ? 'Accept or reject the pending changes to save'
            : 'Type on the page to edit · use Edit with AI for tracked changes'}
        </span>
        <div className="li-edtr-foot-btns">
          <button type="button" className="li-edtr-cancel" onClick={requestClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="li-edtr-save"
            onClick={() => void handleSave()}
            disabled={!canSave}
            title={
              pending.length > 0
                ? 'Accept or reject the pending changes first'
                : !changed
                  ? 'No changes to save yet'
                  : undefined
            }
          >
            {busy ? <span className="spinner" /> : '✓'} Save changes
          </button>
        </div>
      </div>
    </div>
  )
}

// Literal text (or paragraphs, for multi-line text) as TipTap JSON content —
// never a string, which insertContentAt would parse as HTML. Leading/trailing
// empty lines represent the paragraph split at the splice point itself, not
// literal blank paragraphs.
function textToInsertContent(text: string): JSONContent | JSONContent[] {
  if (!text.includes('\n')) return { type: 'text', text }
  const lines = text.split('\n')
  if (lines[0] === '') lines.shift()
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return [{ type: 'paragraph' }]
  return lines.map((line) =>
    line === ''
      ? { type: 'paragraph' }
      : { type: 'paragraph', content: [{ type: 'text', text: line }] },
  )
}
