// Buffer→text extraction for the AI document-review worker, which reads
// uploaded PDFs from Storage as Buffers. pdf-parse v2 exposes a `PDFParse`
// class (no callable default export); it pulls in a chunky stream of deps, so
// load it lazily to keep cold start down for tools that never touch PDFs.
// (The old importPdf.ts template importer this was carved from — which called
// the v1 functional API — was removed as dead code in #289, so nothing else in
// the repo exercises pdf-parse; this is the only call site.)
export async function extractPdfText(buf: Buffer): Promise<{ text: string; pageCount: number }> {
  const { PDFParse } = (await import('pdf-parse')) as {
    PDFParse: new (options: { data: Uint8Array }) => {
      getText(): Promise<{ text?: string; total?: number }>
    }
  }
  // A Node Buffer is a Uint8Array subclass, but hand pdf-parse a plain
  // Uint8Array view so it never mutates or retains the pooled Buffer memory.
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  const parsed = await parser.getText()
  return { text: (parsed.text ?? '').trim(), pageCount: parsed.total ?? 0 }
}
