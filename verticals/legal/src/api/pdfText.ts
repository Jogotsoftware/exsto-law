// Buffer→text extraction for the AI document-review worker, which reads
// uploaded PDFs from Storage as Buffers. pdf-parse pulls in a chunky stream of
// deps; load lazily to keep cold start down for tools that never touch PDFs.
// (The old importPdf.ts template importer this was carved from was removed as
// dead code in #289.)
export async function extractPdfText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  const mod = (await import('pdf-parse')) as unknown as {
    default?: (buf: Buffer) => Promise<{ text: string; numpages: number }>
  } & ((buf: Buffer) => Promise<{ text: string; numpages: number }>)
  const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
    mod.default ?? (mod as (buf: Buffer) => Promise<{ text: string; numpages: number }>)
  const parsed = await pdfParse(buf)
  return { text: (parsed.text ?? '').trim(), pageCount: parsed.numpages }
}
