'use client'

// Workflow tab (ADR 0045 PR4) — edit the matter lifecycle: the ordered stages a
// matter of this service moves through, and the gate on each transition (who/what
// advances it). Saving rides the service-save action (legal.service.lifecycle.update
// → legal.service.upsert), writing a new immutable version. New matters follow the
// new workflow; in-flight matters keep the version they opened under.
//
// Today the `automatic` gate on the drafting transition is the live lever (it is the
// data-defined replacement for the auto/manual route — PR3). Other gates and stages
// describe the matter's roadmap and drive more of the engine as later PRs roll out.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { callAttorneyMcp } from '@/lib/mcpAttorney'

type GateKind = 'automatic' | 'attorney' | 'client' | 'system'

interface Edge {
  to: string
  gate: GateKind
  via?: string
  on?: string
  when?: string
}
interface Stage {
  key: string
  label: string
  client_label?: string
  entry?: boolean
  terminal?: boolean
  advances_to: Edge[]
}

const GATE_OPTIONS: Array<{ value: GateKind; label: string; hint: string }> = [
  { value: 'automatic', label: 'Automatic', hint: 'The system advances this on its own (e.g. auto-draft).' },
  { value: 'attorney', label: 'Attorney action', hint: 'An attorney advances it (e.g. approve a draft).' },
  { value: 'client', label: 'Client action', hint: 'The client advances it (e.g. book, sign).' },
  { value: 'system', label: 'External callback', hint: 'An outside service advances it (e.g. e-sign done).' },
]

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'stage'
  )
}

