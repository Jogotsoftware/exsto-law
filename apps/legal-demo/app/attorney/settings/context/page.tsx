'use client'

// Settings → AI Context (CONTEXT-SETTINGS-1).
//
// The problem this page fixes: the universal drafting rules ("never invent a
// value, leave the {{token}} in place", "never write draft banners into the
// document", "output the final document only") used to sit INSIDE each
// service's drafting prompt box, mixed into the same textarea meant for the
// attorney's own service-specific instructions — editable and deletable by
// accident, and impossible to tell apart from what was genuinely custom. They
// now live in the platform, are applied by composition server-side, and this
// page is where a firm sets its OWN defaults on top of them.
//
// Four cards, matching the assistant page's one-card-per-independent-setting
// pattern (not one big form — these are unrelated settings):
//   1. Document Generation — firm-wide standing instructions, pills.
//   2. Document Review — same, for AI review runs.
//   3. Firm context — the firm's persistent context file (markdown), the
//      tenant-level analogue of a project memory file.
//   4. My context — the same file at USER scope, for the signed-in attorney.
// Each capability card also shows the universal rules in force, read-only by
// default with an explicit override — visible, so nothing about what the model
// is told is hidden, but not sitting in an editable box by default.
//
// Chat and email instructions deliberately do NOT live here: they already have
// their own stores (Settings → Assistant, FB-B / FB-B2 / FB-D). This page links
// there rather than forking that data into a second place.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { TagInput } from '@/components/TagInput'
import { SettingsHeader, SettingsLoading, SettingsAlert } from '../shared'

const INSTRUCTIONS_ITEM_CHAR_CAP = 500
const INSTRUCTIONS_MAX_ITEMS = 20
const CONTEXT_MD_CHAR_CAP = 8000

// Mirrors verticals/legal/src/api/aiContextConfig.ts AiContextConfigDoc.
interface CapabilityContext {
  instructions: string[]
  baseGuidance: string | null
}
interface AiContextConfigDoc {
  documentGeneration: CapabilityContext
  documentReview: CapabilityContext
  firmContextMd: string | null
  version: number
  configured: boolean
}
interface AiContextResponse {
  config: AiContextConfigDoc
  effectiveBaseGuidance: { documentGeneration: string; documentReview: string }
}

// Mirrors api/assistantSettings.ts — kept loose so a save here never drops a
// knob another surface set (same reasoning as the Assistant page).
interface AssistantSettings {
  modelId?: string
  workRate?: string
  webSearch?: boolean
  research?: boolean
  contextDepth?: string
  customInstructions?: string | string[]
  contextMd?: string | null
}

type Capability = 'documentGeneration' | 'documentReview'

function CharCount({ text }: { text: string }): React.ReactElement {
  const over = text.length >= CONTEXT_MD_CHAR_CAP
  return (
    <span className={over ? 'li-set-charcount li-set-charcount--limit' : 'li-set-charcount'}>
      {text.length} / {CONTEXT_MD_CHAR_CAP} characters
    </span>
  )
}

