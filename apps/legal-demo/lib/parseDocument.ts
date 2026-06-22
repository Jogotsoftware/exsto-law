import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { htmlToMarkdown } from '@/lib/templateBody'

// Shared, stateless document → text parser used by BOTH the Templates importer
// and the assistant chat's "attach a document" upload. PDF and plain text come
// through as text; DOCX/HTML are converted STRUCTURALLY (headings, bold/italic,
// lists survive) via the same HTML→markdown bridge the editor round-trips. It
// touches no substrate table — pure parsing — so it lives as a lib, not a tool.
//
// SERVER-ONLY: pulls in mammoth + pdf-parse (Node libs). Import it from route
// handlers (runtime 'nodejs') only, never from a client component.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

// A parse failure the caller maps straight to an HTTP status. Carries the
// user-facing message and the status the route should return.
export class DocumentParseError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DocumentParseError'
    this.status = status
  }
}

// Parse an uploaded file to clean text/markdown, or throw DocumentParseError.
export async function parseUploadedDocument(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocumentParseError('File too large (max 10 MB).', 413)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''

  let text: string
  try {
    if (name.endsWith('.pdf') || type === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      const result = await parser.getText()
      text = result.text ?? ''
    } else if (
      name.endsWith('.docx') ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      // Structured: convert to HTML (preserving headings/bold/italic/lists), then
      // to markdown via the editor's bridge so the import matches what the editor
      // round-trips. (extractRawText would flatten all formatting to bare text.)
      const result = await mammoth.convertToHtml({ buffer })
      text = htmlToMarkdown(result.value ?? '')
    } else if (name.endsWith('.doc')) {
      throw new DocumentParseError(
        'Legacy .doc isn’t supported — save it as .docx or PDF and try again.',
        415,
      )
    } else if (name.endsWith('.html') || name.endsWith('.htm') || type === 'text/html') {
      // Structured HTML → markdown (same bridge), so an exported web/Word HTML
      // keeps its structure instead of dumping raw tags.
      text = htmlToMarkdown(buffer.toString('utf8'))
    } else {
      // .txt / .md / anything else text-like — already plain text or markdown.
      text = buffer.toString('utf8')
    }
  } catch (err) {
    if (err instanceof DocumentParseError) throw err
    throw new DocumentParseError(
      `Could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      422,
    )
  }

  // Normalize line endings and collapse runs of blank lines for a clean result.
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) {
    throw new DocumentParseError(
      'No readable text found in that file (a scanned/image-only PDF has no text layer).',
      422,
    )
  }
  return text
}
