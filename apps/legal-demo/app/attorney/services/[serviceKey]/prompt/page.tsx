'use client'

// Per-service drafting instructions (CONTEXT-SETTINGS-1).
//
// This box used to hold the WHOLE prompt: the universal rules ("never invent a
// value, leave the {{token}} in place", "never write draft banners into the
// document", "output the final document only"), the three required mustache
// slots, and the reasoning-trace contract — all mixed in with whatever the
// attorney actually wanted to say about THIS service. It was impossible to see
// what was custom, and the platform rules could be reworded or deleted by
// accident.
//
// Now the box holds only the service-specific instruction. The universal rules,
// the firm's standing instructions from Settings → AI Context, the input slots
// and the output contracts are composed around it server-side at generation
// time (verticals/legal/src/api/services.ts composeDraftingBasePrompt).
//
// The Advanced panel keeps everything visible and nothing locked away: it
// previews the FULL assembled prompt the model actually receives, and still
// exposes raw full-prompt editing for a service that genuinely needs to control
// the whole template (legal.service.prompt.update — the legacy path). A service
// left in that mode says so, so a hand-tuned prompt is never silently ignored.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// The FIXED mustache-slot contract the drafting worker fills. Only the ADVANCED
// raw-prompt editor has to satisfy it now — a composed prompt gets the slots
// from the platform, which is the point of the split.
const REQUIRED_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
] as const

interface ServiceDefinition {
  serviceKey: string
  displayName: string
  documents: string[]
}

// Mirrors DraftingPromptDoc in verticals/legal/src/api/services.ts.
interface PromptDoc {
  serviceKey: string
  documentKind: string
  promptText: string | null
  source: 'composed' | 'config' | 'repo' | 'none'
  promptVersion: number | null
  requiredSlots: string[]
  instructionsText: string | null
  hasLegacyPromptOverride: boolean
}

interface KindState {
  documentKind: string
  doc: PromptDoc | null
  // The attorney's own instructions for this document (the editable layer).
  text: string
  // The Advanced raw-prompt buffer, only used in full-prompt mode.
  rawText: string
  advancedOpen: boolean
  busy: boolean
  saved: boolean
  error: string | null
}

