import { extractVariables, markdownToHtml } from '../templates/bodyConversion.js'

export interface ImportPdfInput {
  pdfBase64: string
  filename?: string
}

export interface ImportPdfResult {
  displayName: string
  bodyMd: string
  bodyHtml: string
  detectedVariables: string[]
  pageCount: number
  characterCount: number
}

// The buffer→text core, shared with the AI document-review worker (which reads
// uploaded PDFs from Storage as Buffers, not base64). pdf-parse pulls in a
// chunky stream of deps; load lazily to keep cold start down for tools that
// never touch PDFs.
export async function extractPdfText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  const mod = (await import('pdf-parse')) as unknown as {
    default?: (buf: Buffer) => Promise<{ text: string; numpages: number }>
  } & ((buf: Buffer) => Promise<{ text: string; numpages: number }>)
  const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
    mod.default ?? (mod as (buf: Buffer) => Promise<{ text: string; numpages: number }>)
  const parsed = await pdfParse(buf)
  return { text: (parsed.text ?? '').trim(), pageCount: parsed.numpages }
}

export async function importPdfTemplate(input: ImportPdfInput): Promise<ImportPdfResult> {
  const buf = Buffer.from(input.pdfBase64, 'base64')
  const parsed = await extractPdfText(buf)
  const text = parsed.text

  const displayName = input.filename
    ? input.filename
        .replace(/\.[^/.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Imported template'
    : 'Imported template'

  const bodyMd = text
    .split(/\n{2,}/)
    .map((para) =>
      para
        .replace(/\s+\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n')

  const bodyHtml = markdownToHtml(bodyMd)
  const detectedVariables = extractVariables(bodyMd)

  return {
    displayName,
    bodyMd,
    bodyHtml,
    detectedVariables,
    pageCount: parsed.pageCount,
    characterCount: text.length,
  }
}
