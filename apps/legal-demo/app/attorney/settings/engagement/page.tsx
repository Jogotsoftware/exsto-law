'use client'

// Settings → Engagement Letters (ENGAGEMENT-TEMPLATES-1). The firm's library of
// engagement letters, each a fully-editable standalone template. One is the
// DEFAULT the portal gate shows every client; the rest are alternates the firm
// keeps for other situations (later selectable per client/matter/service — the
// gate always falls back to the default). Uploading a letter (PDF/Word) parses it
// into a merge template off the request (~1–2 min on the worker; we poll).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

interface EngagementLetter {
  templateId: string
  name: string
  isDefault: boolean
  updatedAt: string
}

export default function EngagementLettersPage(): React.ReactElement {
  const [letters, setLetters] = useState<EngagementLetter[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<'upload' | string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{ letters: EngagementLetter[] }>({
        toolName: 'legal.firm.engagement_letters.list',
      })
      setLetters(r.letters)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function onUpload(file: File): Promise<void> {
    setBusy('upload')
    setError(null)
    setDone(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const parsed = await fetch('/api/attorney/templates/import', { method: 'POST', body: form })
      const parsedJson = (await parsed.json()) as { text?: string; error?: string }
      if (!parsed.ok || !parsedJson.text) {
        throw new Error(parsedJson.error ?? 'Could not read the file.')
      }
      // The conversion is a full drafting-model pass (~80s on a multi-page
      // letter), so it runs OFF the request on the worker — enqueue and poll.
      const { requestId } = await callAttorneyMcp<{ requestId: string }>({
        toolName: 'legal.firm.import_engagement_agreement',
        input: { markdown: parsedJson.text, sourceFilename: file.name },
      })
      const outcome = await pollImportResult(requestId)
      if (outcome.status === 'failed') {
        throw new Error(outcome.error ?? 'The engagement letter could not be imported.')
      }
      const first = letters.length === 0
      await refresh()
      setDone(
        first
          ? 'Engagement letter added and set as your default — clients now sign it in the portal.'
          : 'Engagement letter added. Set it as your default to show it to clients.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Poll the worker outcome. The model pass can take 1–2 min; poll every 3s up to
  // 4 min, then surface a timeout the attorney can retry.
  async function pollImportResult(
    requestId: string,
  ): Promise<{ status: 'completed' | 'failed'; error?: string }> {
    const deadline = Date.now() + 4 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      const { result } = await callAttorneyMcp<{
        result: { status: 'completed' | 'failed'; error?: string } | null
      }>({
        toolName: 'legal.firm.import_engagement_agreement.result',
        input: { requestId },
      })
      if (result) return result
    }
    return { status: 'failed', error: 'Timed out converting the letter — please try again.' }
  }

  async function onSetDefault(letter: EngagementLetter): Promise<void> {
    setBusy(letter.templateId)
    setError(null)
    setDone(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.firm.engagement_letters.set_default',
        input: { templateId: letter.templateId },
      })
      await refresh()
      setDone(`"${letter.name}" is now the default clients sign.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function onRemove(letter: EngagementLetter): Promise<void> {
    if (!window.confirm(`Remove "${letter.name}"? Clients will no longer sign this letter.`)) return
    setBusy(letter.templateId)
    setError(null)
    setDone(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.firm.engagement_letters.remove',
        input: { templateId: letter.templateId },
      })
      await refresh()
      setDone('Engagement letter removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const defaultLetter = letters.find((l) => l.isDefault) ?? null
  const others = letters.filter((l) => !l.isDefault)

  function letterActions(l: EngagementLetter): React.ReactElement {
    return (
      <div className="li-set-eng-actions">
        <Link
          href={`/attorney/templates?template=${l.templateId}`}
          className="li-set-btn li-set-btn-sm"
        >
          Edit
        </Link>
        {!l.isDefault && (
          <button
            type="button"
            className="li-set-btn li-set-btn-sm"
            disabled={busy !== null}
            onClick={() => onSetDefault(l)}
          >
            {busy === l.templateId ? '…' : 'Set as default'}
          </button>
        )}
        <button
          type="button"
          className="li-set-btn li-set-btn-sm li-set-btn-danger"
          disabled={busy !== null}
          onClick={() => onRemove(l)}
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <>
      <SettingsHeader title="Engagement Letters" />
      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}
      {done && <SettingsAlert tone="success">{done}</SettingsAlert>}

      {!loaded ? (
        <SettingsLoading />
      ) : (
        <>
          <div className="li-set-card">
            <div className="li-set-eng-seclabel">Default agreement</div>
            {defaultLetter ? (
              <div className="li-set-eng-row li-set-eng-row--default">
                <div className="li-set-eng-name">
                  <span>{defaultLetter.name}</span>
                  <span className="li-set-eng-badge">Default</span>
                </div>
                {letterActions(defaultLetter)}
              </div>
            ) : (
              <p style={{ margin: '4px 0 0' }}>
                No default engagement letter yet. Upload your firm&apos;s engagement letter (PDF or
                Word) below — client details become merge fields, and every portal client signs the
                merged letter before messaging or booking unlocks.
              </p>
            )}
          </div>

          {others.length > 0 && (
            <div className="li-set-card" style={{ marginTop: 16 }}>
              <div className="li-set-eng-seclabel">Other letters</div>
              <p className="li-set-hint" style={{ margin: '0 0 10px' }}>
                Alternates for other situations. Set one as the default to show it to clients — or
                (soon) pick a letter per client or matter. The default always applies otherwise.
              </p>
              <ul className="li-set-eng-list">
                {others.map((l) => (
                  <li key={l.templateId} className="li-set-eng-row">
                    <div className="li-set-eng-name">
                      <span>{l.name}</span>
                    </div>
                    {letterActions(l)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <label className="li-set-btn li-set-btn-primary" style={{ cursor: 'pointer' }}>
              {busy === 'upload'
                ? 'Converting…'
                : letters.length === 0
                  ? 'Upload engagement letter'
                  : 'Upload another letter'}
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                style={{ display: 'none' }}
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) onUpload(f)
                }}
              />
            </label>
          </div>
          {busy === 'upload' && (
            <p className="li-set-hint" style={{ marginTop: 10 }}>
              Reading your letter and building the merge template — this can take a minute or two.
              You can leave this page; it keeps working.
            </p>
          )}
        </>
      )}
    </>
  )
}
