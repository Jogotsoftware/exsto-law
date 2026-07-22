// Anchor-tag signature fields (Session 5). Attorneys place DocuSign-style fields
// in a document as text tags — {{type:signerKey}} — e.g. {{sign:client}},
// {{date:manager}}, {{title:member}}. At send time we parse them into typed
// fields bound to each signer; auto fields (name, date) auto-fill, the signer
// fills the rest; the executed copy replaces every tag with its resolved value.
//
// Tags fit the markdown model (no PDF coordinate system). A document with NO
// tags falls back to whole-document sign + appended certificate (the prior flow).

// ESIGN-UNIFY-1 ES-2 (§5.1) — the marker grammar gains four DATA-BOUND kinds
// (email/company/phone/address). They resolve at SEND time from the bound
// contact/matter (esign/placementData.ts), degrading to signer-fillable when
// unresolvable — never an invented value, never a FIRM_DEFAULTS value. Single-
// sourced here so the parser, LABELS, the execution-block builder/preview and the
// react-pdf renderer share ONE grammar and can never drift (fields.ts is the one
// place a marker kind is added — see MARKER_TYPE_PATTERN below).
export type EsignFieldType =
  | 'sign'
  | 'initial'
  | 'name'
  | 'date'
  | 'title'
  | 'text'
  | 'check'
  | 'email'
  | 'company'
  | 'phone'
  | 'address'

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
export const MARKER_TYPE_PATTERN =
  'sign|initial|name|date|title|text|check|email|company|phone|address'

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
  email: 'Email',
  company: 'Company',
  phone: 'Phone',
  address: 'Address',
}

// Auto fields are filled by the system (signer name / signing date); fillable
// fields are completed by the signer. The data-bound kinds (email/company/phone/
// address) resolve at send time from the bound contact/matter (§5.3) but fall
// back to signer-fillable, so they sit in FILLABLE for the whole-line markdown
// path — the placement path (placementData.ts) does the auto-resolution.
export const AUTO_FIELD_TYPES: EsignFieldType[] = ['name', 'date']
export const FILLABLE_FIELD_TYPES: EsignFieldType[] = [
  'sign',
  'initial',
  'title',
  'text',
  'check',
  'email',
  'company',
  'phone',
  'address',
]

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

// ─────────────────────────────────────────────────────────────────────────
// ESIGN-UNIFY-1 ES-3 (§6.1/§6.2) — whole-line marker detection, for the
// template editor bridge (apps/legal-demo/lib/templateBody.ts): a template
// body line that is ENTIRELY one `{{type:key}}` tag (with an optional
// "Label: " prefix) hydrates as a ruled SignatureLine node instead of raw
// marker text (15.16b — attorneys never see the marker literally). Same
// anchor rule as executionBlock.ts's MARKER_LINE_RE, but this one CAPTURES
// the signer key too (that file only needs the caption label).
// ─────────────────────────────────────────────────────────────────────────
const WHOLE_MARKER_LINE_RE = new RegExp(
  `^\\s*(?:([^{}<>\\n:][^{}<>\\n]*?)\\s*:\\s*)?\\{\\{\\s*(${MARKER_TYPE_PATTERN})\\s*:\\s*([A-Za-z0-9_-]+)\\s*\\}\\}\\s*$`,
)

export interface MarkerLine {
  type: EsignFieldType
  signerKey: string
  /** The caption to show on the ruled line — the prefix if given, else the type's default label. */
  label: string
}

// Classify one physical line as a whole marker line, or null (an ordinary line
// — including an INLINE marker mid-sentence, which is deliberately left as
// prose; see MARKER_LINE_RE's header comment in executionBlock.ts).
export function parseMarkerLine(line: string): MarkerLine | null {
  const m = WHOLE_MARKER_LINE_RE.exec(line)
  if (!m) return null
  const type = m[2] as EsignFieldType
  return { type, signerKey: m[3]!, label: m[1]?.trim() || LABELS[type] }
}

// ─────────────────────────────────────────────────────────────────────────
// Marker ↔ role drift (§6.2 editor warning, §6.3 AI-proposal validation). Given
// a template body and the config's roles, report:
//   • markerKeysWithoutRole — a signer key some marker in the body references
//     that no role row declares (an orphan marker: nothing will ever resolve
//     who that key belongs to at send time).
//   • rolesWithoutSignMarker — a `needs_to_sign` role with no {{sign:key}}
//     marker anywhere in the body (nothing for that signer to actually sign).
// Pure — no DB — so it runs identically in the editor (live, client-side) and
// the AI-proposal validator (server-side gate before persisting).
// ─────────────────────────────────────────────────────────────────────────
export interface EsignRoleKeyLike {
  key: string
  recipientRole?: string
}

export interface EsignMarkerRoleDrift {
  markerKeysWithoutRole: string[]
  rolesWithoutSignMarker: string[]
}

export function computeMarkerRoleDrift(
  body: string,
  roles: readonly EsignRoleKeyLike[],
): EsignMarkerRoleDrift {
  const fields = parseFields(body ?? '')
  const markerKeys = new Set(fields.map((f) => f.signerKey))
  const signMarkerKeys = new Set(fields.filter((f) => f.type === 'sign').map((f) => f.signerKey))
  const roleKeys = new Set(roles.map((r) => r.key))
  const markerKeysWithoutRole = [...markerKeys].filter((k) => !roleKeys.has(k)).sort()
  const rolesWithoutSignMarker = roles
    .filter((r) => (r.recipientRole ?? 'needs_to_sign') === 'needs_to_sign')
    .filter((r) => !signMarkerKeys.has(r.key))
    .map((r) => r.key)
  return { markerKeysWithoutRole, rolesWithoutSignMarker }
}

// ─────────────────────────────────────────────────────────────────────────
// ESIGN-FIELDS-1 — signable-document email coverage (§ warn + one-click). Every
// recipient role is DELIVERED an email (to sign, to view, or to receive the
// executed copy), so each signable role needs a deliverable email source. A CRM
// bind (matter_primary_contact / attorney_of_record / contact_role:*) supplies
// one; a `manual` role only gets an email when the attorney types it at send
// time — fine as a fallback, but a signable TEMPLATE should declare the SOURCE
// (an intake merge field) so generation never produces an unreachable signer.
// This flags `manual` roles with no email field bound. Pure/config-only (no
// body, no DB) and defined in this client-safe module so the editor panel and
// any server-side validator share ONE helper. The input is the structural shape
// of a TemplateEsignRole (kept local so this module has no queries dependency).
// ─────────────────────────────────────────────────────────────────────────
export interface EsignRoleEmailCoverageLike {
  key: string
  label?: string
  bind: string
  fields?: { email?: string }
}

export interface EsignRoleEmailGap {
  key: string
  label: string
}

export function computeSignerEmailGaps(
  roles: readonly EsignRoleEmailCoverageLike[],
): EsignRoleEmailGap[] {
  return roles
    .filter((r) => r.bind === 'manual' && !r.fields?.email)
    .map((r) => ({ key: r.key, label: r.label || r.key }))
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
