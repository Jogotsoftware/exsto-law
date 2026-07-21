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
import { TableKit } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { markdownToHtml, htmlToMarkdown } from '@/lib/templateBody'
import { watermarkForStatus } from '@/lib/draftExport'
import { useFitToWidth } from '@/lib/useFitToWidth'
import {
  acceptAll,
  acceptHunk,
  buildRedlineCounts,
  buildSessionNote,
  carryOver,
  classifyRedlineSource,
  diffRuns,
  groupHunks,
  mapBaseRangeToCurStrict,
  undoAccept,
  type AcceptState,
  type PendingHunk,
  type RedlineOp,
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
import { MissingFieldDecorations } from '@/components/missingFieldDoc'
import {
  SearchDecorations,
  buildSearchDecorations,
  findMatches,
  setSearchDecorations,
  type SearchTextMatch,
} from '@/components/searchDoc'
import { DocumentSheet } from '@/components/DocumentSheet'
import {
  DOC_FONT_OPTIONS,
  DOC_FONT_SIZES,
  docFontCss,
  normalizeDocFontFamily,
  normalizeDocFontSize,
} from '@/lib/docFonts'
import { GemSparkle, GemShimmer } from '@/components/GemSparkle'
import { ConfirmModal } from '@/components/ConfirmModal'
import { useDialogEscapeStack } from '@/components/Modal'
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  AlignJustifyIcon,
  SignatureIcon,
  PageBreakIcon,
  UndoIcon,
  RedoIcon,
  XIcon,
  EditIcon,
  FileTextIcon,
  SearchIcon,
  TableIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@/components/icons'

export interface TrackedEditorDraft {
  documentVersionId: string
  bodyMarkdown: string
  documentKind: string
  matterNumber: string
  clientName: string
  versionNumber: number
  status: string
  // EDITOR-FIX-1 (item 7) — the per-document base font (persisted setting); null
  // on documents saved before the setting existed → the editor uses its defaults.
  fontFamily?: string | null
  fontSize?: number | null
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

// EDITOR-FIX-1 (item 1) — Edit-with-AI is now ASYNC (the synchronous
// legal.draft.revise ran the Claude call in-request and 504'd the gateway when
// the model was slow). runAi enqueues legal.draft.revise.request and polls
// legal.draft.revise.result on this budget (the BriefButton / RunnerReview poll
// pattern — the real read, never fake progress). ~2 min covers a full-document
// redraft; on timeout the rail shows an honest "still working" error + Retry.
const AI_POLL_MS = 2500
const AI_POLL_TRIES = 48

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
  onRegenerateFromScratch,
}: {
  draft: TrackedEditorDraft
  title: string
  statusLine: string
  aiEnabled: boolean
  initialFocus?: 'page' | 'ai'
  onClose: () => void
  onSaved: (newVersionId: string | null) => void
  // WF-RUNNER-TOOLBAR-1: the workflow runner's stage-level "Regenerate…" button
  // was deleted and its capability folded in here as a distinct AI-rail mode —
  // a full WORKER redraft from the matter's questionnaire/consultation (async,
  // supersedes with a new version), not this editor's in-place tracked-changes
  // revision. Only the runner (which has the matterEntityId + stage.key the
  // stage-scoped regenerate route needs) passes this; the standalone review
  // reader leaves it unset and the option doesn't appear there.
  onRegenerateFromScratch?: (changeNotes: string) => Promise<void>
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
  // EDITOR-FIX-1 (item 1) — the async revise's rail error + the instruction that
  // produced it, so a failed/timed-out job offers a Retry that reruns it. A
  // cancellation token stops the poll if the editor closes mid-flight.
  const [aiError, setAiError] = useState<string | null>(null)
  const lastAiInstructionRef = useRef<string | null>(null)
  const aiPollRef = useRef<{ cancelled: boolean } | null>(null)
  const aiPromptsRef = useRef<string[]>([])
  // B2.3 — the reasoning_trace_id each AI revision call produced, same index
  // order as aiPromptsRef. Saved links the LAST one to the accepting edit's
  // document_version (de-orphaning the revise-time trace: document.edit
  // previously always wrote reasoningTraceId: null regardless).
  const aiTraceIdsRef = useRef<string[]>([])
  const [aiPromptCount, setAiPromptCount] = useState(0)
  // B2.3 — rejected hunks this session (accepted ones already live in
  // acceptRef.current.accepted). Currently these vanish on Reject with no
  // record anywhere; kept here so a rejected AI suggestion is still counted
  // and stored in the redline ops blob, not silently dropped.
  const rejectedRef = useRef<RedlineOp[]>([])

  // "Regenerate from scratch instead" — a distinct AI-rail mode, worker-driven,
  // superseding this version rather than revising it in place (see
  // onRegenerateFromScratch above). Own busy/error so it never fights aiWorking.
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenNotes, setRegenNotes] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)

  // EDITOR-FIX-1 (item 7) — the per-document base font (family + size), a real
  // persisted setting. Seeded from the loaded version, applied to the page below,
  // saved onto version n+1, and threaded into the PDF export. Changing it marks
  // the document dirty (a font change alone is a saveable edit).
  const initialFontFamily = normalizeDocFontFamily(draft.fontFamily)
  const initialFontSize = normalizeDocFontSize(draft.fontSize)
  const [fontFamily, setFontFamily] = useState(initialFontFamily)
  const [fontSize, setFontSize] = useState(initialFontSize)
  const fontChanged = fontFamily !== initialFontFamily || fontSize !== initialFontSize

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const confirmRef = useRef(false)
  confirmRef.current = confirmDiscard

  // EDITOR-FIND-1 — find & replace. Matches live in extractDocText text-space
  // (the tracked-changes model's coordinate system) and are refreshed inside
  // recompute, so they stay honest through typing, AI revisions, and
  // accept/reject. Replacements are ordinary editor splices: under Track
  // changes they surface as pending hunks like any other edit.
  const [findOpen, setFindOpenState] = useState(false)
  const findOpenRef = useRef(false)
  const [findQuery, setFindQueryState] = useState('')
  const findQueryRef = useRef('')
  const [replaceWith, setReplaceWith] = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findActive, setFindActiveState] = useState(0)
  const findActiveRef = useRef(0)
  const findMatchesRef = useRef<SearchTextMatch[]>([])
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const setFindActive = (i: number): void => {
    findActiveRef.current = i
    setFindActiveState(i)
  }

  // DOC-TABLES-1 — the toolbar's table menu; word count rides recompute too.
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const tableMenuRef = useRef<HTMLDivElement | null>(null)
  const [wordCount, setWordCount] = useState(0)

  const initialBaseTextRef = useRef('')
  const seedHtmlRef = useRef('')
  // Assigned below once refreshSearch exists; recompute (defined first) calls
  // through the ref so find results track every doc change without a hook-order
  // dependency cycle.
  const searchRefreshRef = useRef<() => void>(() => {})
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
    setWordCount(countWords(map.text))
    searchRefreshRef.current()
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

  // ── EDITOR-FIND-1: find & replace ───────────────────────────────────────────
  const refreshSearch = useCallback((): void => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const map = extractDocText(ed.state.doc)
    const matches = findOpenRef.current ? findMatches(map.text, findQueryRef.current) : []
    findMatchesRef.current = matches
    setFindActive(matches.length === 0 ? 0 : Math.min(findActiveRef.current, matches.length - 1))
    setFindCount(matches.length)
    setSearchDecorations(
      ed.view,
      buildSearchDecorations(ed.state.doc, map, matches, findActiveRef.current),
    )
  }, [])
  searchRefreshRef.current = refreshSearch

  const setFindQuery = (q: string): void => {
    findQueryRef.current = q
    setFindQueryState(q)
    findActiveRef.current = 0
    refreshSearch()
  }

  const openFind = useCallback((): void => {
    findOpenRef.current = true
    setFindOpenState(true)
    window.setTimeout(() => findInputRef.current?.select(), 0)
    refreshSearch()
  }, [refreshSearch])

  const closeFind = useCallback((): void => {
    findOpenRef.current = false
    setFindOpenState(false)
    refreshSearch()
    editorRef.current?.commands.focus()
  }, [refreshSearch])

  // Step to the next/previous match: repaint the active highlight and move the
  // editor selection there (a plain transaction — no focus steal, so Enter in
  // the find input can be pressed repeatedly).
  const gotoMatch = useCallback((dir: 1 | -1): void => {
    const ed = editorRef.current
    const matches = findMatchesRef.current
    if (!ed || matches.length === 0) return
    const next = (findActiveRef.current + dir + matches.length) % matches.length
    setFindActive(next)
    const map = extractDocText(ed.state.doc)
    setSearchDecorations(ed.view, buildSearchDecorations(ed.state.doc, map, matches, next))
    const m = matches[next]!
    const from = map.posAt(m.start, 'start')
    const to = map.posAt(m.end, 'end')
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)).scrollIntoView(),
    )
  }, [])

  // Replace is an ordinary editor splice: under Track changes it becomes a
  // pending hunk (reviewable, rejectable) exactly like typing the words would.
  const replaceActive = useCallback((): void => {
    const ed = editorRef.current
    const matches = findMatchesRef.current
    if (!ed || matches.length === 0) return
    const m = matches[Math.min(findActiveRef.current, matches.length - 1)]!
    const map = extractDocText(ed.state.doc)
    const from = map.posAt(m.start, 'start')
    const to = map.posAt(m.end, 'end')
    if (replaceWith === '') {
      ed.chain().deleteRange({ from, to }).run()
    } else {
      ed.chain()
        .insertContentAt(
          { from, to },
          { type: 'text', text: replaceWith },
          {
            updateSelection: false,
          },
        )
        .run()
    }
    recompute()
  }, [replaceWith, recompute])

  const replaceAll = useCallback((): void => {
    const ed = editorRef.current
    const matches = findMatchesRef.current
    if (!ed || matches.length === 0) return
    // All positions come from ONE map of the pre-splice doc; applying
    // back-to-front keeps every earlier position valid while later ones splice
    // (matches never overlap, so the ranges are independent).
    const map = extractDocText(ed.state.doc)
    let chain = ed.chain()
    for (const m of [...matches].sort((a, b) => b.start - a.start)) {
      const from = map.posAt(m.start, 'start')
      const to = map.posAt(m.end, 'end')
      if (replaceWith === '') chain = chain.deleteRange({ from, to })
      else
        chain = chain.insertContentAt(
          { from, to },
          { type: 'text', text: replaceWith },
          {
            updateSelection: false,
          },
        )
    }
    chain.run()
    recompute()
  }, [replaceWith, recompute])

  // ⌘F / Ctrl+F opens the find bar (replacing the browser's find, which can't
  // see match positions inside the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        openFind()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openFind])

  // DOC-TABLES-1: the table menu closes on any press outside it.
  useEffect(() => {
    if (!tableMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (tableMenuRef.current && !tableMenuRef.current.contains(e.target as Node)) {
        setTableMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [tableMenuOpen])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      // Inline font/size MARKS (template-editor styling) must parse so styled
      // documents round-trip losslessly; the toolbar's font selects control the
      // per-document BASE font instead (EDITOR-FIX-1 item 7).
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // DOC-TABLES-1: tables (GFM pipe tables in the stored markdown). Cell
      // edits are ordinary text edits to the hunk model; table structure is
      // furniture (like lists), dirty via the HTML compare.
      TableKit,
      TemplateVariable.configure({ resolve: () => 'matched' }),
      SignatureLine,
      PageBreak,
      TrackChangesDecorations,
      // EDITOR-FIX-1 (item 4): render [[MISSING: field]] merge gaps as warn chips
      // (the raw marker stays in the model — presentation only).
      MissingFieldDecorations,
      SearchDecorations,
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
      setWordCount(countWords(text))
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
      strike: ctx.editor?.isActive('strike') ?? false,
      h1: ctx.editor?.isActive('heading', { level: 1 }) ?? false,
      h2: ctx.editor?.isActive('heading', { level: 2 }) ?? false,
      h3: ctx.editor?.isActive('heading', { level: 3 }) ?? false,
      alignLeft: ctx.editor?.isActive({ textAlign: 'left' }) ?? false,
      alignCenter: ctx.editor?.isActive({ textAlign: 'center' }) ?? false,
      alignRight: ctx.editor?.isActive({ textAlign: 'right' }) ?? false,
      alignJustify: ctx.editor?.isActive({ textAlign: 'justify' }) ?? false,
      bulletList: ctx.editor?.isActive('bulletList') ?? false,
      orderedList: ctx.editor?.isActive('orderedList') ?? false,
      blockquote: ctx.editor?.isActive('blockquote') ?? false,
      inTable: ctx.editor?.isActive('table') ?? false,
    }),
  })

  // Full-screen dialog behavior: body scroll lock + Escape closes. This editor
  // can now render INSIDE another surface's own <Modal> (the workflow runner's
  // step modal — B2.1), so its Escape handling joins the SAME open-dialog stack
  // <Modal> uses: without that, both this listener and the host Modal's would
  // fire on one Escape press, and the host could close out from under an
  // unsaved edit. The confirmRef check stays as defense in depth even though
  // the discard-confirm (a <ConfirmModal>, itself stack-aware) already sits
  // above this editor in the same stack.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])
  useDialogEscapeStack(() => {
    if (!confirmRef.current) requestCloseRef.current()
  })

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
      // B2.3 — log every rejected hunk (AI or manual) before it's gone; Save
      // carries these in the redline ops blob / counts so a rejected AI
      // suggestion is a recorded outcome, not silence.
      rejectedRef.current = [
        ...rejectedRef.current,
        ...hunks.map((h) => ({
          id: h.id,
          kind: h.kind,
          oldText: h.oldText,
          newText: h.newText,
          origin: h.origin,
          prompt: h.prompt,
        })),
      ]
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
      // B2.3 — log these as rejected too; the shortcut skips applyRejects'
      // editor-transaction path but not its bookkeeping.
      rejectedRef.current = [
        ...rejectedRef.current,
        ...pendingRef.current.map((h) => ({
          id: h.id,
          kind: h.kind,
          oldText: h.oldText,
          newText: h.newText,
          origin: h.origin,
          prompt: h.prompt,
        })),
      ]
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

  // ── Edit with AI (ASYNC — enqueue legal.draft.revise.request, poll the result) ──
  // EDITOR-FIX-1 (item 1): the model redraft runs OFF the request on the worker,
  // so a slow model no longer 504s the gateway. We enqueue, then poll the real
  // read (never fake progress); aiWorking stays true — the "Generating…" button +
  // shimmer ARE the honest working state — and the input is disabled throughout.
  // The proposal is applied EXACTLY as the synchronous path did (setContent →
  // tracked-changes diff); a failure or timeout renders in the rail with a Retry.
  const runAi = useCallback(
    async (instructionRaw: string): Promise<void> => {
      const ed = editorRef.current
      const instruction = instructionRaw.trim()
      if (!ed || !instruction || aiWorking || pendingRef.current.length > 0) return
      lastAiInstructionRef.current = instruction
      setAiWorking(true)
      setAiNoChange(false)
      setAiError(null)
      setError(null)
      // Cancel any prior poll before starting a fresh one.
      if (aiPollRef.current) aiPollRef.current.cancelled = true
      const token = { cancelled: false }
      aiPollRef.current = token
      try {
        // Revise the attorney's CURRENT accepted working text (not the stored
        // version) so a revision composes with unsaved accepted changes.
        const baseMarkdown = htmlToMarkdown(ed.getHTML())
        const { requestId } = await callAttorneyMcp<{ requestId: string; jobId: string }>({
          toolName: 'legal.draft.revise.request',
          input: { documentVersionId: draft.documentVersionId, instruction, baseMarkdown },
        })
        for (let i = 0; i < AI_POLL_TRIES; i++) {
          await new Promise((r) => setTimeout(r, AI_POLL_MS))
          if (token.cancelled) return
          const { result } = await callAttorneyMcp<{
            result: {
              status: 'completed' | 'failed'
              revisedMarkdown?: string
              reasoningTraceId?: string
              instruction?: string
              error?: string
            } | null
          }>({
            toolName: 'legal.draft.revise.result',
            input: { requestId },
          }).catch(() => ({ result: null }))
          if (token.cancelled) return
          if (!result) continue
          if (result.status === 'failed') {
            setAiError(result.error || 'The revision could not be generated. Try again.')
            setAiWorking(false)
            return
          }
          // Completed — apply the proposal exactly as the synchronous path did.
          const editor = editorRef.current
          if (!editor || editor.isDestroyed) return
          setTrackOn(true) // AI output is always tracked, whatever the toggle said.
          editor.commands.setContent(markdownToHtml(result.revisedMarkdown ?? ''), {
            emitUpdate: false,
          })
          const usedInstruction = result.instruction ?? instruction
          aiPromptsRef.current = [...aiPromptsRef.current, usedInstruction]
          aiTraceIdsRef.current = [...aiTraceIdsRef.current, result.reasoningTraceId ?? '']
          setAiPromptCount(aiPromptsRef.current.length)
          setAiPrompt('')
          recompute({ prompt: usedInstruction })
          if (pendingRef.current.length === 0) setAiNoChange(true)
          setAiWorking(false)
          return
        }
        // Poll budget exhausted without a result.
        if (!token.cancelled) {
          setAiError(
            'The AI is still working on this revision — it can take a moment for a large document. Try again shortly.',
          )
          setAiWorking(false)
        }
      } catch (err) {
        if (!token.cancelled) {
          setAiError(err instanceof Error ? err.message : String(err))
          setAiWorking(false)
        }
      }
    },
    [aiWorking, draft.documentVersionId, recompute],
  )

  // Stop the async revise poll if the editor unmounts mid-flight.
  useEffect(() => {
    return () => {
      if (aiPollRef.current) aiPollRef.current.cancelled = true
    }
  }, [])

  // ── Regenerate from scratch (worker full redraft with change notes) ────────
  // Distinct from runAi above: this supersedes the version entirely, off-request
  // on the worker, using the matter's questionnaire/consultation — not an
  // in-place revision of THIS text. Any unsaved tracked changes in this session
  // are moot once a fresh draft is coming, so success closes the editor outright
  // (not requestClose's discard-confirm). A failure keeps the panel open with
  // the error inline so the attorney can retry without losing their notes.
  const runRegenerateFromScratch = useCallback(async (): Promise<void> => {
    if (!onRegenerateFromScratch || !regenNotes.trim() || regenBusy) return
    setRegenBusy(true)
    setRegenError(null)
    try {
      await onRegenerateFromScratch(regenNotes.trim())
      onClose()
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : String(err))
    } finally {
      setRegenBusy(false)
    }
  }, [onRegenerateFromScratch, regenNotes, regenBusy, onClose])

  // ── Save: ONE new version through the append-only legal.draft.edit ──────────
  const canSave = (changed || fontChanged) && pending.length === 0 && !busy && !aiWorking
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
      // B2.3 — the structured redline artifact. The handler stores `ops` as a
      // content_blob and emits document.redlined alongside the new version;
      // reasoningTraceId links the LAST AI revision's trace (if any) to the
      // accepting edit, de-orphaning it.
      const counts = buildRedlineCounts(acceptRef.current.accepted, rejectedRef.current)
      const source = classifyRedlineSource(counts, untrackedEditsRef.current)
      const instructionText =
        aiPromptsRef.current.length > 0 ? aiPromptsRef.current.join(' | ') : undefined
      const reasoningTraceId =
        aiTraceIdsRef.current.length > 0
          ? aiTraceIdsRef.current[aiTraceIdsRef.current.length - 1]
          : undefined
      const result = await callAttorneyMcp<{ effects: Array<{ documentVersionId?: string }> }>({
        toolName: 'legal.draft.edit',
        input: {
          documentVersionId: draft.documentVersionId,
          documentMarkdown,
          note,
          ops: {
            accepted: acceptRef.current.accepted,
            rejected: rejectedRef.current,
            untrackedEdits: untrackedEditsRef.current,
          },
          source,
          instructionText,
          reasoningTraceId,
          counts,
          // EDITOR-FIX-1 (item 7): persist the per-document base font on the new
          // version so it reloads with the document and flows into the PDF export.
          fontFamily,
          fontSize,
        },
      })
      const newId = result.effects?.find((e) => e.documentVersionId)?.documentVersionId ?? null
      onSaved(newId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }, [busy, draft.documentVersionId, onSaved])

  const dirty = changed || fontChanged || pending.length > 0
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
    opts: { toggle?: boolean; text?: boolean } = {},
  ): ReactNode => (
    <button
      type="button"
      className={`li-edtr-tb-btn${opts.text ? ' li-edtr-tb-btn--txt' : ''}${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={aria}
      aria-label={aria}
      aria-pressed={opts.toggle === false ? undefined : active}
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
        {markBtn(marks?.strike ?? false, <StrikethroughIcon size={15} />, 'Strikethrough', () =>
          editor?.chain().focus().toggleStrike().run(),
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        {/* EDITOR-FIX-1 (item 7): the per-document base font — a real persisted
            setting (family + size), applied to the page and flowed into export. */}
        <select
          className="li-edtr-tb-select"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          title="Font"
          aria-label="Font"
          style={{ fontFamily: docFontCss(fontFamily) }}
        >
          {DOC_FONT_OPTIONS.map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          className="li-edtr-tb-select li-edtr-tb-select--size"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          title="Font size"
          aria-label="Font size"
        >
          {DOC_FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="li-edtr-tb-sep" aria-hidden />
        {/* WF-EDITOR-TOOLS-1: the rest of the template editor's word tools, so the
            workflow runner's Edit flow matches it. Block-level formatting changes
            no text, so it never creates a tracked-changes hunk (the hunk model
            tracks language, not furniture) — but it does mark the doc dirty via
            the HTML compare, exactly like bold/italic always have. */}
        {markBtn(
          marks?.h1 ?? false,
          'H1',
          'Heading 1',
          () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
          { text: true },
        )}
        {markBtn(
          marks?.h2 ?? false,
          'H2',
          'Heading 2',
          () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          { text: true },
        )}
        {markBtn(
          marks?.h3 ?? false,
          'H3',
          'Heading 3',
          () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
          { text: true },
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        {markBtn(marks?.alignLeft ?? false, <AlignLeftIcon size={15} />, 'Align left', () =>
          editor?.chain().focus().setTextAlign('left').run(),
        )}
        {markBtn(marks?.alignCenter ?? false, <AlignCenterIcon size={15} />, 'Align center', () =>
          editor?.chain().focus().setTextAlign('center').run(),
        )}
        {markBtn(marks?.alignRight ?? false, <AlignRightIcon size={15} />, 'Align right', () =>
          editor?.chain().focus().setTextAlign('right').run(),
        )}
        {markBtn(marks?.alignJustify ?? false, <AlignJustifyIcon size={15} />, 'Justify', () =>
          editor?.chain().focus().setTextAlign('justify').run(),
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        {markBtn(marks?.bulletList ?? false, <ListIcon size={15} />, 'Bulleted list', () =>
          editor?.chain().focus().toggleBulletList().run(),
        )}
        {markBtn(marks?.orderedList ?? false, <ListOrderedIcon size={15} />, 'Numbered list', () =>
          editor?.chain().focus().toggleOrderedList().run(),
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        {markBtn(marks?.blockquote ?? false, <QuoteIcon size={15} />, 'Block quote', () =>
          editor?.chain().focus().toggleBlockquote().run(),
        )}
        {markBtn(
          false,
          <SignatureIcon size={15} />,
          'Insert signature line',
          () => editor?.chain().focus().insertSignatureLine('Signature').run(),
          { toggle: false },
        )}
        {markBtn(
          false,
          <PageBreakIcon size={15} />,
          'Insert page break',
          () => editor?.chain().focus().insertPageBreak().run(),
          { toggle: false },
        )}
        {/* DOC-TABLES-1: table insert + in-table row/column controls */}
        <div className="li-edtr-tbmenu" ref={tableMenuRef}>
          {markBtn(
            marks?.inTable ?? false,
            <TableIcon size={15} />,
            'Table',
            () => setTableMenuOpen((v) => !v),
            { toggle: false },
          )}
          {tableMenuOpen && (
            <div className="li-edtr-tbmenu-pop" role="menu" aria-label="Table">
              {(
                [
                  {
                    label: 'Insert table',
                    run: () =>
                      editor
                        ?.chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run(),
                    needsTable: false,
                  },
                  {
                    label: 'Add row above',
                    run: () => editor?.chain().focus().addRowBefore().run(),
                    needsTable: true,
                  },
                  {
                    label: 'Add row below',
                    run: () => editor?.chain().focus().addRowAfter().run(),
                    needsTable: true,
                  },
                  {
                    label: 'Add column left',
                    run: () => editor?.chain().focus().addColumnBefore().run(),
                    needsTable: true,
                  },
                  {
                    label: 'Add column right',
                    run: () => editor?.chain().focus().addColumnAfter().run(),
                    needsTable: true,
                  },
                  {
                    label: 'Toggle header row',
                    run: () => editor?.chain().focus().toggleHeaderRow().run(),
                    needsTable: true,
                  },
                  {
                    label: 'Delete row',
                    run: () => editor?.chain().focus().deleteRow().run(),
                    needsTable: true,
                    danger: true,
                  },
                  {
                    label: 'Delete column',
                    run: () => editor?.chain().focus().deleteColumn().run(),
                    needsTable: true,
                    danger: true,
                  },
                  {
                    label: 'Delete table',
                    run: () => editor?.chain().focus().deleteTable().run(),
                    needsTable: true,
                    danger: true,
                  },
                ] as Array<{
                  label: string
                  run: () => void
                  needsTable: boolean
                  danger?: boolean
                }>
              ).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`li-edtr-tbmenu-item${item.danger ? ' li-edtr-tbmenu-item--danger' : ''}`}
                  disabled={item.needsTable && !(marks?.inTable ?? false)}
                  onClick={() => {
                    item.run()
                    setTableMenuOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="li-edtr-tb-sep" aria-hidden />
        {markBtn(
          false,
          <UndoIcon size={15} />,
          'Undo',
          () => editor?.chain().focus().undo().run(),
          {
            toggle: false,
          },
        )}
        {markBtn(
          false,
          <RedoIcon size={15} />,
          'Redo',
          () => editor?.chain().focus().redo().run(),
          {
            toggle: false,
          },
        )}
        <div className="li-edtr-tb-sep" aria-hidden />
        {/* EDITOR-FIND-1: find & replace (⌘F) */}
        {markBtn(findOpen, <SearchIcon size={15} />, 'Find & replace (⌘F)', () =>
          findOpen ? closeFind() : openFind(),
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

      {/* EDITOR-FIND-1: the find & replace bar (a second toolbar row) */}
      {findOpen && (
        <div className="li-edtr-findbar" role="search" aria-label="Find and replace">
          <SearchIcon size={14} aria-hidden />
          <input
            ref={findInputRef}
            className="li-edtr-find-input"
            placeholder="Find in document"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                gotoMatch(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                closeFind()
              }
            }}
            autoFocus
            aria-label="Find"
          />
          <span className="li-edtr-find-count" aria-live="polite">
            {findCount > 0
              ? `${findActive + 1} of ${findCount}`
              : findQuery.trim()
                ? 'No matches'
                : ''}
          </span>
          <button
            type="button"
            className="li-edtr-tb-btn"
            onClick={() => gotoMatch(-1)}
            disabled={findCount === 0}
            title="Previous match"
            aria-label="Previous match"
          >
            <ChevronUpIcon size={14} />
          </button>
          <button
            type="button"
            className="li-edtr-tb-btn"
            onClick={() => gotoMatch(1)}
            disabled={findCount === 0}
            title="Next match"
            aria-label="Next match"
          >
            <ChevronDownIcon size={14} />
          </button>
          <input
            className="li-edtr-find-input li-edtr-find-input--replace"
            placeholder="Replace with"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                closeFind()
              }
            }}
            aria-label="Replace with"
          />
          <button
            type="button"
            className="li-edtr-find-btn"
            onClick={replaceActive}
            disabled={findCount === 0 || busy || aiWorking}
          >
            Replace
          </button>
          <button
            type="button"
            className="li-edtr-find-btn"
            onClick={replaceAll}
            disabled={findCount === 0 || busy || aiWorking}
          >
            Replace all
          </button>
          <button
            type="button"
            className="li-edtr-tb-btn li-edtr-find-close"
            onClick={closeFind}
            title="Close find"
            aria-label="Close find"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {error && <div className="alert alert-error li-edtr-alert">{error}</div>}

      {/* main: page canvas + AI/changes rail */}
      <div className="li-edtr-main">
        <div className="li-edtr-canvas" ref={fitRef}>
          <DocumentSheet variant="full" watermark={watermark}>
            {editor ? (
              <div style={{ fontFamily: docFontCss(fontFamily), fontSize: `${fontSize}pt` }}>
                <EditorContent editor={editor} />
              </div>
            ) : (
              <div className="li-edtr-loading">Loading editor…</div>
            )}
            {aiWorking && <GemShimmer />}
          </DocumentSheet>
        </div>

        <aside className="li-edtr-rail">
          {aiEnabled && (
            <div className="li-edtr-ai">
              {regenOpen ? (
                // ── Regenerate from scratch (worker full redraft) ─────────────────
                <>
                  <div className="li-edtr-ai-head">
                    <GemSparkle size={17} />
                    <span>Regenerate From Scratch</span>
                  </div>
                  <p className="li-edtr-regen-hint">
                    Re-drafts this document on the worker from the matter’s questionnaire and
                    consultation — not an in-place edit like Edit With AI. The current version is
                    kept; the redraft supersedes it, append-only.
                  </p>
                  <textarea
                    className="li-edtr-ai-prompt"
                    value={regenNotes}
                    onChange={(e) => setRegenNotes(e.target.value)}
                    placeholder="What needs to change — e.g. name the alternate executor as the client’s sister."
                    disabled={regenBusy}
                    rows={4}
                    autoFocus
                  />
                  {regenError && <div className="li-edtr-ai-note">{regenError}</div>}
                  <div className="li-edtr-regen-actions">
                    <button
                      type="button"
                      className="li-edtr-ai-generate"
                      onClick={() => void runRegenerateFromScratch()}
                      disabled={regenBusy || !regenNotes.trim()}
                    >
                      {regenBusy && <span className="spinner" />}
                      {regenBusy ? 'Starting…' : 'Regenerate'}
                    </button>
                    <button
                      type="button"
                      className="li-edtr-regen-back"
                      onClick={() => {
                        setRegenOpen(false)
                        setRegenError(null)
                      }}
                      disabled={regenBusy}
                    >
                      Back to Edit With AI
                    </button>
                  </div>
                </>
              ) : (
                // ── Edit With AI (in-place tracked-changes revision) ──────────────
                <>
                  <div className="li-edtr-ai-head">
                    <GemSparkle size={17} />
                    <span>Edit With AI</span>
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
                  {aiError && (
                    <div className="li-edtr-ai-error" role="alert">
                      <span className="li-edtr-ai-error-msg">{aiError}</span>
                      {lastAiInstructionRef.current && (
                        <button
                          type="button"
                          className="li-edtr-ai-retry"
                          onClick={() => {
                            const instr = lastAiInstructionRef.current
                            setAiError(null)
                            if (instr) void runAi(instr)
                          }}
                          disabled={aiWorking || toggleBlocked}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                  {onRegenerateFromScratch && (
                    <button
                      type="button"
                      className="li-edtr-regen-link"
                      onClick={() => setRegenOpen(true)}
                      disabled={aiWorking}
                    >
                      Regenerate from scratch instead
                    </button>
                  )}
                </>
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
          <span className="li-edtr-foot-words">{wordCount.toLocaleString()} words</span>
          {' · '}
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

// Word count over the extracted document text (the same text the diff sees).
function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
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
