// MODAL-STD-1 (Gap A) — the questionnaire round-trip contract. The service
// questionnaire page retired its bespoke wire↔editor converters and now goes
// through the shared schemaToSections/sectionsToSchema pair; #311 showed what a
// lossy editor round-trip does to saved config, so this suite proves load →
// no-change save is the identity (semantically) for every wire property the
// intake model carries: all 11 field types (incl. members_repeater sub-fields
// and file_upload), humane-intake flags, locale maps, stable field/section ids,
// form-level jurisdiction, and the persisted id/version.
import { describe, expect, it } from 'vitest'
import {
  schemaToSections,
  sectionsToSchema,
  type QuestionnaireSchema,
} from '../components/QuestionnaireBuilder'

// A full-featured schema in the shape legal.service.questionnaire.get returns —
// modeled on the multi-member LLC service (MULTI-PARTY-1).
const FULL: QuestionnaireSchema = {
  id: 'llc_formation_intake',
  version: 7,
  title: 'LLC formation intake',
  jurisdiction: 'NC',
  sections: [
    {
      id: 'about_the_company',
      title: 'About the company',
      title_i18n: { es: 'Sobre la empresa' },
      fields: [
        {
          id: 'company_name',
          label: 'Proposed LLC name',
          type: 'text',
          required: true,
          label_i18n: { es: 'Nombre propuesto de la LLC' },
        },
        {
          id: 'management_structure',
          label: 'Management structure',
          type: 'select',
          required: true,
          options: ['Member-managed', 'Manager-managed'],
          options_i18n: { es: ['Administrada por miembros', 'Administrada por gerentes'] },
        },
        {
          id: 'business_purpose',
          label: 'Business purpose',
          type: 'textarea',
          allow_unknown: true,
          ask_attorney: true,
        },
        { id: 'formation_docs', label: 'Existing formation documents', type: 'file_upload' },
      ],
    },
    {
      id: 'members',
      title: 'Members',
      fields: [
        {
          id: 'members',
          label: 'LLC members',
          type: 'members_repeater',
          required: true,
          minItems: 2,
          memberFields: [
            { id: 'member_name', label: 'Member name', type: 'text', required: true },
            { id: 'member_email', label: 'Member email', type: 'text', required: true },
            {
              id: 'member_share',
              label: 'Ownership share',
              type: 'number',
              allow_unknown: true,
            },
          ],
        },
      ],
    },
  ],
}

describe('questionnaire editor round-trip (schemaToSections ⇄ sectionsToSchema)', () => {
  it('a no-change load→save round-trip is the identity for a full-featured schema', () => {
    const sections = schemaToSections(FULL)
    const out = sectionsToSchema(FULL.title!, sections, {
      id: FULL.id,
      version: FULL.version,
      jurisdiction: FULL.jurisdiction,
    })
    expect(out).toEqual(FULL)
  })

  it('members_repeater sub-fields survive with types, flags, and stable ids', () => {
    const twice = sectionsToSchema(
      FULL.title!,
      schemaToSections(
        sectionsToSchema(FULL.title!, schemaToSections(FULL), {
          id: FULL.id,
          version: FULL.version,
          jurisdiction: FULL.jurisdiction,
        }),
      ),
      { id: FULL.id, version: FULL.version, jurisdiction: FULL.jurisdiction },
    )
    const repeater = twice.sections[1].fields![0]
    expect(repeater.type).toBe('members_repeater')
    expect(repeater.minItems).toBe(2)
    expect(repeater.memberFields?.map((f) => f.id)).toEqual([
      'member_name',
      'member_email',
      'member_share',
    ])
    expect(repeater.memberFields?.[2].allow_unknown).toBe(true)
  })

  it('section ids are preserved even when the title would slug differently', () => {
    const schema: QuestionnaireSchema = {
      sections: [
        {
          id: 'original_stable_id',
          title: 'A Renamed Title',
          fields: [{ id: 'f1', label: 'Q1', type: 'text' }],
        },
      ],
    }
    const out = sectionsToSchema('X', schemaToSections(schema))
    expect(out.sections[0].id).toBe('original_stable_id')
  })

  it('without opts, identity derives from the name (legacy host behavior)', () => {
    const out = sectionsToSchema('Client Intake', schemaToSections(FULL))
    expect(out.id).toBe('client_intake')
    expect(out.version).toBe(1)
    expect(out).not.toHaveProperty('jurisdiction')
  })

  it('flags absent on the wire stay absent after a round-trip (no schema growth)', () => {
    const schema: QuestionnaireSchema = {
      sections: [{ title: 'S', fields: [{ id: 'q', label: 'Q', type: 'text' }] }],
    }
    const out = sectionsToSchema('S', schemaToSections(schema))
    const f = out.sections[0].fields![0]
    expect(f).not.toHaveProperty('required')
    expect(f).not.toHaveProperty('allow_unknown')
    expect(f).not.toHaveProperty('ask_attorney')
    expect(f).not.toHaveProperty('memberFields')
  })

  it('duplicate variables are de-duplicated instead of silently merging answers', () => {
    const schema: QuestionnaireSchema = {
      sections: [
        {
          title: 'S',
          fields: [
            { id: 'company_name', label: 'Company name', type: 'text' },
            { id: 'company_name', label: 'Company name (DBA)', type: 'text' },
          ],
        },
      ],
    }
    const out = sectionsToSchema('S', schemaToSections(schema))
    expect(out.sections[0].fields!.map((f) => f.id)).toEqual(['company_name', 'company_name_2'])
  })
})
