'use client'

// Service editor › BILLING tab. Sets how this service is priced — a fixed fee, an
// hourly rate (with optional estimated hours), or no fee. The value lives on the
// service as transitions.cost and shows on the public booking page + service list.
// Saving writes a new immutable service version; everything else (generation,
// booking, documents, questionnaire) carries forward via the merge, so editing
// price here never disturbs the other tabs. Page chrome comes from the layout.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type CostType = '' | 'hourly' | 'fixed'
const MONEY_RE = /^\d+(\.\d{1,2})?$/

interface ServiceDefinition {
  serviceKey: string
  displayName: string
  description: string | null
  route: 'auto' | 'manual'
  documents: string[]
  sortOrder: number
  cost: { type: 'hourly' | 'fixed'; amount: string; hours: number | null } | null
  documentFees: Record<string, string>
}

export default function ServiceBillingPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [meta, setMeta] = useState<ServiceDefinition | null>(null)
  const [costType, setCostType] = useState<CostType>('')
  const [amount, setAmount] = useState('')
  const [hours, setHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ service: ServiceDefinition | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      })
      if (!r.service) {
        setError(`Service not found: ${serviceKey}`)
        return
      }
      setMeta(r.service)
      setCostType(r.service.cost?.type ?? '')
      setAmount(r.service.cost?.amount ?? '')
      setHours(r.service.cost?.hours != null ? String(r.service.cost.hours) : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  function edited<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v)
      setSaved(false)
    }
  }

  async function save() {
    if (!meta) return
    if (costType !== '' && !MONEY_RE.test(amount.trim())) {
      setError('Enter the amount like 350 or 350.00.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const cost =
        costType === ''
          ? null
          : {
              type: costType,
              amount: amount.trim(),
              hours: costType === 'hourly' && hours.trim() ? Number(hours) : null,
            }
      // Send identity fields from the loaded service so they're preserved; cost is
      // the only change. Generation/booking are omitted and carried forward by the
      // server-side transitions merge.
      await callAttorneyMcp({
        toolName: 'legal.service.update',
        input: {
          serviceKey,
          displayName: meta.displayName,
          description: meta.description,
          route: meta.route,
          documents: meta.documents,
          sortOrder: meta.sortOrder,
          cost,
        },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !meta) return <div className="alert alert-error">{error}</div>
  if (!meta)
    return (
      <div className="loading-block" role="status">
        <span className="spinner" /> Loading…
      </div>
    )

  return (
    <>
      <p className="li-svc-hint">
        What this service costs. Shown to clients on the booking page; a fixed fee bills once when
        the service is complete, an hourly rate bills through logged time.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved a new version.</div>}
      <div className="li-svc-panel">
        <fieldset className="li-svc-fieldset">
          <legend>Service fee</legend>
          <div className="li-svc-grid2">
            <label className="li-svc-field">
              <span>Fee</span>
              <select
                value={costType}
                onChange={(e) => edited(setCostType)(e.target.value as CostType)}
              >
                <option value="">No fee set</option>
                <option value="hourly">Hourly rate</option>
                <option value="fixed">Fixed fee</option>
              </select>
            </label>
            {costType !== '' && (
              <label className="li-svc-field">
                <span>{costType === 'hourly' ? 'Hourly rate (USD)' : 'Flat fee (USD)'}</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => edited(setAmount)(e.target.value)}
                  placeholder="350.00"
                />
              </label>
            )}
            {costType === 'hourly' && (
              <label className="li-svc-field">
                <span>Estimated hours (optional)</span>
                <input
                  inputMode="numeric"
                  value={hours}
                  onChange={(e) => edited(setHours)(e.target.value)}
                  placeholder="e.g. 3"
                />
              </label>
            )}
          </div>
        </fieldset>
        <div className="li-svc-actions" style={{ marginTop: 18 }}>
          <button className="li-svc-btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save new version'}
          </button>
        </div>
      </div>
    </>
  )
}
