'use client'

// Settings → Assistant (WP FB-B — "the firm can finally talk back"; WP FB-B2
// adds the portal's own instructions). Three independent instruction slots,
// each with its own save button (signature page's two-card pattern, not
// firm/page.tsx's single edit-toggle form — these are unrelated settings, not
// one record):
//   1. Firm instructions — firm-wide, INTERNAL, legal.settings.firm_profile.set
//      (assistantInstructions field, exactly the WP A1 firm_jurisdiction/
//      practice_areas/attorney_name pattern). Injected into every attorney's
//      chat AND the AI-drafted email prompt (that's where "always CC my
//      paralegal" has to bite). Never reaches the client portal.
//   2. My instructions — per-attorney, legal.assistant.settings_set (whole-
//      payload save, so the current settings are read first and only
//      customInstructions is overridden — never clobber modelId/workRate/
//      webSearch/research/contextDepth another surface set).
//   3. Client portal instructions — firm-wide, CLIENT-SAFE, same
//      legal.settings.firm_profile.set action but a SEPARATE field
//      (portalAssistantInstructions, migration 0178). This is the ONLY one of
//      the three the client-facing portal assistant ever reads — #1 and #2 are
//      internal-only by design (leak risk).
// ITEM-12 WP-2 — Joe: "the instructions for each chat need [to] save as pills
// when you put an instruction in and hit enter. this way they can easily be
// added or removed." All three are now TagInput pill editors instead of a
// single free-text textarea: each Enter-to-add pill is one standing
// instruction, capped at 500 chars/pill and 20 pills (INSTRUCTIONS_MAX_ITEMS
// below — the same caps the server enforces on the two firm-profile fields,
// see verticals/legal/src/handlers/firmProfile.ts normalizeInstructionsPills).
// assistantPrompt.ts's block builders render the pills as `- item` bullet
// lines and still clip the combined text at 2,000 chars defensively at
// injection time.
//
// WP FB-D adds a FOURTH, unrelated card: the email drafting prompt + house-
// voice doctrine, config-first (legal.email.prompt.get/update). Unlike the
// three instruction slots above these are FULL PROMPT TEMPLATES (still carry
// their {{mustache_slots}}), not short guidance strings — no char cap, and a
// custom prompt is rejected server-side if it drops a required slot.
import { useEffect, useState } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TagInput } from '@/components/TagInput'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

const INSTRUCTIONS_ITEM_CHAR_CAP = 500
const INSTRUCTIONS_MAX_ITEMS = 20

interface FirmProfile {
  assistantInstructions: string[] | null
  portalAssistantInstructions: string[] | null
}

// Mirrors verticals/legal/src/api/emailDraftingConfig.ts EmailDraftingConfigDoc.
interface EmailDraftingConfigDoc {
  promptText: string
  promptSource: 'config' | 'repo'
  houseVoiceText: string
  houseVoiceSource: 'config' | 'repo'
  promptVersion: number | null
  requiredSlots: readonly string[]
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
  // A settings row saved before ITEM-12 WP-2 still has this as a plain
  // string — toItems() below normalizes either shape into pills on load.
  customInstructions?: string | string[]
}

// ARRAY-OR-LEGACY-STRING, same convention as tenantSettings.ts'
// listOrTextVal: a pre-WP-2 customInstructions save is a bare string, which
// renders as a single pill rather than requiring a backfill.
function toItems(v: string | string[] | null | undefined): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.filter((s) => s.trim())
  const trimmed = v.trim()
  return trimmed ? [trimmed] : []
}

function ItemCount({ items }: { items: string[] }): React.ReactElement {
  const atMax = items.length >= INSTRUCTIONS_MAX_ITEMS
  return (
    <span className={atMax ? 'li-set-charcount li-set-charcount--limit' : 'li-set-charcount'}>
      {items.length} / {INSTRUCTIONS_MAX_ITEMS} instructions
    </span>
  )
}

// Mirrors REQUIRED_EMAIL_PROMPT_SLOTS in verticals/legal/src/api/
// emailDraftingConfig.ts — client-side check only, so a missing slot is caught
// before the round trip; the server validates again and is the source of truth.
const REQUIRED_EMAIL_PROMPT_SLOTS = [
  'SUBJECT:',
  '{{purpose}}',
  '{{recipient_role}}',
  '{{matter_facts_json}}',
  '{{client_context}}',
  '{{client_brief}}',
  '{{firm_instructions}}',
  '{{house_voice_doctrine}}',
] as const