function humanKind(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function missingSlots(text: string): string[] {
  return REQUIRED_SLOTS.filter((slot) => !text.includes(slot))
}

export default function PromptEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [service, setService] = useState<ServiceDefinition | null>(null)
  const [kinds, setKinds] = useState<KindState[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const svcRes = await callAttorneyMcp<{ service: ServiceDefinition | null }>({
        toolName: 'legal.service.get',
        input: { serviceKey },
      })
      if (!svcRes.service) {
        setError(`Service not found: ${serviceKey}`)
        return
      }
      setService(svcRes.service)

      const documents = svcRes.service.documents.length ? svcRes.service.documents : []
      const states: KindState[] = await Promise.all(
        documents.map(async (documentKind) => {
          const r = await callAttorneyMcp<{ prompt: PromptDoc | null }>({
            toolName: 'legal.service.prompt.get',
            input: { serviceKey, documentKind },
          })
          return {
            documentKind,
            doc: r.prompt,
            text: r.prompt?.instructionsText ?? '',
            rawText: r.prompt?.promptText ?? '',
            advancedOpen: false,
            busy: false,
            saved: false,
            error: null,
          }
        }),
      )
      setKinds(states)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  function patchKind(idx: number, mut: (k: KindState) => KindState) {
    setKinds((ks) => ks.map((k, i) => (i === idx ? mut(k) : k)))
  }

  // Save the service-specific instructions. No slot validation: an empty save is
  // legitimate and means "the firm defaults are enough for this document".
  async function saveInstructions(idx: number) {
    const k = kinds[idx]
    if (!k) return
    patchKind(idx, (s) => ({ ...s, busy: true, error: null, saved: false }))
    try {
      const r = await callAttorneyMcp<{ prompt: PromptDoc }>({
        toolName: 'legal.service.instructions.update',
        input: { serviceKey, documentKind: k.documentKind, instructionsText: k.text },
      })
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        saved: true,
        doc: r.prompt,
        text: r.prompt.instructionsText ?? '',
        rawText: r.prompt.promptText ?? '',
      }))
      setTimeout(() => patchKind(idx, (s) => ({ ...s, saved: false })), 2500)
    } catch (e) {
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  // ADVANCED: overwrite the whole prompt template for this document kind. Still
  // slot-validated — a raw prompt that drops a slot silently breaks drafting.
  async function saveRawPrompt(idx: number) {
    const k = kinds[idx]
    if (!k) return
    const missing = missingSlots(k.rawText)
    if (missing.length > 0) {
      patchKind(idx, (s) => ({
        ...s,
        error: `Add the missing slot(s) before saving: ${missing.join(', ')}`,
      }))
      return
    }
    patchKind(idx, (s) => ({ ...s, busy: true, error: null, saved: false }))
    try {
      const r = await callAttorneyMcp<{ prompt: PromptDoc }>({
        toolName: 'legal.service.prompt.update',
        input: { serviceKey, documentKind: k.documentKind, promptText: k.rawText },
      })
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        saved: true,
        doc: r.prompt,
        rawText: r.prompt.promptText ?? '',
      }))
      setTimeout(() => patchKind(idx, (s) => ({ ...s, saved: false })), 2500)
    } catch (e) {
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  return (
    <>
      <p className="li-svc-hint">
        What the drafting agent should do differently for <code>{serviceKey}</code> — in your own
        words, one document at a time. You don&rsquo;t need to repeat the universal rules or the
        firm&rsquo;s own standing instructions: those are applied to every document automatically,
        and you can change them in{' '}
        <Link href="/attorney/settings/context">Settings &rarr; AI Context</Link>. Saving creates a
        new version; the next draft uses it.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {!service ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : kinds.length === 0 ? (
        <div className="empty-block">
          This service has no documents configured. Add document kinds (e.g.{' '}
          <code>operating_agreement</code>) on the service editor first.
        </div>
      ) : (
        <div className="li-svc-body">
          {kinds.map((k, idx) => {
            const fullPromptMode = k.doc?.source === 'config'
            const rawMissing = missingSlots(k.rawText)
            return (
              <section key={k.documentKind} className="li-svc-panel li-svc-panel--accent">
                <div className="li-svc-tplcard-head">
                  <strong>{humanKind(k.documentKind)}</strong>
                  <span className={`li-svc-chip${k.text.trim() ? ' custom' : ''}`}>
                    {fullPromptMode
                      ? 'Custom full prompt'
                      : k.text.trim()
                        ? `Custom instructions${k.doc?.promptVersion != null ? ` · v${k.doc.promptVersion}` : ''}`
                        : 'Firm defaults only'}
                  </span>
                  {!fullPromptMode && (
                    <button
                      className="li-svc-btn-primary"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => saveInstructions(idx)}
                      disabled={k.busy}
                    >
                      {k.busy ? 'Saving…' : 'Save instructions'}
                    </button>
                  )}
                </div>

                {fullPromptMode ? (
                  <div className="alert" style={{ marginBottom: 12 }}>
                    This document uses a hand-authored FULL prompt, so the firm&rsquo;s AI Context
                    settings are not layered onto it. Edit it under Advanced below, or clear it
                    there to move this document onto the composed instructions.
                  </div>
                ) : (
                  <textarea
                    value={k.text}
                    onChange={(e) =>
                      patchKind(idx, (s) => ({
                        ...s,
                        text: e.target.value,
                        saved: false,
                        error: null,
                      }))
                    }
                    rows={6}
                    style={{ width: '100%', fontSize: '13.5px', lineHeight: 1.6 }}
                    placeholder="e.g. This is a multi-member operating agreement — always include a buy-sell provision and spell out capital-call obligations."
                  />
                )}

                {k.error && (
                  <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
                    {k.error}
                  </div>
                )}
                {k.saved && (
                  <div className="alert alert-success" style={{ marginTop: 'var(--space-2)' }}>
                    Saved a new version.
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <button
                    className="li-svc-btn"
                    onClick={() => patchKind(idx, (s) => ({ ...s, advancedOpen: !s.advancedOpen }))}
                  >
                    {k.advancedOpen ? '▾' : '▸'} Advanced — full assembled prompt
                  </button>
                  {k.advancedOpen && (
                    <>
                      <p className="li-svc-hint" style={{ margin: '10px 0 6px' }}>
                        {fullPromptMode
                          ? 'The exact prompt sent to the model. Editing it here keeps this document on a hand-authored prompt; every required slot must stay present.'
                          : 'The exact prompt sent to the model, assembled from the universal rules, your firm’s AI Context settings and the instructions above. Read-only unless you save it as a hand-authored prompt, which takes this document off the composed layers.'}
                      </p>
                      <textarea
                        value={k.rawText}
                        onChange={(e) =>
                          patchKind(idx, (s) => ({ ...s, rawText: e.target.value, error: null }))
                        }
                        rows={16}
                        spellCheck={false}
                        style={{
                          width: '100%',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: '12.5px',
                          lineHeight: 1.6,
                        }}
                      />
                      <div className="li-svc-label-row">Required slots</div>
                      <div className="li-svc-chips" style={{ marginBottom: 10 }}>
                        {REQUIRED_SLOTS.map((slot) => {
                          const present = k.rawText.includes(slot)
                          return (
                            <span
                              key={slot}
                              className={`li-svc-chip${present ? ' ok' : ''}`}
                              title={present ? 'Present' : 'Missing — add this slot'}
                            >
                              <span aria-hidden>{present ? '✓' : '✗'}</span>
                              <code>{slot}</code>
                            </span>
                          )
                        })}
                      </div>
                      <button
                        className="li-svc-btn"
                        onClick={() => saveRawPrompt(idx)}
                        disabled={k.busy || rawMissing.length > 0}
                      >
                        {k.busy ? 'Saving…' : 'Save as hand-authored prompt'}
                      </button>
                    </>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
