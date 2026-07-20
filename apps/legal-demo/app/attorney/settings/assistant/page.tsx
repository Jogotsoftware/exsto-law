'use client'

// Settings → Assistant (WP FB-B — "the firm can finally talk back"). Two
// independent free-text instruction slots, each with its own save button
// (signature page's two-card pattern, not firm/page.tsx's single edit-toggle
// form — these are two unrelated settings, not one record):
//   1. Firm instructions — firm-wide, legal.settings.firm_profile.set
//      (assistantInstructions field, exactly the WP A1 firm_jurisdiction/
//      practice_areas/attorney_name pattern). Injected into every attorney's
//      chat AND the AI-drafted email prompt (that's where "always CC my
//      paralegal" has to bite).
//   2. My instructions — per-attorney, legal.assistant.settings_set (whole-
//      payload save, so the current settings are read first and only
//      customInstructions is overridden — never clobber modelId/workRate/
//      webSearch/research/contextDepth another surface set).
// Both cap at 2,000 characters (assistantPrompt.ts clips defensively at
// injection time regardless). Neither reaches the client portal.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

const INSTRUCTIONS_CHAR_CAP = 2000

interface FirmProfile {
  assistantInstructions: string | null
}

// Mirrors verticals/legal/src/api/assistantSettings.ts AssistantSettings —
// kept loose (unknown extra keys pass through untouched) so a save here never
// drops a knob another settings surface (e.g. the chat widget) has set.
interface AssistantSettings {
  modelId?: string
  workRate?: 'quick' | 'balanced' | 'thorough'
  webSearch?: boolean
  research?: boolean
  contextDepth?: 'lean' | 'balanced' | 'generous'
  customInstructions?: string
}

function CharCount({ text }: { text: string }): React.ReactElement {
  const atCap = text.length >= INSTRUCTIONS_CHAR_CAP
  return (
    <span className={atCap ? 'li-set-charcount li-set-charcount--limit' : 'li-set-charcount'}>
      {text.length.toLocaleString()} / {INSTRUCTIONS_CHAR_CAP.toLocaleString()} characters
    </span>
  )
}

export default function AssistantSettingsPage(): React.ReactElement {
  const [firmProfile, setFirmProfile] = useState<FirmProfile | null>(null)
  const [firmDraft, setFirmDraft] = useState('')
  const [firmBusy, setFirmBusy] = useState(false)
  const [firmSaved, setFirmSaved] = useState(false)
  const [firmError, setFirmError] = useState<string | null>(null)

  const [attorneySettings, setAttorneySettings] = useState<AssistantSettings | null>(null)
  const [attorneyDraft, setAttorneyDraft] = useState('')
  const [attorneyBusy, setAttorneyBusy] = useState(false)
  const [attorneySaved, setAttorneySaved] = useState(false)
  const [attorneyError, setAttorneyError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ profile: FirmProfile }>({ toolName: 'legal.settings.firm_profile.get' })
      .then((r) => {
        setFirmProfile(r.profile)
        setFirmDraft(r.profile.assistantInstructions ?? '')
      })
      .catch((e) => setFirmError(e instanceof Error ? e.message : String(e)))

    callAttorneyMcp<{ settings: AssistantSettings | null }>({
      toolName: 'legal.assistant.settings_get',
    })
      .then((r) => {
        setAttorneySettings(r.settings ?? {})
        setAttorneyDraft(r.settings?.customInstructions ?? '')
      })
      .catch((e) => setAttorneyError(e instanceof Error ? e.message : String(e)))
  }, [])

  async function saveFirm(): Promise<void> {
    setFirmBusy(true)
    setFirmError(null)
    try {
      const r = await callAttorneyMcp<{ profile: FirmProfile }>({
        toolName: 'legal.settings.firm_profile.set',
        input: { assistantInstructions: firmDraft.trim() },
      })
      setFirmProfile(r.profile)
      setFirmDraft(r.profile.assistantInstructions ?? '')
      setFirmSaved(true)
      setTimeout(() => setFirmSaved(false), 2000)
    } catch (e) {
      setFirmError(e instanceof Error ? e.message : String(e))
    } finally {
      setFirmBusy(false)
    }
  }

  async function saveAttorney(): Promise<void> {
    setAttorneyBusy(true)
    setAttorneyError(null)
    try {
      const nextSettings: AssistantSettings = {
        ...(attorneySettings ?? {}),
        customInstructions: attorneyDraft.trim(),
      }
      await callAttorneyMcp({
        toolName: 'legal.assistant.settings_set',
        input: { settings: nextSettings },
      })
      setAttorneySettings(nextSettings)
      setAttorneyDraft(nextSettings.customInstructions ?? '')
      setAttorneySaved(true)
      setTimeout(() => setAttorneySaved(false), 2000)
    } catch (e) {
      setAttorneyError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttorneyBusy(false)
    }
  }

  return (
    <>
      <SettingsHeader title="Assistant" />

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          Standing guidance for the AI assistant, firm-wide — followed in every attorney's chat and
          in AI-drafted emails (e.g. &ldquo;always CC my paralegal&rdquo;). Never shown to clients.
        </p>
        {firmError && <SettingsAlert tone="error">{firmError}</SettingsAlert>}
        {firmSaved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
        {!firmProfile ? (
          <SettingsLoading />
        ) : (
          <>
            <textarea
              className="li-set-textarea"
              rows={5}
              maxLength={INSTRUCTIONS_CHAR_CAP}
              placeholder="e.g. Always CC my paralegal, paralegal@ourfirm.com, on client emails."
              value={firmDraft}
              onChange={(e) => {
                setFirmDraft(e.target.value)
                setFirmSaved(false)
              }}
            />
            <CharCount text={firmDraft} />
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveFirm}
                disabled={firmBusy || firmDraft.length > INSTRUCTIONS_CHAR_CAP}
              >
                {firmBusy ? 'Saving…' : 'Save firm instructions'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          Your own standing guidance for the assistant — applies only to your chat, on top of the
          firm&apos;s instructions above.
        </p>
        {attorneyError && <SettingsAlert tone="error">{attorneyError}</SettingsAlert>}
        {attorneySaved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
        {!attorneySettings ? (
          <SettingsLoading />
        ) : (
          <>
            <textarea
              className="li-set-textarea"
              rows={5}
              maxLength={INSTRUCTIONS_CHAR_CAP}
              placeholder="e.g. Keep drafts short. Flag anything touching immigration status for my review."
              value={attorneyDraft}
              onChange={(e) => {
                setAttorneyDraft(e.target.value)
                setAttorneySaved(false)
              }}
            />
            <CharCount text={attorneyDraft} />
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveAttorney}
                disabled={attorneyBusy || attorneyDraft.length > INSTRUCTIONS_CHAR_CAP}
              >
                {attorneyBusy ? 'Saving…' : 'Save my instructions'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
