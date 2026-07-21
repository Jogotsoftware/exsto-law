'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react'
import { TemplateVariable, type VariableStatus } from './TemplateVariableNode'
import { SignatureLine } from './SignatureLineNode'
import { PageBreak } from './PageBreakNode'
import { VariableSuggestion } from './VariableSuggestion'
import { useFitToWidth } from '@/lib/useFitToWidth'
import { DocumentSheet } from '@/components/DocumentSheet'
import { GemShimmer } from '@/components/GemSparkle'
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
  RedoIcon,
  UndoIcon,
} from '@/components/icons'

export interface TemplateEditorHandle {
  getHTML: () => string
  insertVariable: (name: string) => void
  // ES-3: insert an HTML fragment at the cursor (the eSign panel's role-tagged
  // signature/date/name blocks — sig-line divs the SignatureLine node parses).
  insertHtml: (html: string) => void
  focus: () => void
  // Replace the document content imperatively (e.g. applying an AI proposal) —
  // works even when the incoming HTML equals the last SEED (the prop-resync path
  // deliberately no-ops on that, which would silently keep unsaved edits).
  setContent: (html: string) => void
}

interface Props {
  initialHtml: string
  placeholder?: string
  onChange?: (html: string) => void
  // Pass the same MutableRefObject across renders — the editor writes its
  // imperative handle into .current. Recreating the wrapper object every
  // render would orphan the handle on the previous object.
  editorRef?: MutableRefObject<TemplateEditorHandle | null>
  // Classify a {{variable}} for coloring (matched/orphaned/unknown). Read live
  // through a ref, so updating the reference sets just recolors (no remount).
  validateVariable?: (name: string) => VariableStatus
  // Known variable names offered by the `{{` autocomplete. Read live (the
  // reference sets load asynchronously) so updates need no remount.
  variableNames?: string[]
  // 'legacy' (default) is the untouched per-service editor + the shared
  // edit-in-modal chrome (tpl-* classes) — never changed here. 'li' is WP-E's
  // comp-faithful chrome (li-tpl-* classes, docs/design/legal-instruments):
  // the canvas renders on the shared DocumentSheet `editor` page instead of the
  // legacy fixed-width sheet, so a sibling (the side-by-side sample-data
  // preview) can be passed as `children` into the same scrollable desk.
  variant?: 'legacy' | 'li'
  children?: ReactNode
  // li variant only: sweep the canvas with the shared GemShimmer while the
  // persistent AI bar (page.tsx) is drafting/revising the open document.
  aiRunning?: boolean
}

// Word-style font choices. Values are full CSS stacks (so the document renders
// with a sensible fallback) and validate against the document sanitizer's
// font-family allowlist (letters/spaces/commas/quotes/hyphens only — no url()).
const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: 'Default (Garamond)', value: '' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: "Calibri, 'Segoe UI', sans-serif" },
  { label: 'Courier New', value: "'Courier New', monospace" },
]

// Point sizes offered in the size picker. Stored as e.g. font-size:12pt.
const FONT_SIZES = ['10', '11', '12', '14', '16', '18', '24', '36']

