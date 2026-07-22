'use client'

// ESIGN-UNIFY-1 ES-2 (§4/E6) — the palette vocabulary: one lucide-line icon +
// label per placement type, single-sourced so the palette chips, the canvas
// boxes, and the properties panel can never drift. Order = the §4 palette order
// (Signature first — the marquee chip).
import type { ReactNode } from 'react'
import type { PlacementFieldType } from '@exsto/legal/esign'
import {
  AtSignIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarCheckIcon,
  MapPinIcon,
  PhoneIcon,
  SignatureIcon,
  SquareCheckIcon,
  TextCursorInputIcon,
  TypeIcon,
  UserIcon,
} from '@/components/icons'

export interface PlacementGlyph {
  label: string
  icon: ReactNode
  /** The marquee signature chip gets the gold accent (§4). */
  marquee?: boolean
}

const GLYPHS: Record<PlacementFieldType, PlacementGlyph> = {
  sign: { label: 'Signature', icon: <SignatureIcon size={15} />, marquee: true },
  initial: { label: 'Initials', icon: <TypeIcon size={15} /> },
  date: { label: 'Date signed', icon: <CalendarCheckIcon size={15} /> },
  name: { label: 'Name', icon: <UserIcon size={15} /> },
  email: { label: 'Email', icon: <AtSignIcon size={15} /> },
  company: { label: 'Company', icon: <Building2Icon size={15} /> },
  title: { label: 'Title', icon: <BriefcaseIcon size={15} /> },
  phone: { label: 'Phone', icon: <PhoneIcon size={15} /> },
  address: { label: 'Address', icon: <MapPinIcon size={15} /> },
  text: { label: 'Text', icon: <TextCursorInputIcon size={15} /> },
  check: { label: 'Checkbox', icon: <SquareCheckIcon size={15} /> },
}

/** §4 palette order: Signature, Initials, Date signed, Name, Email, Company,
 *  Title, Phone, Address, Text, Checkbox. */
export const PALETTE_ORDER: readonly PlacementFieldType[] = [
  'sign',
  'initial',
  'date',
  'name',
  'email',
  'company',
  'title',
  'phone',
  'address',
  'text',
  'check',
]

export function placementGlyph(type: PlacementFieldType): PlacementGlyph {
  return GLYPHS[type]
}

/** The HTML5 DnD payload type for palette-chip → canvas drops. */
export const FIELD_DRAG_MIME = 'application/x-esign-field'

// ESIGN-GUIDED-1 — the floating DocuSign-style tab copy pointing at the
// guided walk's current field (FieldBox, readOnly + selected + interactive).
const GUIDED_ACTION_LABELS: Record<PlacementFieldType, string> = {
  sign: 'Sign here',
  initial: 'Initial here',
  date: 'Date signed',
  name: 'Name',
  email: 'Click to fill',
  company: 'Click to fill',
  title: 'Click to fill',
  phone: 'Click to fill',
  address: 'Click to fill',
  text: 'Click to fill',
  check: 'Click to check',
}

export function guidedActionLabel(type: PlacementFieldType): string {
  return GUIDED_ACTION_LABELS[type]
}
