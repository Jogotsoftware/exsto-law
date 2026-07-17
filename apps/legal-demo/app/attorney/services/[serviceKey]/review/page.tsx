'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// AI document review configuration (transitions.review). When enabled, every
// document a client uploads during this service's intake is auto-reviewed by
// the model: the memo lands in the review queue for the attorney to edit or
// approve, with an optional redline of the client's document. The prompt is
// config-first with a bundled default; a CUSTOM prompt must carry the one
// required slot (mirrors REQUIRED_REVIEW_SLOTS in the legal API).
const REQUIRED_SLOT = '{{document_text}}'
const OPTIONAL_SLOTS = [
  '{{intake_responses_json}}',
  '{{original_filename}}',
  '{{service_label}}',
] as const

interface ReviewConfig {
  enabled: boolean
  prompt: string | null
  promptVersion: number | null
  redline: boolean
  skillSlugs: string[]
}

interface SkillItem {
  slug: string
  name: string
}

export default function ReviewConfigPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [enabled, setEnabled] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [promptVersion, setPromptVersion] = useState<number | null>(null)
  const [redline, setRedline] = useState(false)
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ review: ReviewConfig }>({
        toolName: 'legal.service.review.get',
        input: { serviceKey },
      })
      setEnabled(r.review.enabled)
      setPrompt(r.review.prompt ?? '')
      setPromptVersion(r.review.promptVersion)
      setRedline(r.review.redline)
      setSkillSlugs(r.review.skillSlugs)
      setLoaded(true)
      // Skills are a nice-to-have picker — a failure must not block the page.
      try {
        const s = await callAttorneyMcp<{ skills: SkillItem[] }>({
          toolName: 'legal.skill.list',
          input: {},
        })
        setSkills(s.skills ?? [])
      } catch {
        setSkills([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  const customPrompt = prompt.trim().length > 0
  const missingSlot = customPrompt && !prompt.includes(REQUIRED_SLOT)

  async function save() {
    if (missingSlot) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const r = await callAttorneyMcp<{ review: ReviewConfig }>({
        toolName: 'legal.service.review.update',
        input: {
          serviceKey,
          enabled,
          prompt: customPrompt ? prompt : null,
          redline,
          skillSlugs,
        },
      })
      setPromptVersion(r.review.promptVersion)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggleSkill(slug: string) {
    setSkillSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    )
  }

  return (
    <>
      <p className="li-svc-hint">
        When enabled, every document a client uploads during this service&rsquo;s intake is
        automatically reviewed by the AI: a review memo lands in your review queue to edit or
        approve, optionally with a suggested redline of the client&rsquo;s document. Saving creates
        a new immutable service version.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {!loaded ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <section className="li-svc-panel li-svc-panel--accent">
          <div className="li-svc-tplcard-head">
            <strong>AI document review</strong>
            <span className={`li-svc-toggle-status${enabled ? ' on' : ''}`}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              className="li-svc-btn-primary"
              style={{ marginLeft: 'auto' }}
              onClick={save}
              disabled={busy || missingSlot}
            >
              {busy ? 'Saving…' : 'Save new version'}
            </button>
          </div>

          <label className="li-svc-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Automatically review documents uploaded during intake</span>
          </label>
          <label className="li-svc-check" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={redline}
              onChange={(e) => setRedline(e.target.checked)}
            />
            <span>Also produce a suggested redline (revised version) of the document</span>
          </label>

          <div>
            <div className="li-svc-label-row">
              Review prompt{' '}
              {customPrompt
                ? `— custom${promptVersion != null ? ` · v${promptVersion}` : ''}`
                : '— using the built-in default (type below to customize)'}
            </div>
            <div className="li-svc-chips" style={{ marginBottom: 12 }}>
              <span
                className={`li-svc-chip${!customPrompt || prompt.includes(REQUIRED_SLOT) ? ' ok' : ''}`}
                title="Required in a custom prompt — the document's extracted text"
              >
                <code>{REQUIRED_SLOT}</code> required
              </span>
              {OPTIONAL_SLOTS.map((slot) => (
                <span key={slot} className="li-svc-chip" title="Optional slot">
                  <code>{slot}</code>
                </span>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setSaved(false)
              }}
              rows={7}
              spellCheck={false}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '12.5px',
                lineHeight: 1.6,
              }}
              placeholder={`Leave empty to use the built-in review prompt.\nA custom prompt must include ${REQUIRED_SLOT}.`}
            />
            {missingSlot && (
              <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
                A custom prompt must include {REQUIRED_SLOT} — without it the model never sees the
                client&rsquo;s document. Clear the text to fall back to the built-in prompt.
              </div>
            )}
          </div>

          {skills.length > 0 && (
            <div>
              <div className="li-svc-label-row" style={{ margin: '14px 0 8px' }}>
                Always apply these skills (legal playbooks)
              </div>
              <div className="li-svc-chips">
                {skills.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    className={`li-svc-chip skill${skillSlugs.includes(s.slug) ? '' : ' off'}`}
                    aria-pressed={skillSlugs.includes(s.slug)}
                    onClick={() => toggleSkill(s.slug)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {saved && <div className="alert alert-success">Saved a new version.</div>}
        </section>
      )}
    </>
  )
}
