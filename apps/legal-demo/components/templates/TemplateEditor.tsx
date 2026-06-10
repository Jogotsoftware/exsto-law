'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, type MutableRefObject } from 'react'
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
  const btn = (active: boolean, label: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      className={`tpl-tb-btn${active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title ?? label}
    >
      {label}
    </button>
  )
  return (
    <div className="tpl-toolbar">
      {btn(editor.isActive('heading', { level: 1 }), 'H1', () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 2 }), 'H2', () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 3 }), 'H3', () =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}
      <div className="tpl-tb-sep" />
      {btn(
        editor.isActive('bold'),
        'B',
        () => editor.chain().focus().toggleBold().run(),
        'Bold (Ctrl+B)',
      )}
      {btn(
        editor.isActive('italic'),
        'I',
        () => editor.chain().focus().toggleItalic().run(),
        'Italic (Ctrl+I)',
      )}
      <div className="tpl-tb-sep" />
      {btn(editor.isActive('bulletList'), '• List', () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(editor.isActive('orderedList'), '1. List', () =>
        editor.chain().focus().toggleOrderedList().run(),
      )}
      <div className="tpl-tb-sep" />
      {btn(editor.isActive('blockquote'), '“ Quote', () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}
      <div className="tpl-tb-sep" />
      {btn(false, '↶ Undo', () => editor.chain().focus().undo().run())}
      {btn(false, '↷ Redo', () => editor.chain().focus().redo().run())}
    </div>
  )
}
