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
      <p style={{ color: 'var(--muted)', marginTop: '-0.2rem' }}>
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
        <section style={{ borderLeft: '3px solid var(--border)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <strong>AI document review</strong>
            <span className={`badge ${enabled ? 'ok' : ''}`}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              className="primary"
              style={{ marginLeft: 'auto' }}
              onClick={save}
              disabled={busy || missingSlot}
            >
              {busy ? 'Saving…' : 'Save new version'}
            </button>
          </div>

          <label className="svc-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Automatically review documents uploaded during intake</span>
          </label>
          <label className="svc-check">
            <input
              type="checkbox"
              checked={redline}
              onChange={(e) => setRedline(e.target.checked)}
            />
            <span>Also produce a suggested redline (revised version) of the document</span>
          </label>

          <div style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
            <div
              style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: 'var(--space-1)' }}
            >
              Review prompt{' '}
              {customPrompt
                ? `— custom${promptVersion != null ? ` · v${promptVersion}` : ''}`
                : '— using the built-in default (type below to customize)'}
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: '0 0 var(--space-2)',
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--space-2)',
              }}
            >
              <li>
                <span
                  className={`badge ${!customPrompt || prompt.includes(REQUIRED_SLOT) ? 'ok' : 'danger'}`}
                  title="Required in a custom prompt — the document's extracted text"
                >
                  <code style={{ background: 'transparent', color: 'inherit' }}>
                    {REQUIRED_SLOT}
                  </code>{' '}
                  (required)
                </span>
              </li>
              {OPTIONAL_SLOTS.map((slot) => (
                <li key={slot}>
                  <span className="badge" title="Optional slot">
                    <code style={{ background: 'transparent', color: 'inherit' }}>{slot}</code>
                  </span>
                </li>
              ))}
            </ul>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setSaved(false)
              }}
              rows={16}
              spellCheck={false}
              style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem', width: '100%' }}
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
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <div
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--muted)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Always apply these skills (legal playbooks)
              </div>
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                }}
              >
                {skills.map((s) => (
                  <li key={s.slug}>
                    <button
                      type="button"
                      className={`badge ${skillSlugs.includes(s.slug) ? 'info' : ''}`}
                      style={{ cursor: 'pointer' }}
                      aria-pressed={skillSlugs.includes(s.slug)}
                      onClick={() => toggleSkill(s.slug)}
                    >
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {saved && (
            <div className="alert alert-success" style={{ marginTop: 'var(--space-2)' }}>
              Saved a new version.
            </div>
          )}
        </section>
      )}
    </>
  )
}
