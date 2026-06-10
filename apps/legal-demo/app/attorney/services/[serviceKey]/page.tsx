'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

interface Field {
  id: string
  label: string
  type: string
  required?: boolean
  options?: string[]
}
interface Section {
  id: string
  title: string
  fields: Field[]
}
interface IntakeSchema {
  sections: Section[]
}
interface LinkedTemplate {
  templateId: string
  templateKey: string
  displayName: string
  sortOrder: number
  autopopulate: boolean
}
interface Service {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  intakeSchema: IntakeSchema
  isActive: boolean
  feeModel: 'fixed' | 'hourly' | null
  flatFeeUsd: number | null
  hourlyRateUsd: number | null
  estimatedHours: number | null
  defaultReferralPartnerId: string | null
  linkedTemplates: LinkedTemplate[]
}
interface TemplateSummary {
  templateKey: string
  displayName: string
}
interface PartnerSummary {
  partnerEntityId: string
  fullName: string
  firm: string | null
  specialty: string | null
}

const FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'number',
  'date',
  'members_repeater',
  'address_autocomplete',
]

export default function EditServicePage({ params }: { params: Promise<{ serviceKey: string }> }) {
  const { serviceKey } = use(params)
  const router = useRouter()
  const [service, setService] = useState<Service | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [schema, setSchema] = useState<IntakeSchema>({ sections: [] })

  const [feeModel, setFeeModel] = useState<'none' | 'fixed' | 'hourly'>('none')
  const [flatFee, setFlatFee] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [referralPartnerId, setReferralPartnerId] = useState<string>('')

  const [allTemplates, setAllTemplates] = useState<TemplateSummary[]>([])
  const [partners, setPartners] = useState<PartnerSummary[]>([])

  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const refresh = useCallback(() => {
    return callAttorneyMcp<{ service: Service | null }>({
      toolName: 'legal.service.get',
      input: { serviceKey },
    })
      .then((r) => {
        if (!r.service) {
          setError('Service not found')
          return
        }
        setService(r.service)
        setDisplayName(r.service.displayName)
        setDescription(r.service.description ?? '')
        setSchema(r.service.intakeSchema)
        setFeeModel(r.service.feeModel ?? 'none')
        setFlatFee(r.service.flatFeeUsd != null ? String(r.service.flatFeeUsd) : '')
        setHourlyRate(r.service.hourlyRateUsd != null ? String(r.service.hourlyRateUsd) : '')
        setEstimatedHours(r.service.estimatedHours != null ? String(r.service.estimatedHours) : '')
        setReferralPartnerId(r.service.defaultReferralPartnerId ?? '')
      })
      .catch((e) => setError(e.message))
  }, [serviceKey])

  useEffect(() => {
    refresh()
    callAttorneyMcp<{ templates: TemplateSummary[] }>({ toolName: 'legal.template.list' })
      .then((r) => setAllTemplates(r.templates))
      .catch(() => {})
    callAttorneyMcp<{ partners: PartnerSummary[] }>({ toolName: 'legal.referralPartner.list' })
      .then((r) => setPartners(r.partners))
      .catch(() => {})
  }, [refresh])

  const linkedTemplateKeys = useMemo(
    () => new Set((service?.linkedTemplates ?? []).map((t) => t.templateKey)),
    [service],
  )
  const availableTemplates = allTemplates.filter((t) => !linkedTemplateKeys.has(t.templateKey))

  function addSection() {
    setSchema({
      ...schema,
      sections: [
        ...schema.sections,
        { id: `section_${schema.sections.length + 1}`, title: 'New section', fields: [] },
      ],
    })
  }
  function updateSection(idx: number, patch: Partial<Section>) {
    setSchema({
      ...schema,
      sections: schema.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    })
  }
  function removeSection(idx: number) {
    setSchema({ ...schema, sections: schema.sections.filter((_, i) => i !== idx) })
  }
  function addField(secIdx: number) {
    updateSection(secIdx, {
      fields: [
        ...schema.sections[secIdx]!.fields,
        {
          id: `field_${schema.sections[secIdx]!.fields.length + 1}`,
          label: 'New field',
          type: 'text',
          required: false,
        },
      ],
    })
  }
  function updateField(secIdx: number, fIdx: number, patch: Partial<Field>) {
    updateSection(secIdx, {
      fields: schema.sections[secIdx]!.fields.map((f, i) => (i === fIdx ? { ...f, ...patch } : f)),
    })
  }
  function removeField(secIdx: number, fIdx: number) {
    updateSection(secIdx, {
      fields: schema.sections[secIdx]!.fields.filter((_, i) => i !== fIdx),
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(false)
    try {
      const parsedFlat = flatFee.trim() ? Number(flatFee) : null
      const parsedHourly = hourlyRate.trim() ? Number(hourlyRate) : null
      const parsedHours = estimatedHours.trim() ? Number(estimatedHours) : null
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: {
          serviceKey,
          displayName,
          description: description || null,
          intakeSchema: schema,
          feeModel: feeModel === 'none' ? null : feeModel,
          flatFeeUsd: feeModel === 'fixed' ? parsedFlat : null,
          hourlyRateUsd: feeModel === 'hourly' ? parsedHourly : null,
          estimatedHours: feeModel === 'hourly' ? parsedHours : null,
          defaultReferralPartnerId: referralPartnerId || null,
        },
      })
      await refresh()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function attachTemplate(templateKey: string) {
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.template.attach',
        input: { serviceKey, templateKey, autopopulate: true },
      })
      await refresh()
      setShowTemplatePicker(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function detachTemplate(templateKey: string) {
    try {
      await callAttorneyMcp({
        toolName: 'legal.service.template.detach',
        input: { serviceKey, templateKey },
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (error && !service)
    return (
      <main>
        <pre>{error}</pre>
      </main>
    )
  if (!service)
    return (
      <main>
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )

  return (
    <main>
      <p style={{ fontSize: '0.88rem' }}>
        <Link href="/attorney/services">← All services</Link>
      </p>
      <div className="attorney-page-head">
        <h1>Edit: {service.displayName}</h1>
        <div className="head-actions">
          <button onClick={() => router.push('/attorney/services')}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && (
        <div
          className="alert"
          style={{ background: 'var(--ok-soft)', color: '#166534', border: '1px solid #86efac' }}
        >
          Saved.
        </div>
      )}

      <section>
        <h2>Basic information</h2>
        <label>
          <span>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          <span>Description (shown on the booking page)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </label>
      </section>

      <section>
        <h2>Pricing</h2>
        <div className="pricing-row">
          <label className="pricing-radio">
            <input
              type="radio"
              name="fee_model"
              checked={feeModel === 'none'}
              onChange={() => setFeeModel('none')}
            />
            <span>No pricing set</span>
          </label>
          <label className="pricing-radio">
            <input
              type="radio"
              name="fee_model"
              checked={feeModel === 'fixed'}
              onChange={() => setFeeModel('fixed')}
            />
            <span>Fixed fee</span>
          </label>
          <label className="pricing-radio">
            <input
              type="radio"
              name="fee_model"
              checked={feeModel === 'hourly'}
              onChange={() => setFeeModel('hourly')}
            />
            <span>Hourly</span>
          </label>
        </div>
        {feeModel === 'fixed' && (
          <label style={{ maxWidth: 220 }}>
            <span>Flat fee (USD)</span>
            <input
              type="number"
              inputMode="decimal"
              value={flatFee}
              onChange={(e) => setFlatFee(e.target.value)}
            />
          </label>
        )}
        {feeModel === 'hourly' && (
          <div className="form-grid" style={{ maxWidth: 460 }}>
            <label>
              <span>Hourly rate (USD)</span>
              <input
                type="number"
                inputMode="decimal"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
              />
            </label>
            <label>
              <span>Estimated hours (optional)</span>
              <input
                type="number"
                inputMode="decimal"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
            </label>
            {hourlyRate && estimatedHours && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', fontSize: '0.9rem' }}>
                Estimated total:{' '}
                <strong style={{ color: 'var(--fg)' }}>
                  $
                  {(Number(hourlyRate) * Number(estimatedHours)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.85rem' }}
        >
          <h2 style={{ margin: 0 }}>Templated documents</h2>
          <button
            onClick={() => setShowTemplatePicker(true)}
            style={{ marginLeft: 'auto' }}
            disabled={availableTemplates.length === 0}
          >
            + Add template
          </button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginTop: 0 }}>
          Linked templates are recorded on every matter created for this service so they're ready to
          generate.
        </p>
        {service.linkedTemplates.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No templates linked yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Key</th>
                <th>Auto-populate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {service.linkedTemplates.map((t) => (
                <tr key={t.templateKey}>
                  <td>
                    <strong>{t.displayName}</strong>
                  </td>
                  <td>
                    <code style={{ fontSize: '0.85rem' }}>{t.templateKey}</code>
                  </td>
                  <td>{t.autopopulate ? 'Yes' : 'No'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="danger"
                      onClick={() => detachTemplate(t.templateKey)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Refer out to</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginTop: 0 }}>
          Pick a referral partner when this service is one you refer out by default. Manage partners
          under{' '}
          <Link href="/attorney/contacts?tab=referral-partners">Contacts → Referral partners</Link>.
        </p>
        <label style={{ maxWidth: 460 }}>
          <span>Default referral partner</span>
          <select value={referralPartnerId} onChange={(e) => setReferralPartnerId(e.target.value)}>
            <option value="">— None —</option>
            {partners.map((p) => (
              <option key={p.partnerEntityId} value={p.partnerEntityId}>
                {p.fullName}
                {p.firm ? ` · ${p.firm}` : ''}
                {p.specialty ? ` (${p.specialty})` : ''}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.85rem' }}
        >
          <h2 style={{ margin: 0 }}>Intake form</h2>
          <button onClick={addSection} style={{ marginLeft: 'auto' }}>
            + Add section
          </button>
        </div>

        {schema.sections.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>
            No sections yet. Click <strong>Add section</strong> to start.
          </p>
        )}

        {schema.sections.map((section, sIdx) => (
          <div
            key={sIdx}
            style={{
              border: '1px solid var(--border-soft)',
              borderRadius: 10,
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
              <input
                value={section.title}
                onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                style={{ fontWeight: 600, fontSize: '1.05rem', flex: 1 }}
              />
              <button
                className="danger"
                onClick={() => removeSection(sIdx)}
                style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem' }}
              >
                Remove
              </button>
            </div>

            <div style={{ marginTop: '0.85rem' }}>
              {section.fields.map((f, fIdx) => (
                <div key={fIdx} className="field-row">
                  <input
                    value={f.label}
                    onChange={(e) => updateField(sIdx, fIdx, { label: e.target.value })}
                    placeholder="Field label"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => updateField(sIdx, fIdx, { type: e.target.value })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <div className="field-row-controls">
                    <label
                      style={{
                        margin: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={!!f.required}
                        onChange={(e) => updateField(sIdx, fIdx, { required: e.target.checked })}
                      />
                      <span style={{ marginBottom: 0 }}>Required</span>
                    </label>
                    <button
                      className="danger"
                      onClick={() => removeField(sIdx, fIdx)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      ×
                    </button>
                  </div>
                  {f.type === 'select' && (
                    <input
                      style={{ gridColumn: '1 / -1', marginTop: '0.4rem' }}
                      value={(f.options ?? []).join(', ')}
                      onChange={(e) =>
                        updateField(sIdx, fIdx, {
                          options: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Options (comma-separated)"
                    />
                  )}
                </div>
              ))}
              <button onClick={() => addField(sIdx)} style={{ marginTop: '0.55rem' }}>
                + Add field
              </button>
            </div>
          </div>
        ))}
      </section>

      {showTemplatePicker && (
        <div className="modal-backdrop" onClick={() => setShowTemplatePicker(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Add a template</h2>
              <button
                onClick={() => setShowTemplatePicker(false)}
                aria-label="Close"
                className="modal-close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {availableTemplates.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No more templates available.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {availableTemplates.map((t) => (
                    <button
                      key={t.templateKey}
                      onClick={() => attachTemplate(t.templateKey)}
                      style={{
                        textAlign: 'left',
                        padding: '0.7rem 0.9rem',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 8,
                        background: 'white',
                      }}
                    >
                      <strong>{t.displayName}</strong>
                      <div
                        style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.15rem' }}
                      >
                        {t.templateKey}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button onClick={() => setShowTemplatePicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
