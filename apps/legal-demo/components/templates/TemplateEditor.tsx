'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef, type MutableRefObject } from 'react'
import { TemplateVariable } from './TemplateVariableNode'

export interface TemplateEditorHandle {
  getHTML: () => string
  insertVariable: (name: string) => void
  focus: () => void
}

interface Props {
  initialHtml: string
  placeholder?: string
  onChange?: (html: string) => void
  // Pass the same MutableRefObject across renders — the editor writes its
  // imperative handle into .current. Recreating the wrapper object every
  // render would orphan the handle on the previous object.
  editorRef?: MutableRefObject<TemplateEditorHandle | null>
}

export function TemplateEditor({ initialHtml, placeholder, onChange, editorRef }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Start drafting…',
      }),
      TemplateVariable,
    ],
    content: initialHtml || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'tpl-editor-content',
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

  // Expose imperative handle for the toolbar / sidebar variable inserter.
  useEffect(() => {
    if (!editor || !editorRef) return
    const handle: TemplateEditorHandle = {
      getHTML: () => editor.getHTML(),
      insertVariable: (name: string) =>
        (editor.chain().focus() as unknown as { insertVariable(n: string): { run(): boolean } })
          .insertVariable(name)
          .run(),
      focus: () => editor.commands.focus(),
    }
    editorRef.current = handle
    return () => {
      if (editorRef.current === handle) editorRef.current = null
    }
  }, [editor, editorRef])

  if (!editor) {
    return <div className="tpl-editor-shell tpl-editor-loading">Loading editor…</div>
  }

  return (
    <div className="tpl-editor-shell">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="tpl-editor-content-wrap" />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  // `aria` is the accessible name (the visible label is glyph-only, e.g. "B").
  // Toggle buttons expose aria-pressed; one-shot actions (undo/redo) opt out.
  const btn = (
    active: boolean,
    label: string,
    aria: string,
    onClick: () => void,
    opts: { title?: string; toggle?: boolean } = {},
  ) => (
    <button
      type="button"
      className={`tpl-tb-btn${active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={opts.title ?? aria}
      aria-label={aria}
      aria-pressed={opts.toggle === false ? undefined : active}
    >
      {label}
    </button>
  )
  return (
    <div className="tpl-toolbar" role="toolbar" aria-label="Text formatting">
      {btn(editor.isActive('heading', { level: 1 }), 'H1', 'Heading 1', () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 2 }), 'H2', 'Heading 2', () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 3 }), 'H3', 'Heading 3', () =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}
      <div className="tpl-tb-sep" aria-hidden="true" />
      {btn(editor.isActive('bold'), 'B', 'Bold', () => editor.chain().focus().toggleBold().run(), {
        title: 'Bold (Ctrl+B)',
      })}
      {btn(
        editor.isActive('italic'),
        'I',
        'Italic',
        () => editor.chain().focus().toggleItalic().run(),
        { title: 'Italic (Ctrl+I)' },
      )}
      <div className="tpl-tb-sep" aria-hidden="true" />
      {btn(editor.isActive('bulletList'), '• List', 'Bulleted list', () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(editor.isActive('orderedList'), '1. List', 'Numbered list', () =>
        editor.chain().focus().toggleOrderedList().run(),
      )}
      <div className="tpl-tb-sep" aria-hidden="true" />
      {btn(editor.isActive('blockquote'), '“ Quote', 'Block quote', () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}
      <div className="tpl-tb-sep" aria-hidden="true" />
      {btn(false, '↶ Undo', 'Undo', () => editor.chain().focus().undo().run(), { toggle: false })}
      {btn(false, '↷ Redo', 'Redo', () => editor.chain().focus().redo().run(), { toggle: false })}
    </div>
  )
}
