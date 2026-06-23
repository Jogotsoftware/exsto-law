import { htmlToMarkdown } from '@/lib/templateBody'

// pdf-parse (pulls in pdfjs-dist) and mammoth are heavy Node libs that some
// serverless bundlers mishandle at MODULE LOAD — a static top-level import of one
// can crash the whole route, taking the other file types down with it (that's why
// "neither PDF nor Word imports"). So we LAZY-import each, per file type, INSIDE the
// try below: a load failure then surfaces as a clean per-file parse error (422)
// instead of a dead route, and Word never depends on the PDF lib loading.

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
      // unpdf bundles a serverless-safe pdfjs build that extracts text WITHOUT the
      // DOM globals (DOMMatrix, etc.) the stock pdfjs reaches for — those don't
      // exist in a Node/Netlify function, so a content-rich PDF otherwise fails with
      // "DOMMatrix is not defined". (Plain text PDFs happened to skip that path,
      // which is why it looked fine in dev.)
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text: pdfText } = await extractText(pdf, { mergePages: true })
      text = Array.isArray(pdfText) ? pdfText.join('\n\n') : (pdfText ?? '')
    } else if (
      name.endsWith('.docx') ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      // Structured: convert to HTML (preserving headings/bold/italic/underline/
      // lists/alignment), then to markdown via the editor's bridge so the import
      // matches what the editor round-trips. (extractRawText would flatten all
      // formatting to bare text.)
      const mammothMod = await import('mammoth')
      const mammoth = mammothMod.default ?? mammothMod

      // Word stores paragraph alignment as a direct property (`w:jc`) that
      // mammoth's HTML writer drops, and underline as a run property it ignores
      // by default — so "centered", "right", and "underline" silently vanished on
      // import. mammoth can only emit a CSS *class* via a style map, never an
      // inline style, and it can't match on the alignment property itself. So we
      // relabel each aligned paragraph to a synthetic style name, map that name to
      // an `align-*` class, then rewrite the class to the inline `text-align`
      // style the editor bridge actually preserves (templateBody.ts alignedBlock).
      // Headings keep their semantic style so they still map to <h1>/<h2> (a
      // centered real-Heading loses its centering — rare, and it stays bold/large).
      const ALIGN_STYLE: Record<string, string> = {
        center: 'AlignCenter',
        end: 'AlignRight',
        right: 'AlignRight',
        both: 'AlignJustify',
        justify: 'AlignJustify',
      }
      // `mammoth.transforms` is a real runtime API but absent from the bundled
      // types, so reach it through a focused cast.
      type MammothParagraph = { alignment?: string; styleId?: string; styleName?: string }
      const paragraphTransform = (
        mammoth as unknown as {
          transforms: {
            paragraph: (fn: (p: MammothParagraph) => MammothParagraph) => (doc: unknown) => unknown
          }
        }
      ).transforms.paragraph
      const transformDocument = paragraphTransform((p: MammothParagraph) => {
        const aligned = p.alignment ? ALIGN_STYLE[p.alignment] : undefined
        if (!aligned) return p
        const isHeading = /heading/i.test(p.styleName ?? '') || /heading/i.test(p.styleId ?? '')
        return isHeading ? p : { ...p, styleId: aligned, styleName: aligned }
      })
      const styleMap = [
        "p[style-name='AlignCenter'] => p.align-center:fresh",
        "p[style-name='AlignRight'] => p.align-right:fresh",
        "p[style-name='AlignJustify'] => p.align-justify:fresh",
        // mammoth ignores underline by default (ambiguous with links); keep it.
        'u => u',
      ]
      const result = await mammoth.convertToHtml(
        { buffer },
        { transformDocument, styleMap, includeDefaultStyleMap: true },
      )
      const html = (result.value ?? '')
        .replace(/<p class="align-center">/g, '<p style="text-align:center">')
        .replace(/<p class="align-right">/g, '<p style="text-align:right">')
        .replace(/<p class="align-justify">/g, '<p style="text-align:justify">')
      text = htmlToMarkdown(html)
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
