// Anchor-tag signature fields (Session 5). Attorneys place DocuSign-style fields
// in a document as text tags — {{type:signerKey}} — e.g. {{sign:client}},
// {{date:manager}}, {{title:member}}. At send time we parse them into typed
// fields bound to each signer; auto fields (name, date) auto-fill, the signer
// fills the rest; the executed copy replaces every tag with its resolved value.
//
// Tags fit the markdown model (no PDF coordinate system). A document with NO
// tags falls back to whole-document sign + appended certificate (the prior flow).

export type EsignFieldType = 'sign' | 'initial' | 'name' | 'date' | 'title' | 'text' | 'check'

export interface EsignField {
  /** Stable id by appearance order: f0, f1, … (the body is fixed once sent). */
  id: string
  type: EsignFieldType
  /** Which signer this field belongs to (matches a signer's `key`). */
  signerKey: string
  label: string
}

// The marker type vocabulary, as one regex-alternation string. Single-sourced here
// so the parser (below) and the execution-block builder/preview transform
// (executionBlock.ts) share ONE grammar and can never drift. Adding a new marker
// kind is a change to EsignFieldType + LABELS + this pattern, nowhere else.
export const MARKER_TYPE_PATTERN = 'sign|initial|name|date|title|text|check'

// {{ type : signerKey }} — whitespace tolerant; keys are [A-Za-z0-9_-].
const TAG_RE = new RegExp(
  `\\{\\{\\s*(${MARKER_TYPE_PATTERN})\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\}\\}`,
  'g',
)

const LABELS: Record<EsignFieldType, string> = {
  sign: 'Signature',
  initial: 'Initials',
  name: 'Printed name',
  date: 'Date',
  title: 'Title',
  text: 'Text',
  check: 'Checkbox',
}

// Auto fields are filled by the system (signer name / signing date); fillable
// fields are completed by the signer.
export const AUTO_FIELD_TYPES: EsignFieldType[] = ['name', 'date']
export const FILLABLE_FIELD_TYPES: EsignFieldType[] = ['sign', 'initial', 'title', 'text', 'check']

export function isAutoField(type: EsignFieldType): boolean {
  return AUTO_FIELD_TYPES.includes(type)
}

export function labelFor(type: EsignFieldType): string {
  return LABELS[type]
}

// Parse all field tags in appearance order. Ids (f0, f1, …) are positional, so
// they stay stable as long as the signed body is unchanged (it is — the sent
// version is what gets executed).
export function parseFields(markdown: string): EsignField[] {
  const out: EsignField[] = []
  let m: RegExpExecArray | null
  let i = 0
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(markdown)) !== null) {
    const type = m[1]!.toLowerCase() as EsignFieldType
    out.push({ id: `f${i}`, type, signerKey: m[2]!, label: LABELS[type] })
    i++
  }
  return out
}

export function hasFields(markdown: string): boolean {
  TAG_RE.lastIndex = 0
  return TAG_RE.test(markdown)
}

// Replace each tag, in appearance order, with its resolved value (keyed by the
// positional field id). A missing value renders blank.
export function resolveExecutedMarkdown(
  markdown: string,
  valuesByFieldId: Record<string, string>,
): string {
  let i = 0
  return markdown.replace(TAG_RE, () => {
    const id = `f${i}`
    i++
    return valuesByFieldId[id] ?? ''
  })
}

// How a typed signature renders in the executed markdown (a simple /s/ glyph).
export function renderTypedSignature(name: string): string {
  return `*/s/ ${name}*`
}

// A signature captured as an image (the attorney's standing drawn/uploaded
// signature, P15): a PNG or JPEG base64 data URL. Anything else stored in
// signature_data is treated as a typed name. Kept strict — one MIME of two,
// base64 payload only — because this same guard validates writes.
export const SIGNATURE_IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

export function isSignatureImageDataUrl(value: string): boolean {
  return SIGNATURE_IMAGE_DATA_URL_RE.test(value)
}

// How an image signature renders in the executed markdown: the image plus the
// typed /s/ glyph beside it. The glyph is not decorative — the display
// sanitizer (renderDocumentHtml) strips <img> tags entirely, so the glyph is
// what readers see there, while the image survives in the stored markdown for
// render pipelines that accept it.
export function renderImageSignature(dataUrl: string, name: string): string {
  const glyph = name.trim() ? ` ${renderTypedSignature(name)}` : ''
  return `![Signature](${dataUrl})${glyph}`
}
