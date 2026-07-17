'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// The FIXED mustache-slot contract the drafting worker fills (must mirror
// REQUIRED_DRAFTING_SLOTS in the legal API). A prompt missing any of these is
// rejected on save — the worker would otherwise leave the slot unfilled.
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

interface PromptDoc {
  serviceKey: string
  documentKind: string
  promptText: string | null
  source: 'config' | 'repo' | 'none'
  promptVersion: number | null
  requiredSlots: string[]
}

interface KindState {
  documentKind: string
  text: string
  source: PromptDoc['source']
  promptVersion: number | null
  busy: boolean
  saved: boolean
  error: string | null
  loaded: boolean
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
            text: r.prompt?.promptText ?? '',
            source: r.prompt?.source ?? 'none',
            promptVersion: r.prompt?.promptVersion ?? null,
            busy: false,
            saved: false,
            error: null,
            loaded: true,
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

  async function save(idx: number) {
    const k = kinds[idx]
    if (!k) return
    const missing = missingSlots(k.text)
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
        input: { serviceKey, documentKind: k.documentKind, promptText: k.text },
      })
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        saved: true,
        source: r.prompt.source,
        promptVersion: r.prompt.promptVersion,
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
        The instructions the drafting agent follows when generating each document for{' '}
        <code>{serviceKey}</code>. Saving creates a new immutable version; the drafting worker uses
        it on the next run. Each prompt must contain every required slot — they are filled in with
        the client&rsquo;s answers, the consultation transcript, and the document template.
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
            const missing = missingSlots(k.text)
            return (
              <section key={k.documentKind} className="li-svc-panel li-svc-panel--accent">
                <div className="li-svc-tplcard-head">
                  <strong>{humanKind(k.documentKind)}</strong>
                  <span className={`li-svc-chip${k.source === 'config' ? ' custom' : ''}`}>
                    {k.source === 'config'
                      ? `Custom${k.promptVersion != null ? ` · v${k.promptVersion}` : ''}`
                      : k.source === 'repo'
                        ? 'Default (built-in)'
                        : 'No prompt'}
                  </span>
                  <button
                    className="li-svc-btn-primary"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => save(idx)}
                    disabled={k.busy || missing.length > 0}
                  >
                    {k.busy ? 'Saving…' : 'Save new version'}
                  </button>
                </div>

                <div className="li-svc-label-row">Required slots</div>
                <div className="li-svc-chips" style={{ marginBottom: 14 }}>
                  {REQUIRED_SLOTS.map((slot) => {
                    const present = k.text.includes(slot)
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
                  rows={10}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '12.5px',
                    lineHeight: 1.6,
                  }}
                  placeholder="Drafting instructions, including the required {{slots}}…"
                />

                {missing.length > 0 && (
                  <div className="alert alert-error" style={{ marginTop: 'var(--space-2)' }}>
                    Missing required slot(s): {missing.join(', ')}. Saving is blocked until every
                    slot is present.
                  </div>
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
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
