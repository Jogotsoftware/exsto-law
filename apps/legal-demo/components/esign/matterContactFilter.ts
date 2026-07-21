// ESIGN-UNIFY-1 (ES-1, design §3) — pure cross-filter logic for the composer's
// "Attach to" matter/contact pair (15.5). Kept pure (no React, no fetch) so
// the rules are unit-testable and reusable anywhere a matter+contact pair is
// picked:
//
//   (a) matter picked   → contact options narrow to that matter's client
//                         (matched by the matter's client email — the identity
//                         rule the CRM dedupes on, NOT display-name matching,
//                         which is exactly the same-name hazard of the P0 walk).
//   (b) contact picked  → matter options narrow to that contact's matters
//                         (real matter⇄contact relationship ids from
//                         legal.contact.get, lazily resolved by the picker).
//   (c) clearing one restores the other's full list.
//
// Link data is lazily loaded per selection; while it is UNKNOWN (null) the
// full list is returned — the picker must never flash empty because a lookup
// is still in flight or a matter has no client on file.

export interface MatterOption {
  matterEntityId: string
  matterNumber: string
  clientName: string
}

export interface ContactOption {
  contactEntityId: string
  fullName: string
  email: string
}

export interface MatterContactLinks {
  /** Matter ids of the SELECTED contact (from legal.contact.get). Null = unknown. */
  contactMatterIds: string[] | null
  /** Client email of the SELECTED matter (from legal.matter.get). Null = unknown / none. */
  matterClientEmail: string | null
}

export function filterMatters(
  matters: MatterOption[],
  selectedContactId: string | null,
  links: MatterContactLinks,
): MatterOption[] {
  if (!selectedContactId) return matters
  if (links.contactMatterIds == null) return matters
  const ids = new Set(links.contactMatterIds)
  return matters.filter((m) => ids.has(m.matterEntityId))
}

export function filterContacts(
  contacts: ContactOption[],
  selectedMatterId: string | null,
  links: MatterContactLinks,
): ContactOption[] {
  if (!selectedMatterId) return contacts
  const email = links.matterClientEmail?.trim().toLowerCase()
  if (!email) return contacts
  return contacts.filter((c) => c.email?.trim().toLowerCase() === email)
}

// After a narrowing selection, a previously-picked value on the OTHER side may
// no longer be in its narrowed list — the picker clears it rather than keeping
// an inconsistent pair on screen.
export function isSelectionConsistent(
  selectedId: string | null,
  options: Array<{ [k: string]: unknown }>,
  idKey: string,
): boolean {
  if (!selectedId) return true
  return options.some((o) => o[idKey] === selectedId)
}
