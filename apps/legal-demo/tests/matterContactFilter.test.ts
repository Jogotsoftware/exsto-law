// ESIGN-UNIFY-1 (ES-1) — cross-filtered matter/contact picker rules (design
// §3, 15.5), tested against the pure filter module the MatterContactPicker
// renders from.
import { describe, expect, it } from 'vitest'
import {
  filterContacts,
  filterMatters,
  isSelectionConsistent,
  type ContactOption,
  type MatterOption,
} from '../components/esign/matterContactFilter'

const MATTERS: MatterOption[] = [
  { matterEntityId: 'm1', matterNumber: 'MAT-001', clientName: 'Ana López' },
  { matterEntityId: 'm2', matterNumber: 'MAT-002', clientName: 'Bo Chen' },
  { matterEntityId: 'm3', matterNumber: 'MAT-003', clientName: 'Ana López' },
]

const CONTACTS: ContactOption[] = [
  { contactEntityId: 'c1', fullName: 'Ana López', email: 'ana@example.com' },
  { contactEntityId: 'c2', fullName: 'Bo Chen', email: 'bo@example.com' },
  // Same display name, different person — the P0 wrong-contact hazard. The
  // filter must key on EMAIL, never the display name.
  { contactEntityId: 'c3', fullName: 'Ana López', email: 'ana.other@example.com' },
]

describe("rule (a): matter picked → contacts narrow to that matter's client", () => {
  it('narrows by the matter client EMAIL (not display name)', () => {
    const out = filterContacts(CONTACTS, 'm1', {
      contactMatterIds: null,
      matterClientEmail: 'ana@example.com',
    })
    expect(out.map((c) => c.contactEntityId)).toEqual(['c1'])
  })

  it('matches email case-insensitively', () => {
    const out = filterContacts(CONTACTS, 'm1', {
      contactMatterIds: null,
      matterClientEmail: 'ANA@Example.COM',
    })
    expect(out.map((c) => c.contactEntityId)).toEqual(['c1'])
  })

  it('keeps the full list while the link is unknown/loading (never an empty flash)', () => {
    const out = filterContacts(CONTACTS, 'm1', { contactMatterIds: null, matterClientEmail: null })
    expect(out).toHaveLength(3)
  })
})

describe("rule (b): contact picked → matters narrow to that contact's matters", () => {
  it('narrows by relationship ids', () => {
    const out = filterMatters(MATTERS, 'c1', {
      contactMatterIds: ['m1', 'm3'],
      matterClientEmail: null,
    })
    expect(out.map((m) => m.matterEntityId)).toEqual(['m1', 'm3'])
  })

  it('keeps the full list while the link is unknown/loading', () => {
    const out = filterMatters(MATTERS, 'c1', { contactMatterIds: null, matterClientEmail: null })
    expect(out).toHaveLength(3)
  })

  it('a contact with no matters narrows to an honest empty list', () => {
    const out = filterMatters(MATTERS, 'c9', { contactMatterIds: [], matterClientEmail: null })
    expect(out).toHaveLength(0)
  })
})

describe("rule (c): clearing one side restores the other's full list", () => {
  it('no selection = full lists, regardless of stale link data', () => {
    const links = { contactMatterIds: ['m1'], matterClientEmail: 'ana@example.com' }
    expect(filterMatters(MATTERS, null, links)).toHaveLength(3)
    expect(filterContacts(CONTACTS, null, links)).toHaveLength(3)
  })
})

describe("isSelectionConsistent — a narrowed list strands the other side's pick", () => {
  it('flags a selection that fell out of its narrowed options', () => {
    const narrowed = filterContacts(CONTACTS, 'm2', {
      contactMatterIds: null,
      matterClientEmail: 'bo@example.com',
    })
    expect(isSelectionConsistent('c1', narrowed, 'contactEntityId')).toBe(false)
    expect(isSelectionConsistent('c2', narrowed, 'contactEntityId')).toBe(true)
    expect(isSelectionConsistent(null, narrowed, 'contactEntityId')).toBe(true)
  })
})
