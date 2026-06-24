'use client'

import { useCallback, useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// Per-matter time & expense ledgers. Two buttons — Add time / Add expense — each
// opening a small inline form, with running totals. Receipts upload inline (small
// files) and download on demand. All writes go through the MCP tools, which
// record time.logged / expense.recorded events on the matter timeline.

interface TimeEntry {
  eventId: string
  durationMinutes: number
  description: string
  workedDate: string | null
  recordedAt: string
}
interface ReceiptMeta {
  filename: string
  contentType: string
  sizeBytes: number
}
interface ExpenseEntry {
  eventId: string
  amount: string
  currency: string
  description: string
  incurredDate: string | null
  receipt: ReceiptMeta | null
  recordedAt: string
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

// Strip the `data:<type>;base64,` prefix from a FileReader data URL.
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export function TimeExpensePanel({
  matterEntityId,
  initialForm = null,
  onChange,
}: {
  matterEntityId: string
  // Open a form on mount (deep-linked from the matter's "Log time/expense" buttons).
  initialForm?: 'time' | 'expense' | null
  // Called after a successful log so the parent can refresh its billing ledgers.
  onChange?: () => void
}) {
  const [time, setTime] = useState<{ entries: TimeEntry[]; totalMinutes: number } | null>(null)
  const [expenses, setExpenses] = useState<{
    entries: ExpenseEntry[]
    total: string
    currency: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<'time' | 'expense' | null>(initialForm)
  const [busy, setBusy] = useState(false)

  // Time form fields.
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [timeDesc, setTimeDesc] = useState('')

  // Expense form fields.
  const [amount, setAmount] = useState('')
  const [expDesc, setExpDesc] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        callAttorneyMcp<{ entries: TimeEntry[]; totalMinutes: number }>({
          toolName: 'legal.time.list',
          input: { matterEntityId },
        }),
        callAttorneyMcp<{ entries: ExpenseEntry[]; total: string; currency: string }>({
          toolName: 'legal.expense.list',
          input: { matterEntityId },
        }),
      ])
      setTime(t)
      setExpenses(e)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [matterEntityId])

  useEffect(() => {
    load()
  }, [load])

  function resetForms() {
    setForm(null)
    setHours('')
    setMinutes('')
    setTimeDesc('')
    setAmount('')
    setExpDesc('')
    setReceiptFile(null)
  }

  async function submitTime() {
    const durationMinutes =
      (parseInt(hours || '0', 10) || 0) * 60 + (parseInt(minutes || '0', 10) || 0)
    if (durationMinutes <= 0 || !timeDesc.trim()) {
      setError('Enter a duration and description.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.time.log',
        input: { matterEntityId, durationMinutes, description: timeDesc.trim() },
      })
      resetForms()
      await load()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitExpense() {
    if (!amount.trim() || !expDesc.trim()) {
      setError('Enter an amount and description.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let receipt: { filename: string; contentType: string; dataBase64: string } | undefined
      if (receiptFile) {
        receipt = {
          filename: receiptFile.name,
          contentType: receiptFile.type || 'application/octet-stream',
          dataBase64: await readFileAsBase64(receiptFile),
        }
      }
      await callAttorneyMcp({
        toolName: 'legal.expense.record',
        input: { matterEntityId, amount: amount.trim(), description: expDesc.trim(), receipt },
      })
      resetForms()
      await load()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function downloadReceipt(eventId: string) {
    try {
      const { receipt } = await callAttorneyMcp<{
        receipt: { filename: string; contentType: string; dataBase64: string } | null
      }>({ toolName: 'legal.expense.receipt', input: { matterEntityId, eventId } })
      if (!receipt) return
      const a = document.createElement('a')
      a.href = `data:${receipt.contentType};base64,${receipt.dataBase64}`
      a.download = receipt.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const fieldRow = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' as const }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <button
          className="primary"
          onClick={() => setForm(form === 'time' ? null : 'time')}
          disabled={busy}
        >
          Add time
        </button>
        <button
          className="primary"
          onClick={() => setForm(form === 'expense' ? null : 'expense')}
          disabled={busy}
        >
          Add expense
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {form === 'time' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          <div style={fieldRow}>
            <label>
              <div className="text-muted text-sm">Hours</div>
              <input
                type="number"
                min="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                style={{ width: 80 }}
              />
            </label>
            <label>
              <div className="text-muted text-sm">Minutes</div>
              <input
                type="number"
                min="0"
                max="59"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={{ width: 80 }}
              />
            </label>
          </div>
          <label>
            <div className="text-muted text-sm">Description</div>
            <textarea
              value={timeDesc}
              onChange={(e) => setTimeDesc(e.target.value)}
              rows={2}
              placeholder="e.g. Drafted operating agreement §4 (management)"
              style={{ width: '100%' }}
            />
          </label>
          <div>
            <button className="primary" onClick={() => void submitTime()} disabled={busy}>
              {busy ? 'Saving…' : 'Save time'}
            </button>
          </div>
        </div>
      )}

      {form === 'expense' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          <div style={fieldRow}>
            <label>
              <div className="text-muted text-sm">Amount (USD)</div>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="150.00"
                style={{ width: 120 }}
              />
            </label>
          </div>
          <label>
            <div className="text-muted text-sm">Description</div>
            <textarea
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              rows={2}
              placeholder="e.g. NC Secretary of State LLC filing fee"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <div className="text-muted text-sm">Receipt (optional, small file)</div>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div>
            <button className="primary" onClick={() => void submitExpense()} disabled={busy}>
              {busy ? 'Saving…' : 'Save expense'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Time</strong>
            <span className="text-muted text-sm">
              Total: {time ? formatDuration(time.totalMinutes) : '—'}
            </span>
          </div>
          {!time ? (
            <p className="text-muted text-sm">
              <span className="spinner" /> Loading…
            </p>
          ) : time.entries.length === 0 ? (
            <p className="text-muted text-sm">No time logged yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-2) 0 0' }}>
              {time.entries.map((t) => (
                <li
                  key={t.eventId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: 'var(--space-1) 0',
                  }}
                >
                  <span>
                    <strong>{formatDuration(t.durationMinutes)}</strong> — {t.description}
                  </span>
                  <span className="text-muted text-sm">
                    {formatDate(t.workedDate ?? t.recordedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Expenses</strong>
            <span className="text-muted text-sm">
              Total: {expenses ? `$${expenses.total}` : '—'}
            </span>
          </div>
          {!expenses ? (
            <p className="text-muted text-sm">
              <span className="spinner" /> Loading…
            </p>
          ) : expenses.entries.length === 0 ? (
            <p className="text-muted text-sm">No expenses yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-2) 0 0' }}>
              {expenses.entries.map((x) => (
                <li
                  key={x.eventId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: 'var(--space-1) 0',
                  }}
                >
                  <span>
                    <strong>${x.amount}</strong> — {x.description}
                    {x.receipt && (
                      <>
                        {' '}
                        <button
                          onClick={() => void downloadReceipt(x.eventId)}
                          title={`${x.receipt.filename} (${Math.round(x.receipt.sizeBytes / 1024)} KB)`}
                          style={{
                            fontSize: '0.85em',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--accent)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                          }}
                        >
                          receipt
                        </button>
                      </>
                    )}
                  </span>
                  <span className="text-muted text-sm">
                    {formatDate(x.incurredDate ?? x.recordedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