function missingPromptSlots(text: string): string[] {
  return REQUIRED_EMAIL_PROMPT_SLOTS.filter((slot) => !text.includes(slot))
}

export default function AssistantSettingsPage(): React.ReactElement {
  const [firmProfile, setFirmProfile] = useState<FirmProfile | null>(null)
  const [firmDraft, setFirmDraft] = useState<string[]>([])
  const [firmBusy, setFirmBusy] = useState(false)
  const [firmSaved, setFirmSaved] = useState(false)
  const [firmError, setFirmError] = useState<string | null>(null)

  // WP FB-B2 — the portal's own draft/busy/saved/error state, independent of
  // firmDraft above (same firmProfile record, different field + save call).
  const [portalDraft, setPortalDraft] = useState<string[]>([])
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalSaved, setPortalSaved] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  const [attorneySettings, setAttorneySettings] = useState<AssistantSettings | null>(null)
  const [attorneyDraft, setAttorneyDraft] = useState<string[]>([])
  const [attorneyBusy, setAttorneyBusy] = useState(false)
  const [attorneySaved, setAttorneySaved] = useState(false)
  const [attorneyError, setAttorneyError] = useState<string | null>(null)

  // WP FB-D — email drafting prompt + house-voice doctrine. Two independent
  // textareas over the SAME config record (one save call per field, undefined
  // on the other so it is left untouched — the update tool's merge contract).
  const [emailConfig, setEmailConfig] = useState<EmailDraftingConfigDoc | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptSaved, setPromptSaved] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  const [voiceDraft, setVoiceDraft] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceSaved, setVoiceSaved] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  useEffect(() => {
    callAttorneyMcp<{ profile: FirmProfile }>({ toolName: 'legal.settings.firm_profile.get' })
      .then((r) => {
        setFirmProfile(r.profile)
        setFirmDraft(toItems(r.profile.assistantInstructions))
        setPortalDraft(toItems(r.profile.portalAssistantInstructions))
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setFirmError(msg)
        setPortalError(msg)
      })

    callAttorneyMcp<{ settings: AssistantSettings | null }>({
      toolName: 'legal.assistant.settings_get',
    })
      .then((r) => {
        setAttorneySettings(r.settings ?? {})
        setAttorneyDraft(toItems(r.settings?.customInstructions))
      })
      .catch((e) => setAttorneyError(e instanceof Error ? e.message : String(e)))

    callAttorneyMcp<{ config: EmailDraftingConfigDoc }>({ toolName: 'legal.email.prompt.get' })
      .then((r) => {
        setEmailConfig(r.config)
        setPromptDraft(r.config.promptText)
        setVoiceDraft(r.config.houseVoiceText)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setPromptError(msg)
        setVoiceError(msg)
      })
  }, [])

  async function saveFirm(): Promise<void> {
    setFirmBusy(true)
    setFirmError(null)
    try {
      const r = await callAttorneyMcp<{ profile: FirmProfile }>({
        toolName: 'legal.settings.firm_profile.set',
        input: { assistantInstructions: firmDraft },
      })
      setFirmProfile(r.profile)
      setFirmDraft(toItems(r.profile.assistantInstructions))
      setFirmSaved(true)
      setTimeout(() => setFirmSaved(false), 2000)
    } catch (e) {
      setFirmError(e instanceof Error ? e.message : String(e))
    } finally {
      setFirmBusy(false)
    }
  }

  async function savePortal(): Promise<void> {
    setPortalBusy(true)
    setPortalError(null)
    try {
      const r = await callAttorneyMcp<{ profile: FirmProfile }>({
        toolName: 'legal.settings.firm_profile.set',
        input: { portalAssistantInstructions: portalDraft },
      })
      setFirmProfile(r.profile)
      setPortalDraft(toItems(r.profile.portalAssistantInstructions))
      setPortalSaved(true)
      setTimeout(() => setPortalSaved(false), 2000)
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : String(e))
    } finally {
      setPortalBusy(false)
    }
  }

  async function saveAttorney(): Promise<void> {
    setAttorneyBusy(true)
    setAttorneyError(null)
    try {
      const nextSettings: AssistantSettings = {
        ...(attorneySettings ?? {}),
        customInstructions: attorneyDraft,
      }
      await callAttorneyMcp({
        toolName: 'legal.assistant.settings_set',
        input: { settings: nextSettings },
      })
      setAttorneySettings(nextSettings)
      setAttorneyDraft(toItems(nextSettings.customInstructions))
      setAttorneySaved(true)
      setTimeout(() => setAttorneySaved(false), 2000)
    } catch (e) {
      setAttorneyError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttorneyBusy(false)
    }
  }

  // WP FB-D — save/reset for the email prompt and the house-voice doctrine.
  // `promptText`/`houseVoiceText` undefined on the OTHER field each time so a
  // save of one never touches the other (legal.email.prompt.update's merge
  // contract); null explicitly clears back to the repo default.
  async function savePrompt(): Promise<void> {
    setPromptBusy(true)
    setPromptError(null)
    try {
      const r = await callAttorneyMcp<{ config: EmailDraftingConfigDoc }>({
        toolName: 'legal.email.prompt.update',
        input: { promptText: promptDraft },
      })
      setEmailConfig(r.config)
      setPromptDraft(r.config.promptText)
      setPromptSaved(true)
      setTimeout(() => setPromptSaved(false), 2000)
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : String(e))
    } finally {
      setPromptBusy(false)
    }
  }

  async function resetPrompt(): Promise<void> {
    setPromptBusy(true)
    setPromptError(null)
    try {
      const r = await callAttorneyMcp<{ config: EmailDraftingConfigDoc }>({
        toolName: 'legal.email.prompt.update',
        input: { promptText: null },
      })
      setEmailConfig(r.config)
      setPromptDraft(r.config.promptText)
      setPromptSaved(true)
      setTimeout(() => setPromptSaved(false), 2000)
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : String(e))
    } finally {
      setPromptBusy(false)
    }
  }

  async function saveVoice(): Promise<void> {
    setVoiceBusy(true)
    setVoiceError(null)
    try {
      const r = await callAttorneyMcp<{ config: EmailDraftingConfigDoc }>({
        toolName: 'legal.email.prompt.update',
        input: { houseVoiceText: voiceDraft },
      })
      setEmailConfig(r.config)
      setVoiceDraft(r.config.houseVoiceText)
      setVoiceSaved(true)
      setTimeout(() => setVoiceSaved(false), 2000)
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : String(e))
    } finally {
      setVoiceBusy(false)
    }
  }

  async function resetVoice(): Promise<void> {
    setVoiceBusy(true)
    setVoiceError(null)
    try {
      const r = await callAttorneyMcp<{ config: EmailDraftingConfigDoc }>({
        toolName: 'legal.email.prompt.update',
        input: { houseVoiceText: null },
      })
      setEmailConfig(r.config)
      setVoiceDraft(r.config.houseVoiceText)
      setVoiceSaved(true)
      setTimeout(() => setVoiceSaved(false), 2000)
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : String(e))
    } finally {
      setVoiceBusy(false)
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
            <TagInput
              values={firmDraft}
              onChange={(next) => {
                setFirmDraft(next)
                setFirmSaved(false)
              }}
              placeholder="e.g. Always CC my paralegal, paralegal@ourfirm.com, on client emails. Press Enter to add."
              maxItemChars={INSTRUCTIONS_ITEM_CHAR_CAP}
              maxItems={INSTRUCTIONS_MAX_ITEMS}
            />
            <ItemCount items={firmDraft} />
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveFirm}
                disabled={firmBusy}
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
            <TagInput
              values={attorneyDraft}
              onChange={(next) => {
                setAttorneyDraft(next)
                setAttorneySaved(false)
              }}
              placeholder="e.g. Keep drafts short. Flag anything touching immigration status for my review. Press Enter to add."
              maxItemChars={INSTRUCTIONS_ITEM_CHAR_CAP}
              maxItems={INSTRUCTIONS_MAX_ITEMS}
            />
            <ItemCount items={attorneyDraft} />
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveAttorney}
                disabled={attorneyBusy}
              >
                {attorneyBusy ? 'Saving…' : 'Save my instructions'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          Standing guidance for the CLIENT PORTAL assistant, firm-wide — this is what the assistant
          your clients chat with actually follows (e.g. &ldquo;mention our office closes at
          5pm&rdquo;). A SEPARATE, client-safe field from the firm instructions above: it is the
          ONLY one of the instructions on this page the portal ever reads, so anything written here
          may be read by clients — keep it to guidance you&apos;re comfortable showing them, never
          internal notes.
        </p>
        {portalError && <SettingsAlert tone="error">{portalError}</SettingsAlert>}
        {portalSaved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
        {!firmProfile ? (
          <SettingsLoading />
        ) : (
          <>
            <TagInput
              values={portalDraft}
              onChange={(next) => {
                setPortalDraft(next)
                setPortalSaved(false)
              }}
              placeholder="e.g. Mention our office closes at 5pm ET and reopens at 9am the next business day. Press Enter to add."
              maxItemChars={INSTRUCTIONS_ITEM_CHAR_CAP}
              maxItems={INSTRUCTIONS_MAX_ITEMS}
            />
            <ItemCount items={portalDraft} />
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={savePortal}
                disabled={portalBusy}
              >
                {portalBusy ? 'Saving…' : 'Save client portal instructions'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          The full prompt template the AI email drafter follows, and the house-voice doctrine it
          composes in. Firm-wide, config-first: leave either as the built-in default, or override it
          here. A custom prompt must keep every <code>{'{{slot}}'}</code> the drafter fills — saving
          is blocked until they are all present.
          {emailConfig && (
            <>
              {' '}
              Current version:{' '}
              {emailConfig.promptVersion != null ? `v${emailConfig.promptVersion}` : 'default'}.
            </>
          )}
        </p>

        {promptError && <SettingsAlert tone="error">{promptError}</SettingsAlert>}
        {promptSaved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
        {!emailConfig ? (
          <SettingsLoading />
        ) : (
          <>
            <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              Email prompt{' '}
              <span className="li-set-hint" style={{ fontWeight: 400 }}>
                ({emailConfig.promptSource === 'config' ? 'custom' : 'default'})
              </span>
            </div>
            <textarea
              className="li-set-textarea"
              rows={12}
              spellCheck={false}
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12.5,
              }}
              value={promptDraft}
              onChange={(e) => {
                setPromptDraft(e.target.value)
                setPromptSaved(false)
              }}
            />
            {missingPromptSlots(promptDraft).length > 0 && (
              <SettingsAlert tone="error">
                Missing required slot(s): {missingPromptSlots(promptDraft).join(', ')}. Saving is
                blocked until every slot is present.
              </SettingsAlert>
            )}
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={savePrompt}
                disabled={promptBusy || missingPromptSlots(promptDraft).length > 0}
              >
                {promptBusy ? 'Saving…' : 'Save prompt'}
              </button>
              {emailConfig.promptSource === 'config' && (
                <button className="li-set-btn" onClick={resetPrompt} disabled={promptBusy}>
                  Reset to default
                </button>
              )}
            </div>

            <div style={{ marginTop: 20, marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              House voice doctrine{' '}
              <span className="li-set-hint" style={{ fontWeight: 400 }}>
                ({emailConfig.houseVoiceSource === 'config' ? 'custom' : 'default'})
              </span>
            </div>
            <textarea
              className="li-set-textarea"
              rows={12}
              spellCheck={false}
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12.5,
              }}
              value={voiceDraft}
              onChange={(e) => {
                setVoiceDraft(e.target.value)
                setVoiceSaved(false)
              }}
            />
            {voiceError && <SettingsAlert tone="error">{voiceError}</SettingsAlert>}
            {voiceSaved && <SettingsAlert tone="success">Saved.</SettingsAlert>}
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveVoice}
                disabled={voiceBusy || !voiceDraft.trim()}
              >
                {voiceBusy ? 'Saving…' : 'Save house voice'}
              </button>
              {emailConfig.houseVoiceSource === 'config' && (
                <button className="li-set-btn" onClick={resetVoice} disabled={voiceBusy}>
                  Reset to default
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