export default function WorkflowEditorPage() {
  const params = useParams<{ serviceKey: string }>()
  const serviceKey = params.serviceKey

  const [stages, setStages] = useState<Stage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await callAttorneyMcp<{ lifecycle: Stage[] | null }>({
        toolName: 'legal.service.lifecycle.get',
        input: { serviceKey },
      })
      setStages(r.lifecycle ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [serviceKey])

  useEffect(() => {
    load()
  }, [load])

  function mutate(next: Stage[]) {
    setStages(next)
    setSaved(false)
    setError(null)
  }
  function patchStage(idx: number, mut: (s: Stage) => Stage) {
    if (!stages) return
    mutate(stages.map((s, i) => (i === idx ? mut(s) : s)))
  }

  function moveStage(idx: number, dir: -1 | 1) {
    if (!stages) return
    const j = idx + dir
    if (j < 0 || j >= stages.length) return
    const next = [...stages]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    mutate(next)
  }

  function removeStage(idx: number) {
    if (!stages) return
    const removed = stages[idx].key
    // Drop the stage and any edge pointing at it, so the graph stays referentially valid.
    const next = stages
      .filter((_, i) => i !== idx)
      .map((s) => ({ ...s, advances_to: s.advances_to.filter((e) => e.to !== removed) }))
    mutate(next)
  }

  function addStage() {
    if (!stages) return
    const name = window.prompt('Name of the new stage (what the attorney sees):')
    if (!name?.trim()) return
    let key = slugify(name)
    const existing = new Set(stages.map((s) => s.key))
    if (existing.has(key)) {
      let n = 2
      while (existing.has(`${key}_${n}`)) n++
      key = `${key}_${n}`
    }
    mutate([
      ...stages,
      { key, label: name.trim(), advances_to: [], entry: stages.length === 0, terminal: true },
    ])
  }

  function setEntry(idx: number) {
    if (!stages) return
    mutate(stages.map((s, i) => ({ ...s, entry: i === idx })))
  }

  function toggleTerminal(idx: number) {
    if (!stages) return
    patchStage(idx, (s) =>
      s.terminal ? { ...s, terminal: false } : { ...s, terminal: true, advances_to: [] },
    )
  }

  function addEdge(idx: number) {
    if (!stages) return
    const target = stages.find((s) => s.key !== stages[idx].key)
    if (!target) return
    patchStage(idx, (s) => ({ ...s, advances_to: [...s.advances_to, { to: target.key, gate: 'attorney' }] }))
  }
  function patchEdge(sIdx: number, eIdx: number, mut: (e: Edge) => Edge) {
    patchStage(sIdx, (s) => ({
      ...s,
      advances_to: s.advances_to.map((e, i) => (i === eIdx ? mut(e) : e)),
    }))
  }
  function removeEdge(sIdx: number, eIdx: number) {
    patchStage(sIdx, (s) => ({ ...s, advances_to: s.advances_to.filter((_, i) => i !== eIdx) }))
  }

  // Light client-side checks to enable the button and warn early; the server's
  // validateLifecycle is the authority and rejects anything invalid on save.
  function localProblems(): string[] {
    if (!stages || stages.length === 0) return ['Add at least one stage.']
    const problems: string[] = []
    if (stages.filter((s) => s.entry).length !== 1) problems.push('Mark exactly one start stage.')
    if (!stages.some((s) => s.terminal)) problems.push('Mark at least one end (terminal) stage.')
    if (stages.some((s) => !s.label.trim())) problems.push('Every stage needs a label.')
    return problems
  }

  async function save() {
    if (!stages) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const r = await callAttorneyMcp<{ lifecycle: Stage[] }>({
        toolName: 'legal.service.lifecycle.update',
        input: { serviceKey, states: stages },
      })
      setStages(r.lifecycle)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const problems = localProblems()

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '-0.2rem' }}>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          The stages a matter moves through, and what advances each step. Saving creates a new
          version — new matters follow it; matters already in progress keep their current workflow.
        </p>
        <button
          className="primary"
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
          onClick={save}
          disabled={busy || problems.length > 0}
        >
          {busy ? 'Saving…' : 'Save workflow'}
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginTop: '0.6rem' }}>
          {error}
        </div>
      )}
      {saved && (
        <div
          className="alert"
          style={{
            marginTop: '0.6rem',
            background: 'var(--ok-soft)',
            color: '#166534',
            border: '1px solid #86efac',
          }}
        >
          Saved a new version of the workflow.
        </div>
      )}
      {problems.length > 0 && stages && (
        <div className="alert" style={{ marginTop: '0.6rem', background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e' }}>
          {problems.join(' ')}
        </div>
      )}

      {stages === null ? (
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {stages.map((stage, idx) => (
            <section key={stage.key} style={{ borderLeft: '3px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{idx + 1}.</span>
                <input
                  value={stage.label}
                  onChange={(e) => patchStage(idx, (s) => ({ ...s, label: e.target.value }))}
                  placeholder="Stage name"
                  style={{ fontWeight: 600, minWidth: '12rem' }}
                />
                <code style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>{stage.key}</code>
                {stage.entry && <span className="badge ok">Start</span>}
                {stage.terminal && <span className="badge">End</span>}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.3rem' }}>
                  <button className="icon-btn" title="Move up" disabled={idx === 0} onClick={() => moveStage(idx, -1)}>
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    title="Move down"
                    disabled={idx === stages.length - 1}
                    onClick={() => moveStage(idx, 1)}
                  >
                    ↓
                  </button>
                  <button className="icon-btn" title="Remove stage" onClick={() => removeStage(idx)}>
                    ✕
                  </button>
                </span>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '0.5rem 0' }}>
                <label style={{ flex: '1 1 16rem' }}>
                  <span>Client-facing label (optional)</span>
                  <input
                    value={stage.client_label ?? ''}
                    onChange={(e) =>
                      patchStage(idx, (s) => ({ ...s, client_label: e.target.value || undefined }))
                    }
                    placeholder={stage.label || 'Shown to the client in their portal'}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', alignSelf: 'end' }}>
                  <input type="radio" name="entry-stage" checked={!!stage.entry} onChange={() => setEntry(idx)} />
                  <span>Start stage</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', alignSelf: 'end' }}>
                  <input type="checkbox" checked={!!stage.terminal} onChange={() => toggleTerminal(idx)} />
                  <span>End stage</span>
                </label>
              </div>

              {!stage.terminal && (
                <div style={{ marginTop: '0.3rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.3rem' }}>
                    Advances to
                  </div>
                  {stage.advances_to.length === 0 && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                      No outgoing steps yet.
                    </div>
                  )}
                  {stage.advances_to.map((edge, eIdx) => (
                    <div
                      key={eIdx}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>→</span>
                      <select
                        value={edge.to}
                        onChange={(e) => patchEdge(idx, eIdx, (x) => ({ ...x, to: e.target.value }))}
                      >
                        {stages
                          .filter((s) => s.key !== stage.key)
                          .map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label || s.key}
                            </option>
                          ))}
                      </select>
                      <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>when</span>
                      <select
                        value={edge.gate}
                        onChange={(e) =>
                          patchEdge(idx, eIdx, (x) => ({ ...x, gate: e.target.value as GateKind }))
                        }
                        title={GATE_OPTIONS.find((g) => g.value === edge.gate)?.hint}
                      >
                        {GATE_OPTIONS.map((g) => (
                          <option key={g.value} value={g.value}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                      <button className="icon-btn" title="Remove step" onClick={() => removeEdge(idx, eIdx)}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addEdge(idx)}
                    disabled={stages.length < 2}
                    style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}
                  >
                    + Add step
                  </button>
                </div>
              )}
            </section>
          ))}

          <div>
            <button onClick={addStage}>+ Add stage</button>
          </div>
        </div>
      )}
    </>
  )
}