export default function AiContextSettingsPage(): React.ReactElement {
  const [data, setData] = useState<AiContextResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [genDraft, setGenDraft] = useState<string[]>([])
  const [reviewDraft, setReviewDraft] = useState<string[]>([])
  const [firmMdDraft, setFirmMdDraft] = useState('')
  const [userMdDraft, setUserMdDraft] = useState('')

  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Which capability's universal-rules panel is expanded, and its edit buffer.
  const [openRules, setOpenRules] = useState<Capability | null>(null)
  const [rulesDraft, setRulesDraft] = useState('')

  function applyConfig(r: AiContextResponse): void {
    setData(r)
    setGenDraft(r.config.documentGeneration.instructions)
    setReviewDraft(r.config.documentReview.instructions)
    setFirmMdDraft(r.config.firmContextMd ?? '')
  }

  useEffect(() => {
    callAttorneyMcp<AiContextResponse>({ toolName: 'legal.firm.ai_context.get' })
      .then(applyConfig)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))

    callAttorneyMcp<{ settings: AssistantSettings | null }>({
      toolName: 'legal.assistant.settings_get',
    })
      .then((r) => {
        setSettings(r.settings ?? {})
        setUserMdDraft(r.settings?.contextMd ?? '')
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  function flashSaved(key: string): void {
    setSaved(key)
    setTimeout(() => setSaved((s) => (s === key ? null : s)), 2000)
  }

  async function saveConfig(key: string, input: Record<string, unknown>): Promise<void> {
    setBusy(key)
    setError(null)
    try {
      // The update tool returns only the config; re-read so the read-only
      // effective base guidance shown below stays in step with an override
      // that was just saved or cleared.
      await callAttorneyMcp({ toolName: 'legal.firm.ai_context.update', input })
      const fresh = await callAttorneyMcp<AiContextResponse>({
        toolName: 'legal.firm.ai_context.get',
      })
      applyConfig(fresh)
      flashSaved(key)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function saveUserContext(): Promise<void> {
    setBusy('myContext')
    setError(null)
    try {
      const next: AssistantSettings = { ...(settings ?? {}), contextMd: userMdDraft.trim() || null }
      await callAttorneyMcp({ toolName: 'legal.assistant.settings_set', input: { settings: next } })
      setSettings(next)
      flashSaved('myContext')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function capabilityCard(
    capability: Capability,
    title: string,
    hint: string,
    placeholder: string,
    draft: string[],
    setDraft: (v: string[]) => void,
    instructionsField: string,
    baseField: string,
  ): React.ReactElement {
    const section = data ? data.config[capability] : null
    const inForce = data
      ? capability === 'documentGeneration'
        ? data.effectiveBaseGuidance.documentGeneration
        : data.effectiveBaseGuidance.documentReview
      : ''
    const rulesOpen = openRules === capability
    const overridden = !!section?.baseGuidance
    return (
      <div className="li-set-card li-set-card--narrow">
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          {hint}
        </p>
        {!data ? (
          <SettingsLoading />
        ) : (
          <>
            <TagInput
              values={draft}
              onChange={setDraft}
              placeholder={placeholder}
              maxItemChars={INSTRUCTIONS_ITEM_CHAR_CAP}
              maxItems={INSTRUCTIONS_MAX_ITEMS}
            />
            <span className="li-set-charcount">
              {draft.length} / {INSTRUCTIONS_MAX_ITEMS} instructions
            </span>
            {saved === instructionsField && <SettingsAlert tone="success">Saved.</SettingsAlert>}
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={() => saveConfig(instructionsField, { [instructionsField]: draft })}
                disabled={busy === instructionsField}
              >
                {busy === instructionsField ? 'Saving…' : 'Save instructions'}
              </button>
            </div>

            <div style={{ marginTop: 18 }}>
              <button
                className="li-set-btn"
                onClick={() => {
                  setRulesDraft(inForce)
                  setOpenRules(rulesOpen ? null : capability)
                }}
              >
                {rulesOpen ? '▾' : '▸'} Universal rules{overridden ? ' (overridden)' : ''}
              </button>
              {rulesOpen && (
                <>
                  <p className="li-set-hint" style={{ margin: '10px 0 6px', fontSize: '12.5px' }}>
                    The platform rules applied to every run of this capability, ahead of your
                    instructions above. They are shown so nothing the model is told is hidden —
                    editing them is rarely needed, and clearing an override restores the built-in
                    rules.
                  </p>
                  <textarea
                    className="li-set-textarea"
                    rows={10}
                    spellCheck={false}
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12.5,
                    }}
                    value={rulesDraft}
                    onChange={(e) => setRulesDraft(e.target.value)}
                  />
                  {saved === baseField && <SettingsAlert tone="success">Saved.</SettingsAlert>}
                  <div className="li-set-actions-row">
                    <button
                      className="li-set-btn li-set-btn-primary"
                      onClick={() => saveConfig(baseField, { [baseField]: rulesDraft })}
                      disabled={busy === baseField || !rulesDraft.trim()}
                    >
                      {busy === baseField ? 'Saving…' : 'Save override'}
                    </button>
                    {overridden && (
                      <button
                        className="li-set-btn"
                        onClick={() => saveConfig(baseField, { [baseField]: null })}
                        disabled={busy === baseField}
                      >
                        Reset to built-in rules
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <SettingsHeader title="AI Context" />

      {error && <SettingsAlert tone="error">{error}</SettingsAlert>}

      <div className="li-set-card li-set-card--narrow">
        <p className="li-set-hint" style={{ margin: 0, fontSize: '13.5px' }}>
          What the AI knows and how it works, firm-wide. Instructions here apply to EVERY service —
          a rule that belongs to one service goes on that service instead. You can also just tell
          the assistant in chat (&ldquo;every document we generate should be professional and well
          formatted&rdquo;) and it will save it here and tell you which setting it wrote to. Chat
          and email guidance live on the <Link href="/attorney/settings/assistant">Assistant</Link>{' '}
          page.
          {data?.config.configured && data.config.version > 0
            ? ` Version ${data.config.version}.`
            : ''}
        </p>
      </div>

      {capabilityCard(
        'documentGeneration',
        'Document Generation',
        'Standing instructions for every document the AI drafts — the firm defaults a service can then add to.',
        'e.g. Every document must be professional and well formatted. Press Enter to add.',
        genDraft,
        setGenDraft,
        'documentGenerationInstructions',
        'documentGenerationBaseGuidance',
      )}

      {capabilityCard(
        'documentReview',
        'Document Review',
        'Standing instructions for every AI document review — what this firm always wants checked.',
        'e.g. Always flag any clause that shifts fees to our client. Press Enter to add.',
        reviewDraft,
        setReviewDraft,
        'documentReviewInstructions',
        'documentReviewBaseGuidance',
      )}

      <div className="li-set-card li-set-card--narrow">
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Firm context</h2>
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          Standing background about the firm, in your own words — the courts you file in, who does
          what, how you refer to yourselves. Read by every AI capability as FACT, never as licence
          to break the rules above. Markdown is fine.
        </p>
        {!data ? (
          <SettingsLoading />
        ) : (
          <>
            <textarea
              className="li-set-textarea"
              rows={10}
              maxLength={CONTEXT_MD_CHAR_CAP}
              value={firmMdDraft}
              onChange={(e) => setFirmMdDraft(e.target.value)}
              placeholder={
                'e.g. We file civil matters in Wake County District Court.\nOur paralegal Ana handles all intake scheduling.'
              }
            />
            <CharCount text={firmMdDraft} />
            {saved === 'firmContextMd' && <SettingsAlert tone="success">Saved.</SettingsAlert>}
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={() => saveConfig('firmContextMd', { firmContextMd: firmMdDraft })}
                disabled={busy === 'firmContextMd'}
              >
                {busy === 'firmContextMd' ? 'Saving…' : 'Save firm context'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="li-set-card li-set-card--narrow">
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>My context</h2>
        <p className="li-set-hint" style={{ margin: '0 0 16px', fontSize: '13.5px' }}>
          The same thing at your own scope — background about how you work, read only in your chat,
          on top of the firm context above. Nobody else at the firm sees it.
        </p>
        {!settings ? (
          <SettingsLoading />
        ) : (
          <>
            <textarea
              className="li-set-textarea"
              rows={8}
              maxLength={CONTEXT_MD_CHAR_CAP}
              value={userMdDraft}
              onChange={(e) => setUserMdDraft(e.target.value)}
              placeholder={'e.g. I handle the immigration matters; route anything else to Marisol.'}
            />
            <CharCount text={userMdDraft} />
            {saved === 'myContext' && <SettingsAlert tone="success">Saved.</SettingsAlert>}
            <div className="li-set-actions-row">
              <button
                className="li-set-btn li-set-btn-primary"
                onClick={saveUserContext}
                disabled={busy === 'myContext'}
              >
                {busy === 'myContext' ? 'Saving…' : 'Save my context'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
