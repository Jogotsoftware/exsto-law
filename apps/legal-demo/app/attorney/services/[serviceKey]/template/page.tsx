'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

// Doc-Types PR1: the in-app editor for a service's document BODY template, per
// document kind. Unlike the drafting prompt there is no required-slot contract —
// the body is a reference the drafting agent follows, and any {{variable}} markers
// in it are filled by the model from the client's answers/transcript. The only
// rule is non-empty. The two built-in kinds (operating_agreement, engagement_letter)
// ship a bundled body; a novel kind has no body until one is saved here, which is
// what unblocks enabling an auto service that drafts it.

interface ServiceDefinition {
  serviceKey: string
  displayName: string
  documents: string[]
}

interface TemplateDoc {
  serviceKey: string
  documentKind: string
  templateText: string | null
  source: 'config' | 'repo' | 'none'
  templateVersion: number | null
}

interface KindState {
  documentKind: string
  text: string
  source: TemplateDoc['source']
  templateVersion: number | null
  busy: boolean
  saved: boolean
  error: string | null
}

function humanKind(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function TemplateEditorPage() {
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

      const documents = svcRes.service.documents ?? []
      const states: KindState[] = await Promise.all(
        documents.map(async (documentKind) => {
          const r = await callAttorneyMcp<{ template: TemplateDoc | null }>({
            toolName: 'legal.service.template.get',
            input: { serviceKey, documentKind },
          })
          return {
            documentKind,
            text: r.template?.templateText ?? '',
            source: r.template?.source ?? 'none',
            templateVersion: r.template?.templateVersion ?? null,
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

  async function save(idx: number) {
    const k = kinds[idx]
    if (!k) return
    if (!k.text.trim()) {
      patchKind(idx, (s) => ({ ...s, error: 'The template cannot be empty.' }))
      return
    }
    patchKind(idx, (s) => ({ ...s, busy: true, error: null, saved: false }))
    try {
      const r = await callAttorneyMcp<{ template: TemplateDoc }>({
        toolName: 'legal.service.template.update',
        input: { serviceKey, documentKind: k.documentKind, templateText: k.text },
      })
      patchKind(idx, (s) => ({
        ...s,
        busy: false,
        saved: true,
        source: r.template.source,
        templateVersion: r.template.templateVersion,
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
    <main>
      <div
        className="attorney-page-head"
        style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}
      >
        <h1 style={{ margin: 0 }}>Document templates</h1>
        <Link
          href={`/attorney/services/${serviceKey}`}
          className="back-link"
          style={{ marginLeft: 'auto' }}
        >
          Back to service
        </Link>
      </div>

      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        The body template the drafting agent follows when generating each document for{' '}
        <code>{serviceKey}</code>. Saving creates a new immutable version; the drafting worker uses
        it on the next run. Use <code>{'{{variable}}'}</code> markers for facts the agent should
        fill from the client&rsquo;s answers and the consultation. A brand-new document type has no
        built-in body — authoring one here is what makes it draftable.
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
          const badge =
            k.source === 'config'
              ? `Custom${k.templateVersion != null ? ` · v${k.templateVersion}` : ''}`
              : k.source === 'repo'
                ? 'Default (built-in)'
                : 'No template — required to enable'
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
                <span
                  className={`badge ${k.source === 'config' ? 'info' : k.source === 'none' ? '' : ''}`}
                  style={
                    k.source === 'none' ? { background: '#fef2f2', color: '#991b1b' } : undefined
                  }
                >
                  {badge}
                </span>
                <button
                  className="primary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => save(idx)}
                  disabled={k.busy || !k.text.trim()}
                >
                  {k.busy ? 'Saving…' : 'Save new version'}
                </button>
              </div>

              <label>
                <span>Template</span>
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
                  rows={26}
                  spellCheck={false}
                  style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem' }}
                  placeholder="# Document title&#10;&#10;Body in markdown, with {{variable}} markers the agent fills…"
                />
              </label>

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
    </main>
  )
}
