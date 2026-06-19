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
      <p style={{ color: 'var(--muted)', marginTop: '-0.2rem' }}>
        The instructions the drafting agent follows when generating each document for{' '}
        <code>{serviceKey}</code>. Saving creates a new immutable version; the drafting worker uses
        it on the next run. Each prompt must contain every required slot — they are filled in with
        the client&rsquo;s answers, the consultation transcript, and the document template.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {!service ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : kinds.length === 0 ? (
        <div className="loading-block">
          This service has no documents configured. Add document kinds (e.g.{' '}
          <code>operating_agreement</code>) on the service editor first.
        </div>
      ) : (
        kinds.map((k, idx) => {
          const missing = missingSlots(k.text)
          return (
            <section key={k.documentKind} style={{ borderLeft: '3px solid var(--border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.5rem',
                }}
              >
                <strong>{humanKind(k.documentKind)}</strong>
                <span className={`badge ${k.source === 'config' ? 'info' : ''}`}>
                  {k.source === 'config'
                    ? `Custom${k.promptVersion != null ? ` · v${k.promptVersion}` : ''}`
                    : k.source === 'repo'
                      ? 'Default (built-in)'
                      : 'No prompt'}
                </span>
                <button
                  className="primary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => save(idx)}
                  disabled={k.busy || missing.length > 0}
                >
                  {k.busy ? 'Saving…' : 'Save new version'}
                </button>
              </div>

              <div style={{ marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                  Required slots
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  {REQUIRED_SLOTS.map((slot) => {
                    const present = k.text.includes(slot)
                    return (
                      <li
                        key={slot}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontSize: '0.8rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '0.4rem',
                          border: '1px solid',
                          borderColor: present ? '#86efac' : '#fecaca',
                          background: present ? 'var(--ok-soft)' : '#fef2f2',
                          color: present ? '#166534' : '#991b1b',
                        }}
                        title={present ? 'Present' : 'Missing — add this slot'}
                      >
                        <span aria-hidden>{present ? '✓' : '✗'}</span>
                        <code style={{ background: 'transparent', color: 'inherit' }}>{slot}</code>
                      </li>
                    )
                  })}
                </ul>
              </div>

              <label>
                <span>Prompt</span>
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
                  rows={18}
                  spellCheck={false}
                  style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}
                  placeholder="Drafting instructions, including the required {{slots}}…"
                />
              </label>

              {missing.length > 0 && (
                <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>
                  Missing required slot(s): {missing.join(', ')}. Saving is blocked until every slot
                  is present.
                </div>
              )}
              {k.error && (
                <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>
                  {k.error}
                </div>
              )}
              {k.saved && (
                <div
                  className="alert"
                  style={{
                    marginTop: '0.5rem',
                    background: 'var(--ok-soft)',
                    color: '#166534',
                    border: '1px solid #86efac',
                  }}
                >
                  Saved a new version.
                </div>
              )}
            </section>
          )
        })
      )}
    </>
  )
}
