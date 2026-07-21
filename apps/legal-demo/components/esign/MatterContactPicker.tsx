'use client'

// ESIGN-UNIFY-1 (ES-1, design §3) — the cross-filtered matter/contact pair
// picker (15.5), built ON the existing Combobox typeahead. Reusable anywhere a
// matter+contact pair is picked. The filter rules are pure
// (matterContactFilter.ts); this component owns the lazy link lookups:
//   • pick a matter  → legal.matter.get  → clientEmail narrows the contacts
//   • pick a contact → legal.contact.get → their matter ids narrow the matters
//   • clear either   → the other side's full list is restored
// Contact options always show the email beside the name (§9.1: disambiguates
// same-name contacts at pick time — the P0 wrong-contact hazard).
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { Combobox } from '@/components/Combobox'
import { XIcon } from '@/components/icons'
import {
  filterContacts,
  filterMatters,
  isSelectionConsistent,
  type ContactOption,
  type MatterOption,
} from './matterContactFilter'

export function MatterContactPicker({
  matters,
  contacts,
  matterId,
  contactId,
  onChange,
  disabled = false,
}: {
  matters: MatterOption[]
  contacts: ContactOption[]
  matterId: string | null
  contactId: string | null
  onChange: (next: { matterId: string | null; contactId: string | null }) => void
  disabled?: boolean
}) {
  const [contactMatterIds, setContactMatterIds] = useState<string[] | null>(null)
  const [matterClientEmail, setMatterClientEmail] = useState<string | null>(null)

  // Lazy link lookups per selection. Unknown (null) while in flight → the pure
  // filters return the FULL list, so the picker never flashes empty.
  useEffect(() => {
    if (!matterId) {
      setMatterClientEmail(null)
      return
    }
    let cancelled = false
    callAttorneyMcp<{ matter: { clientEmail: string | null } | null }>({
      toolName: 'legal.matter.get',
      input: { matterEntityId: matterId },
    })
      .then((r) => {
        if (!cancelled) setMatterClientEmail(r.matter?.clientEmail ?? null)
      })
      .catch(() => {
        if (!cancelled) setMatterClientEmail(null)
      })
    return () => {
      cancelled = true
    }
  }, [matterId])

  useEffect(() => {
    if (!contactId) {
      setContactMatterIds(null)
      return
    }
    let cancelled = false
    callAttorneyMcp<{ contact: { matters: Array<{ matterEntityId: string }> } | null }>({
      toolName: 'legal.contact.get',
      input: { contactEntityId: contactId },
    })
      .then((r) => {
        if (!cancelled) setContactMatterIds(r.contact?.matters.map((m) => m.matterEntityId) ?? null)
      })
      .catch(() => {
        if (!cancelled) setContactMatterIds(null)
      })
    return () => {
      cancelled = true
    }
  }, [contactId])

  const links = { contactMatterIds, matterClientEmail }
  const matterOptions = filterMatters(matters, contactId, links)
  const contactOptions = filterContacts(contacts, matterId, links)

  // A narrowing selection can strand the OTHER side's pick outside its list —
  // clear the stranded side rather than showing an inconsistent pair.
  useEffect(() => {
    if (!isSelectionConsistent(contactId, contactOptions, 'contactEntityId')) {
      onChange({ matterId, contactId: null })
    }
  }, [matterClientEmail])
  useEffect(() => {
    if (!isSelectionConsistent(matterId, matterOptions, 'matterEntityId')) {
      onChange({ matterId: null, contactId })
    }
  }, [contactMatterIds])

  return (
    <div className="li-esign2-attach-grid">
      <div className="li-esign2-attach-field">
        <span className="li-esign2-attach-label">Matter</span>
        <div className="li-esign2-attach-input">
          <Combobox
            options={matterOptions.map((m) => ({
              value: m.matterEntityId,
              label: m.matterNumber,
              hint: m.clientName,
            }))}
            value={matterId}
            onChange={(v) => onChange({ matterId: v, contactId })}
            placeholder="Search matters…"
            disabled={disabled}
            ariaLabel="Attach to matter"
          />
          {matterId && (
            <button
              type="button"
              className="li-esign2-attach-clear"
              aria-label="Clear matter"
              onClick={() => onChange({ matterId: null, contactId })}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="li-esign2-attach-field">
        <span className="li-esign2-attach-label">Contact</span>
        <div className="li-esign2-attach-input">
          <Combobox
            options={contactOptions.map((c) => ({
              value: c.contactEntityId,
              label: c.fullName || c.email,
              hint: c.email,
            }))}
            value={contactId}
            onChange={(v) => onChange({ matterId, contactId: v })}
            placeholder="Search contacts…"
            disabled={disabled}
            ariaLabel="Attach to contact"
          />
          {contactId && (
            <button
              type="button"
              className="li-esign2-attach-clear"
              aria-label="Clear contact"
              onClick={() => onChange({ matterId, contactId: null })}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