export function TemplateEditor({
  initialHtml,
  placeholder,
  onChange,
  editorRef,
  validateVariable,
  variableNames,
  variant = 'legacy',
  children,
  aiRunning = false,
}: Props) {
  // The variable classifier read live by the node's coloring plugin. Configured
  // once (below) as a stable closure over this ref; updating the ref + nudging
  // the editor recolors without recreating it.
  const resolveRef = useRef(validateVariable)
  resolveRef.current = validateVariable

  // The autocomplete's candidate list, read live by the suggestion plugin (same
  // stable-closure-over-a-ref trick, so the list can load in without a remount).
  const namesRef = useRef(variableNames ?? [])
  namesRef.current = variableNames ?? []

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Start drafting…',
      }),
      // Per-run typography. FontFamily + FontSize attach to TextStyle, so it must
      // be present. They serialize to <span style="font-family|font-size"> — the
      // styling the document sanitizer allowlists end-to-end.
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TemplateVariable.configure({
        resolve: (name: string) => resolveRef.current?.(name) ?? 'matched',
      }),
      VariableSuggestion.configure({
        items: () => namesRef.current,
      }),
      SignatureLine,
      PageBreak,
    ],
    content: initialHtml || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: variant === 'li' ? 'li-tpl-page-body' : 'tpl-editor-content',
        spellcheck: 'true',
      },
    },
  })

  // Resync content when the initialHtml PROP changes (e.g. switching to another
  // template). content: is honored only at creation, so without this a new
  // document's body never loads and the previous one sticks (the documented
  // "stale content on switch" bug). We track the last seed we applied in a ref
  // and setContent only when the incoming seed differs — typing changes
  // editor.getHTML() but NOT this prop, so live edits are never clobbered.
  const lastSeed = useRef(initialHtml)
  useEffect(() => {
    if (!editor) return
    if (initialHtml !== lastSeed.current) {
      lastSeed.current = initialHtml
      // emitUpdate:false — seeding new content must not fire onChange (which would
      // bounce the body back through the markdown round-trip needlessly).
      editor.commands.setContent(initialHtml || '<p></p>', { emitUpdate: false })
    }
  }, [editor, initialHtml])

  // Recolor the chips when the classifier changes (e.g. the platform variables /
  // question library finish loading). An empty transaction re-runs the decoration
  // plugin without touching the document.
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr)
  }, [editor, validateVariable])

  // Expose imperative handle for the toolbar / sidebar variable inserter.
  useEffect(() => {
    if (!editor || !editorRef) return
    const handle: TemplateEditorHandle = {
      getHTML: () => editor.getHTML(),
      insertVariable: (name: string) =>
        (editor.chain().focus() as unknown as { insertVariable(n: string): { run(): boolean } })
          .insertVariable(name)
          .run(),
      insertHtml: (html: string) => {
        editor.chain().focus().insertContent(html).run()
      },
      focus: () => editor.commands.focus(),
      setContent: (html: string) => {
        editor.commands.setContent(html || '<p></p>', { emitUpdate: false })
      },
    }
    editorRef.current = handle
    return () => {
      if (editorRef.current === handle) editorRef.current = null
    }
  }, [editor, editorRef])

  // Zoom-to-fit so the fixed-width page scales to the (often narrow) editor
  // column. The li variant's page is the shared DocumentSheet `editor` width
  // (612px); with the side-by-side sample preview showing (children present)
  // there are two pages + a 24px gap to fit instead of one.
  const LI_PAGE_WIDTH = 612
  const fitRef = useFitToWidth<HTMLDivElement>(
    variant === 'li' ? (children ? LI_PAGE_WIDTH * 2 + 24 : LI_PAGE_WIDTH) : undefined,
  )

  if (!editor) {
    return (
      <div
        className={
          variant === 'li' ? 'li-tpl-editor-loading' : 'tpl-editor-shell tpl-editor-loading'
        }
      >
        Loading editor…
      </div>
    )
  }

  if (variant === 'li') {
    return (
      <>
        <Toolbar editor={editor} variant="li" />
        <div className="li-tpl-canvas-desk" ref={fitRef}>
          {aiRunning && <GemShimmer />}
          <DocumentSheet variant="editor" serif className="li-tpl-page">
            <EditorContent editor={editor} />
          </DocumentSheet>
          {children}
        </div>
      </>
    )
  }

  return (
    <div className="tpl-editor-shell">
      <Toolbar editor={editor} />
      <div className="tpl-editor-content-wrap" ref={fitRef}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function Toolbar({ editor, variant = 'legacy' }: { editor: Editor; variant?: 'legacy' | 'li' }) {
  const isLi = variant === 'li'
  const toolbarClass = isLi ? 'li-tpl-toolbar' : 'tpl-toolbar'
  const selectClass = isLi ? 'li-tpl-tb-select' : 'tpl-tb-select'
  const sepClass = isLi ? 'li-tpl-tb-sep' : 'tpl-tb-sep'

  // `aria` is the accessible name; the visible label is an icon (Word-style) or a
  // short text style name (H1/H2/H3). Toggle buttons expose aria-pressed; one-shot
  // actions (undo/redo) opt out.
  const btn = (
    active: boolean,
    label: ReactNode,
    aria: string,
    onClick: () => void,
    opts: { title?: string; toggle?: boolean } = {},
  ) => (
    <button
      type="button"
      className={`${isLi ? 'li-tpl-tb-btn' : 'tpl-tb-btn'}${active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={opts.title ?? aria}
      aria-label={aria}
      aria-pressed={opts.toggle === false ? undefined : active}
    >
      {label}
    </button>
  )

  const currentFont = (editor.getAttributes('textStyle').fontFamily as string) ?? ''
  // fontSize comes back like "12pt"; strip the unit for the select's value.
  const currentSize = ((editor.getAttributes('textStyle').fontSize as string) ?? '').replace(
    /pt$/,
    '',
  )

  return (
    <div className={toolbarClass} role="toolbar" aria-label="Text formatting">
      <select
        className={`${selectClass} ${isLi ? 'li-tpl-tb-font' : 'tpl-tb-font'}`}
        aria-label="Font"
        title="Font"
        value={currentFont}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v) editor.chain().focus().setFontFamily(v).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        className={`${selectClass} ${isLi ? 'li-tpl-tb-size' : 'tpl-tb-size'}`}
        aria-label="Font size"
        title="Font size"
        value={currentSize}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v) editor.chain().focus().setFontSize(`${v}pt`).run()
          else editor.chain().focus().unsetFontSize().run()
        }}
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className={sepClass} aria-hidden="true" />
      {btn(
        editor.isActive('bold'),
        <BoldIcon size={15} />,
        'Bold',
        () => editor.chain().focus().toggleBold().run(),
        { title: 'Bold (Ctrl+B)' },
      )}
      {btn(
        editor.isActive('italic'),
        <ItalicIcon size={15} />,
        'Italic',
        () => editor.chain().focus().toggleItalic().run(),
        { title: 'Italic (Ctrl+I)' },
      )}
      {btn(
        editor.isActive('underline'),
        <UnderlineIcon size={15} />,
        'Underline',
        () => editor.chain().focus().toggleUnderline().run(),
        { title: 'Underline (Ctrl+U)' },
      )}
      {btn(
        editor.isActive('strike'),
        <StrikethroughIcon size={15} />,
        'Strikethrough',
        () => editor.chain().focus().toggleStrike().run(),
        { title: 'Strikethrough' },
      )}

      <div className={sepClass} aria-hidden="true" />
      {btn(editor.isActive('heading', { level: 1 }), 'H1', 'Heading 1', () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 2 }), 'H2', 'Heading 2', () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 3 }), 'H3', 'Heading 3', () =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}

      <div className={sepClass} aria-hidden="true" />
      {btn(editor.isActive({ textAlign: 'left' }), <AlignLeftIcon size={15} />, 'Align left', () =>
        editor.chain().focus().setTextAlign('left').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'center' }),
        <AlignCenterIcon size={15} />,
        'Align center',
        () => editor.chain().focus().setTextAlign('center').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'right' }),
        <AlignRightIcon size={15} />,
        'Align right',
        () => editor.chain().focus().setTextAlign('right').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'justify' }),
        <AlignJustifyIcon size={15} />,
        'Justify',
        () => editor.chain().focus().setTextAlign('justify').run(),
      )}

      <div className={sepClass} aria-hidden="true" />
      {btn(editor.isActive('bulletList'), <ListIcon size={15} />, 'Bulleted list', () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(editor.isActive('orderedList'), <ListOrderedIcon size={15} />, 'Numbered list', () =>
        editor.chain().focus().toggleOrderedList().run(),
      )}

      <div className={sepClass} aria-hidden="true" />
      {btn(editor.isActive('blockquote'), <QuoteIcon size={15} />, 'Block quote', () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}
      {btn(
        false,
        <SignatureIcon size={15} />,
        'Insert signature line',
        () => editor.chain().focus().insertSignatureLine('Signature').run(),
        { toggle: false, title: 'Insert signature line' },
      )}
      {btn(
        false,
        <PageBreakIcon size={15} />,
        'Insert page break',
        () => editor.chain().focus().insertPageBreak().run(),
        { toggle: false, title: 'Insert page break' },
      )}

      <div className={sepClass} aria-hidden="true" />
      {btn(false, <UndoIcon size={15} />, 'Undo', () => editor.chain().focus().undo().run(), {
        toggle: false,
      })}
      {btn(false, <RedoIcon size={15} />, 'Redo', () => editor.chain().focus().redo().run(), {
        toggle: false,
      })}
    </div>
  )
}
