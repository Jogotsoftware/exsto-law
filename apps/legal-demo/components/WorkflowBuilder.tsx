'use client'

// BUILDER-UX-2 WP-2 — the shared service-workflow step builder, EXTRACTED from
// app/attorney/services/[serviceKey]/workflow/page.tsx so the standalone Workflow tab
// and the wizard's WorkflowEditorModal edit a lifecycle through ONE builder, never a
// fork (the same move QuestionnaireBuilder made in #336). The page keeps data
// loading/saving and the step-library writes; this component owns the step list UI:
// add (catalog + library picks), edit-in-place per step, reorder, remove, documents,
// capability config, drafting instructions.
//
// CONSTRAINT (mirrors the page): no server-package imports. The catalog/library wire
// shapes are structural mirrors; the CLOSED catalog of actions + gates is read at
// runtime from legal.workflow.catalog by the host.
import { useState } from 'react'
import { useCallback, useEffect } from 'react'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import {
  type WfGate,
  type WfActionKind,
  type WfDocumentRef,
  type BuilderStep,
  triggerField,
  defaultTrigger,
  nextUid,
} from '@/lib/workflowBuilderModel'

// ── Wire shapes (structural mirror; not imported from the server) ──────────────
export interface CatalogAction {
  kind: WfActionKind
  label: string
  description: string
  defaultGate: WfGate
  blocking: boolean
  // A deprecated kind stays renderable on existing steps but is never offered for
  // NEW picks (AddPalette + the step-kind select filter it out).
  deprecated?: boolean
}
export interface GateTransitionOption {
  token: string
  label: string
}
// P14 — a step-invocable platform capability, served as a palette entry beside the
// step library. seedAction is the server-generated invoke_capability action (slug +
// config skeleton from the capability's own config_schema) taken verbatim;
// defaultGate/suggestedTrigger describe how the matter LEAVES the capability's stage
// (e.g. system/esign.completed) — under target-anchoring that pair seeds the NEXT
// step's incoming edge, never this step's own.
export interface CatalogCapability {
  slug: string
  label: string
  description: string
  defaultGate: WfGate
  seedAction: { kind: WfActionKind; config?: Record<string, unknown> }
  suggestedTrigger: string
}
export interface WorkflowCatalog {
  actions: CatalogAction[]
  gates: WfGate[]
  // Optional: an older server may not return it — the trigger editor falls back to
  // free text when absent. Mirrors GATE_TRANSITION_VOCABULARY.
  gateTransitions?: Record<WfGate, { field: 'via' | 'on' | null; options: GateTransitionOption[] }>
  // Optional for the same reason; absent/empty hides the capabilities palette group.
  capabilities?: CatalogCapability[]
}

// P14 — display names for capability slugs. The registry's spec.name is the
// fallback, but the palette/step chrome prefers these action-shaped labels; the
// capability itself is never renamed. Mirror-map idiom (like the proposal card's
// ACTION_LABELS): this is a no-server-import client component.
const CAPABILITY_LABELS: Record<string, string> = {
  esignature: 'Request e-signature',
  document_generation: 'Generate document',
  transcript_extraction: 'Capture consultation notes',
  email_generation: 'Draft client email',
}
// Constraints worth saying at pick time (appended to the palette description).
const CAPABILITY_NOTES: Record<string, string> = {
  esignature:
    'Sends the latest APPROVED document for signature — approve the document before this step runs.',
}
function deSlug(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
export function capabilityLabel(slug: string, catalog: WorkflowCatalog | null): string {
  return (
    CAPABILITY_LABELS[slug] ??
    catalog?.capabilities?.find((c) => c.slug === slug)?.label ??
    deSlug(slug)
  )
}
function stepCapabilitySlug(step: BuilderStep): string {
  const slug = step.config?.capability_slug
  return typeof slug === 'string' ? slug.trim() : ''
}

// A saved step's STAGE is a LifecycleStage WITHOUT edges — mirrors
// verticals/legal/src/queries/workflowStepLibrary.ts.
export interface WfStepStage {
  label: string
  client_label?: string
  blocking?: boolean
  gate: WfGate
  action: { kind: WfActionKind; config?: Record<string, unknown> }
  documents?: WfDocumentRef[]
}
export interface WorkflowStepTemplate {
  workflowStepTemplateId: string
  name: string
  description: string | null
  stage: WfStepStage
}

// P12 — a step's gate/trigger now describe its INCOMING edge ("How this step is
// reached"), so the gate copy says who brings the matter HERE, not who advances it.
export const GATE_LABELS: Record<WfGate, string> = {
  automatic: 'Automatic — the system moves the matter here on its own',
  attorney: 'Attorney — an attorney action brings the matter here',
  client: 'Client — a client action brings the matter here',
  system: 'System — an external event brings the matter here',
}

// One builder step → a saved-step STAGE (no edges/key/entry/terminal). The free-text
// trigger is NOT saved — it is edge metadata the builder re-defaults per gate.
export function stepToStage(s: BuilderStep): WfStepStage {
  const stage: WfStepStage = {
    label: s.label.trim() || 'Step',
    gate: s.gate,
    // Carry action.config so a saved invoke_capability step keeps its capability
    // slug + standing instructions in the library (stageToStep restores it).
    action:
      s.config && Object.keys(s.config).length
        ? { kind: s.actionKind, config: s.config }
        : { kind: s.actionKind },
  }
  if (s.clientLabel.trim()) stage.client_label = s.clientLabel.trim()
  if (!s.blocking) stage.blocking = false
  if (s.documents.length) stage.documents = s.documents
  return stage
}

// A saved-step STAGE → a fresh builder step (new uid, blank key so it slugs on save).
export function stageToStep(t: WorkflowStepTemplate): BuilderStep {
  const st = t.stage
  return {
    uid: nextUid(),
    key: '',
    label: st.label || t.name,
    clientLabel: st.client_label ?? '',
    actionKind: st.action?.kind ?? 'manual_task',
    gate: st.gate ?? 'attorney',
    trigger: '',
    blocking: st.blocking !== false,
    documents: st.documents ?? [],
    config: st.action?.config,
  }
}

export function WorkflowBuilder({
  steps,
  onChange,
  catalog,
  library,
  serviceKey,
  onSaveToLibrary,
}: {
  steps: BuilderStep[]
  onChange: (next: BuilderStep[]) => void
  catalog: WorkflowCatalog | null
  library: WorkflowStepTemplate[]
  serviceKey: string
  // Standalone-only chrome: the page passes its library-create handler; the wizard
  // pop-up omits it, which hides the per-step "Save to library" button entirely.
  onSaveToLibrary?: (step: BuilderStep, name: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [savingToLib, setSavingToLib] = useState<string | null>(null) // step uid

  // P12 — the incoming pair for a step APPENDED after the current last step. Under
  // target-anchoring the pair describes how the NEW step is REACHED, so it derives
  // entirely from what completes the PRECEDING step — never from the added action's
  // own defaultGate (appending a system-gated action like "Complete matter" after a
  // review step used to seed (system, '') and the validator rejected the save).
  // Mirrors defaultTrigger's preceding-kind table, with the capability catalog
  // supplying the completion pair for a preceding capability step.
  function incomingPairAfter(): { gate: WfGate; trigger: string } {
    const prev = steps[steps.length - 1]
    if (prev?.actionKind === 'approve_send_invoice' || prev?.actionKind === 'await_payment') {
      return { gate: 'system', trigger: 'invoice.paid' }
    }
    if (prev?.actionKind === 'invoke_capability') {
      const slug = stepCapabilitySlug(prev)
      const cap = slug ? catalog?.capabilities?.find((c) => c.slug === slug) : undefined
      if (cap?.suggestedTrigger) return { gate: cap.defaultGate, trigger: cap.suggestedTrigger }
    }
    if (prev?.actionKind === 'review_send_document') {
      return { gate: 'attorney', trigger: 'draft.approve' }
    }
    return { gate: 'attorney', trigger: 'legal.matter.advance' }
  }

  function addStep(action: CatalogAction) {
    const pair = incomingPairAfter()
    const step: BuilderStep = {
      uid: nextUid(),
      key: '',
      label: action.label,
      clientLabel: '',
      actionKind: action.kind,
      gate: pair.gate,
      trigger: pair.trigger,
      blocking: action.blocking,
      documents: [],
    }
    onChange([...steps, step])
    setAdding(false)
    setEditing(step.uid)
  }

  // Drop a saved library step in as a new step (a fresh, editable copy — the builder
  // wires its edges on save, exactly like a catalog add).
  function addFromLibrary(t: WorkflowStepTemplate) {
    const step = stageToStep(t)
    const pair = incomingPairAfter()
    onChange([...steps, { ...step, ...pair }])
    setAdding(false)
    setEditing(step.uid)
  }

  // P14 — a capability palette pick seeds a real invoke_capability step: the
  // server-generated action (slug + config skeleton) verbatim. Its OWN gate/trigger
  // describe how the step is REACHED (target-anchoring), so they default like any
  // other appended step — the capability's completion pair (defaultGate +
  // suggestedTrigger) seeds the step that FOLLOWS it, via incomingPairAfter.
  function addCapabilityStep(c: CatalogCapability) {
    const pair = incomingPairAfter()
    const step: BuilderStep = {
      uid: nextUid(),
      key: '',
      label: capabilityLabel(c.slug, catalog),
      clientLabel: '',
      actionKind: 'invoke_capability',
      gate: pair.gate,
      trigger: pair.trigger,
      blocking: catalog?.actions.find((a) => a.kind === 'invoke_capability')?.blocking ?? true,
      documents: [],
      // Deep-copy so two picks of the same capability never share a config object.
      config: c.seedAction.config
        ? (JSON.parse(JSON.stringify(c.seedAction.config)) as Record<string, unknown>)
        : undefined,
    }
    onChange([...steps, step])
    setAdding(false)
    setEditing(step.uid)
  }

  function updateStep(uid: string, patch: Partial<BuilderStep>) {
    onChange(steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
  }

  function removeStep(uid: string) {
    onChange(steps.filter((s) => s.uid !== uid))
    if (editing === uid) setEditing(null)
  }

  function move(uid: string, dir: -1 | 1) {
    const i = steps.findIndex((s) => s.uid === uid)
    const j = i + dir
    if (i < 0 || j < 0 || j >= steps.length) return
    const next = steps.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <>
      {steps.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '1.4rem',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          {adding ? (
            <AddPalette
              catalog={catalog}
              library={library}
              onPick={addStep}
              onPickLibrary={addFromLibrary}
              onPickCapability={addCapabilityStep}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <>
              <p style={{ margin: '0 0 0.8rem' }}>No workflow yet — add your first step.</p>
              {catalog && (
                <button type="button" className="primary" onClick={() => setAdding(true)}>
                  + Add a step
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <ol
          style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'grid', gap: 0 }}
        >
          {steps.map((s, i) => (
            <li key={s.uid}>
              <StepCard
                step={s}
                prevStep={i > 0 ? steps[i - 1] : undefined}
                index={i}
                total={steps.length}
                catalog={catalog}
                serviceKey={serviceKey}
                open={editing === s.uid}
                onToggle={() => setEditing(editing === s.uid ? null : s.uid)}
                onChange={(patch) => updateStep(s.uid, patch)}
                onRemove={() => removeStep(s.uid)}
                onMoveUp={() => move(s.uid, -1)}
                onMoveDown={() => move(s.uid, 1)}
                canSaveToLib={!!onSaveToLibrary}
                savingToLib={savingToLib === s.uid}
                onStartSaveToLib={() => setSavingToLib(s.uid)}
                onCancelSaveToLib={() => setSavingToLib(null)}
                onSaveToLib={(name) => {
                  setSavingToLib(null)
                  onSaveToLibrary?.(s, name)
                }}
              />
              {i < steps.length - 1 && <Connector />}
            </li>
          ))}
        </ol>
      )}

      {steps.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          {adding ? (
            <AddPalette
              catalog={catalog}
              library={library}
              onPick={addStep}
              onPickLibrary={addFromLibrary}
              onPickCapability={addCapabilityStep}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              className="outline"
              onClick={() => setAdding(true)}
              disabled={!catalog}
            >
              + Add step
            </button>
          )}
        </div>
      )}
    </>
  )
}

function Connector() {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        justifyContent: 'center',
        color: 'var(--muted)',
        height: 22,
        lineHeight: '22px',
        fontSize: '1.1rem',
      }}
    >
      ↓
    </div>
  )
}

function PaletteGroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.78rem',
        fontWeight: 600,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        margin: '0.8rem 0 0.4rem',
      }}
    >
      {children}
    </div>
  )
}

// A palette of catalog actions; picking one appends a step seeded with that action's
// label + defaultGate. It also lists the platform's step-invocable CAPABILITIES
// (picking one seeds a ready-to-configure invoke_capability step) and the firm's
// SAVED step library — picking one appends an editable copy of that saved step.
function AddPalette({
  catalog,
  library,
  onPick,
  onPickLibrary,
  onPickCapability,
  onCancel,
}: {
  catalog: WorkflowCatalog | null
  library: WorkflowStepTemplate[]
  onPick: (a: CatalogAction) => void
  onPickLibrary: (t: WorkflowStepTemplate) => void
  onPickCapability: (c: CatalogCapability) => void
  onCancel: () => void
}) {
  if (!catalog) return null
  const capabilities = catalog.capabilities ?? []
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.8rem',
        background: 'var(--surface, #fafafa)',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Pick a step action</strong>
        <button
          type="button"
          className="back-link"
          onClick={onCancel}
          style={{ marginLeft: 'auto' }}
        >
          Cancel
        </button>
      </div>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {catalog.actions
          .filter((a) => !a.deprecated)
          .map((a) => (
            <button
              key={a.kind}
              type="button"
              onClick={() => onPick(a)}
              style={{
                textAlign: 'left',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '0.55rem 0.7rem',
                background: 'var(--bg, #fff)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.label}</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{a.description}</div>
            </button>
          ))}
      </div>

      {capabilities.length > 0 && (
        <>
          <PaletteGroupHeading>Platform capabilities</PaletteGroupHeading>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {capabilities.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onPickCapability(c)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '0.55rem 0.7rem',
                  background: 'var(--bg, #fff)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {capabilityLabel(c.slug, catalog)}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {[c.description, CAPABILITY_NOTES[c.slug]].filter(Boolean).join(' ')}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {library.length > 0 && (
        <>
          <PaletteGroupHeading>From your step library</PaletteGroupHeading>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {library.map((t) => {
              const actionLabel =
                catalog.actions.find((a) => a.kind === t.stage.action?.kind)?.label ??
                t.stage.action?.kind
              return (
                <button
                  key={t.workflowStepTemplateId}
                  type="button"
                  onClick={() => onPickLibrary(t)}
                  style={{
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '0.55rem 0.7rem',
                    background: 'var(--bg, #fff)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                    {t.description || actionLabel}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function StepCard({
  step,
  prevStep,
  index,
  total,
  catalog,
  serviceKey,
  open,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canSaveToLib,
  savingToLib,
  onStartSaveToLib,
  onCancelSaveToLib,
  onSaveToLib,
}: {
  step: BuilderStep
  prevStep?: BuilderStep
  index: number
  total: number
  catalog: WorkflowCatalog | null
  serviceKey: string
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<BuilderStep>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canSaveToLib: boolean
  savingToLib: boolean
  onStartSaveToLib: () => void
  onCancelSaveToLib: () => void
  onSaveToLib: (name: string) => void
}) {
  const isLast = index === total - 1
  const capSlug = step.actionKind === 'invoke_capability' ? stepCapabilitySlug(step) : ''
  const actionLabel = capSlug
    ? capabilityLabel(capSlug, catalog)
    : (catalog?.actions.find((a) => a.kind === step.actionKind)?.label ?? step.actionKind)

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.7rem 0.8rem',
        background: 'var(--bg, #fff)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--border)',
            fontSize: '0.75rem',
            fontWeight: 600,
            flex: '0 0 auto',
          }}
        >
          {index + 1}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{step.label || <em>Untitled step</em>}</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {actionLabel}
            {' · '}
            {/* P12: gate describes the step's INCOMING edge, so the first step shows
                'entry' (nothing precedes it) and the last shows its gate + terminal. */}
            {index === 0 ? 'entry' : `gate: ${step.gate}`}
            {isLast && ' · terminal'}
            {step.documents.length > 0 &&
              ` · ${step.documents.length} doc${step.documents.length > 1 ? 's' : ''}`}
            {!step.blocking && ' · non-blocking'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', flex: '0 0 auto' }}>
          <button
            type="button"
            className="outline"
            title="Move up"
            onClick={onMoveUp}
            disabled={index === 0}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ↑
          </button>
          <button
            type="button"
            className="outline"
            title="Move down"
            onClick={onMoveDown}
            disabled={isLast}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ↓
          </button>
          {canSaveToLib && (
            <button
              type="button"
              className="outline"
              title="Save this step to the firm library for reuse in other workflows"
              onClick={onStartSaveToLib}
              disabled={savingToLib}
              style={{ padding: '0.25rem 0.6rem' }}
            >
              Save to library
            </button>
          )}
          <button
            type="button"
            className="outline"
            onClick={onToggle}
            style={{ padding: '0.25rem 0.6rem' }}
          >
            {open ? 'Done' : 'Edit'}
          </button>
          <button
            type="button"
            className="danger outline"
            title="Remove step"
            onClick={onRemove}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            ✕
          </button>
        </div>
      </div>

      {savingToLib && (
        <SaveToLibraryRow
          defaultName={step.label}
          onCancel={onCancelSaveToLib}
          onSave={onSaveToLib}
        />
      )}

      {open && (
        <StepEditor
          step={step}
          prevStep={prevStep}
          isFirst={index === 0}
          isLast={isLast}
          catalog={catalog}
          serviceKey={serviceKey}
          onChange={onChange}
        />
      )}
    </div>
  )
}

// Inline name prompt for saving a step to the library.
function SaveToLibraryRow({
  defaultName,
  onCancel,
  onSave,
}: {
  defaultName: string
  onCancel: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(defaultName)
  return (
    <div
      style={{
        marginTop: '0.6rem',
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'center',
        padding: '0.5rem',
        border: '1px dashed var(--border)',
        borderRadius: 6,
        background: 'var(--surface, #fafafa)',
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name this saved step"
        style={{ flex: 1 }}
        autoFocus
      />
      <button
        type="button"
        className="primary"
        onClick={() => onSave(name)}
        disabled={!name.trim()}
        style={{ padding: '0.3rem 0.7rem' }}
      >
        Save
      </button>
      <button
        type="button"
        className="outline"
        onClick={onCancel}
        style={{ padding: '0.3rem 0.6rem' }}
      >
        Cancel
      </button>
    </div>
  )
}

function StepEditor({
  step,
  prevStep,
  isFirst,
  isLast,
  catalog,
  serviceKey,
  onChange,
}: {
  step: BuilderStep
  prevStep?: BuilderStep
  isFirst: boolean
  isLast: boolean
  catalog: WorkflowCatalog | null
  serviceKey: string
  onChange: (patch: Partial<BuilderStep>) => void
}) {
  const gates = catalog?.gates ?? (['automatic', 'attorney', 'client', 'system'] as WfGate[])
  const capSlug = step.actionKind === 'invoke_capability' ? stepCapabilitySlug(step) : ''
  return (
    <div style={{ marginTop: '0.7rem', display: 'grid', gap: '0.6rem' }}>
      <div className="form-grid">
        <label>
          <span>Step label</span>
          <input value={step.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <label>
          <span>Client-facing label (optional)</span>
          <input
            value={step.clientLabel}
            onChange={(e) => onChange({ clientLabel: e.target.value })}
            placeholder="Falls back to the step label"
          />
        </label>
      </div>

      <label>
        <span>What this step does</span>
        <select
          value={step.actionKind}
          onChange={(e) => onChange({ actionKind: e.target.value as WfActionKind })}
        >
          {(catalog?.actions ?? [])
            .filter((a) => !a.deprecated || a.kind === step.actionKind)
            .map((a) => (
              <option key={a.kind} value={a.kind}>
                {/* P14: an invoke_capability step reads as ITS capability, never as
                    the raw generic kind. */}
                {a.kind === 'invoke_capability' && capSlug
                  ? capabilityLabel(capSlug, catalog)
                  : a.deprecated
                    ? `${a.label} (legacy)`
                    : a.label}
              </option>
            ))}
        </select>
        {catalog && (
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {(capSlug && catalog.capabilities?.find((c) => c.slug === capSlug)?.description) ||
              catalog.actions.find((a) => a.kind === step.actionKind)?.description}
          </span>
        )}
      </label>

      <label className="svc-check" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={step.blocking}
          onChange={(e) => onChange({ blocking: e.target.checked })}
        />
        <span>Blocking — this step holds the matter until it&apos;s done</span>
      </label>

      {/* P12: the pair edits the step's INCOMING edge, so it is hidden on the FIRST
          step (nothing precedes the entry) rather than on the last. */}
      {!isFirst && (
        <fieldset className="svc-fieldset">
          <legend>How this step is reached</legend>
          <label>
            <span>Gate — who or what moves the matter to this step</span>
            <select
              value={step.gate}
              onChange={(e) => onChange({ gate: e.target.value as WfGate })}
            >
              {gates.map((g) => (
                <option key={g} value={g}>
                  {GATE_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <TriggerEditor step={step} prevStep={prevStep} catalog={catalog} onChange={onChange} />
        </fieldset>
      )}
      {isFirst && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
          This is the first step — the matter starts here, so nothing precedes it.
        </p>
      )}
      {isLast && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
          This is the terminal step — it closes the matter and has no outgoing connection.
        </p>
      )}

      <DocumentRows documents={step.documents} onChange={(documents) => onChange({ documents })} />

      {/* NEW-G: config lives WITH the step it drives. */}
      {step.actionKind === 'invoke_capability' && (
        <CapabilityConfigEditor config={step.config} onChange={(config) => onChange({ config })} />
      )}
      {step.actionKind === 'generate_document' && (
        <DraftingInstructionsEditor serviceKey={serviceKey} documents={step.documents} />
      )}
    </div>
  )
}

// The step's INCOMING trigger (P12): the exact via/on token whose firing moves the
// matter from the PRECEDING step to this one, so the default keys off what completes
// that preceding step. attorney/client/system gates advance on EXACT tokens the
// runtime matches, so the editor offers the catalog's transition vocabulary as a
// select of plain-language descriptions — the raw token rides below as a muted hint.
// A loaded off-vocabulary trigger stays selectable as "Current: …" so opening and
// saving an old workflow never silently rewrites it. An automatic `on` is free-form
// (descriptive), and an older server without gateTransitions falls back to free text.
function TriggerEditor({
  step,
  prevStep,
  catalog,
  onChange,
}: {
  step: BuilderStep
  prevStep?: BuilderStep
  catalog: WorkflowCatalog | null
  onChange: (patch: Partial<BuilderStep>) => void
}) {
  const isVia = triggerField(step.gate) === 'via'
  const label = isVia ? 'What moves the matter to this step' : 'What it waits for to get here'
  const fallback = defaultTrigger(step.gate, prevStep?.actionKind, prevStep?.config)
  const options =
    step.gate === 'automatic' ? [] : (catalog?.gateTransitions?.[step.gate]?.options ?? [])

  if (options.length === 0) {
    return (
      <label style={{ display: 'block', marginTop: '0.5rem' }}>
        <span>{label}</span>
        <input
          value={step.trigger}
          onChange={(e) => onChange({ trigger: e.target.value })}
          placeholder={step.gate === 'automatic' ? 'e.g. document.generated' : fallback}
        />
      </label>
    )
  }

  const selected = step.trigger || fallback
  const offVocabulary = step.trigger !== '' && !options.some((o) => o.token === step.trigger)
  return (
    <label style={{ display: 'block', marginTop: '0.5rem' }}>
      <span>{label}</span>
      <select value={selected} onChange={(e) => onChange({ trigger: e.target.value })}>
        {selected === '' && (
          <option value="">
            {isVia ? 'Choose what moves the matter here…' : 'Choose what it waits for…'}
          </option>
        )}
        {offVocabulary && (
          <option value={step.trigger}>Current: {step.trigger} (not a standard trigger)</option>
        )}
        {options.map((o) => (
          <option key={o.token} value={o.token}>
            {o.label}
          </option>
        ))}
      </select>
      {selected !== '' && (
        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Saved as {selected}</span>
      )}
    </label>
  )
}

// docKind + label rows for the step's documents.
function DocumentRows({
  documents,
  onChange,
}: {
  documents: WfDocumentRef[]
  onChange: (docs: WfDocumentRef[]) => void
}) {
  function set(i: number, patch: Partial<WfDocumentRef>) {
    onChange(documents.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  return (
    <fieldset className="svc-fieldset">
      <legend>Documents (optional)</legend>
      {documents.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: '0 0 0.4rem' }}>
          No documents on this step.
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {documents.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              value={d.docKind ?? ''}
              onChange={(e) => set(i, { docKind: e.target.value })}
              placeholder="Document kind (e.g. operating_agreement)"
              style={{ flex: 1 }}
            />
            <input
              value={d.label ?? ''}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Label (e.g. Operating Agreement)"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="danger outline"
              onClick={() => onChange(documents.filter((_, idx) => idx !== i))}
              style={{ padding: '0.25rem 0.5rem' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="outline"
        onClick={() => onChange([...documents, { docKind: '', label: '' }])}
        style={{ marginTop: '0.4rem' }}
      >
        + Add document
      </button>
    </fieldset>
  )
}

function humanizeDocKind(k: string): string {
  return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// NEW-G: the attorney's standing instructions for an invoke_capability step. We edit
// the STRING values in place and hand the whole config object back so it round-trips
// (stepsToGraph writes action.config verbatim). Non-string values are shown read-only
// so a structured config is never silently flattened.
function CapabilityConfigEditor({
  config,
  onChange,
}: {
  config?: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const cfg = config ?? {}
  const slug = typeof cfg.capability_slug === 'string' ? cfg.capability_slug : ''
  const capConfig = (cfg.capability_config ?? {}) as Record<string, unknown>
  const keys = Object.keys(capConfig)

  function setKey(key: string, value: string) {
    onChange({ ...cfg, capability_config: { ...capConfig, [key]: value } })
  }

  return (
    <fieldset className="svc-fieldset">
      <legend>Capability configuration{slug ? ` · ${slug}` : ''}</legend>
      {keys.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
          This capability has no editable instructions.
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {keys.map((key) => {
          const value = capConfig[key]
          if (typeof value !== 'string') {
            return (
              <label key={key}>
                <span>{humanizeDocKind(key)}</span>
                <pre
                  style={{
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                    margin: '0.2rem 0 0',
                  }}
                >
                  {JSON.stringify(value)}
                </pre>
              </label>
            )
          }
          return (
            <label key={key}>
              <span>{humanizeDocKind(key)}</span>
              <textarea value={value} rows={3} onChange={(e) => setKey(key, e.target.value)} />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

// NEW-G: a generate step's drafting instructions are the service-level prompt keyed by
// document kind (same store the Prompt tab edits). Authoritative — reads/writes the
// same legal.service.prompt.get/update store.
function DraftingInstructionsEditor({
  serviceKey,
  documents,
}: {
  serviceKey: string
  documents: WfDocumentRef[]
}) {
  const docKinds = documents
    .map((d) => d.docKind?.trim())
    .filter((k): k is string => !!k && k.length > 0)
  if (docKinds.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: '0.82rem', margin: 0 }}>
        Add a document kind above to edit its drafting instructions.
      </p>
    )
  }
  return (
    <>
      {docKinds.map((dk) => (
        <DraftingInstructionsForKind key={dk} serviceKey={serviceKey} docKind={dk} />
      ))}
    </>
  )
}

function DraftingInstructionsForKind({
  serviceKey,
  docKind,
}: {
  serviceKey: string
  docKind: string
}) {
  const [text, setText] = useState<string | null>(null) // null while loading
  const [source, setSource] = useState<'config' | 'repo' | 'none'>('none')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callAttorneyMcp<{
        prompt: { promptText: string | null; source: 'config' | 'repo' | 'none' } | null
      }>({ toolName: 'legal.service.prompt.get', input: { serviceKey, documentKind: docKind } })
      setText(r.prompt?.promptText ?? '')
      setSource(r.prompt?.source ?? 'none')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setText('')
    }
  }, [serviceKey, docKind])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (text == null) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      // The server validates the required {{slots}} and throws with guidance if any
      // are missing — surface that rather than re-implementing the slot list here.
      await callAttorneyMcp({
        toolName: 'legal.service.prompt.update',
        input: { serviceKey, documentKind: docKind, promptText: text },
      })
      setSource('config')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="svc-fieldset">
      <legend>Drafting instructions · {humanizeDocKind(docKind)}</legend>
      {text == null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          <textarea
            value={text}
            rows={10}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value)
              setSaved(false)
              setError(null)
            }}
            style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem', width: '100%' }}
            placeholder="Drafting instructions, including the required {{slots}}…"
          />
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}
          >
            <button type="button" className="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save instructions'}
            </button>
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
              {source === 'config'
                ? 'Custom instructions'
                : source === 'repo'
                  ? 'Using the built-in default'
                  : 'No instructions yet'}
            </span>
          </div>
          {error && (
            <div className="alert alert-error" style={{ marginTop: '0.4rem' }}>
              {error}
            </div>
          )}
          {saved && (
            <div className="alert alert-success" style={{ marginTop: '0.4rem' }}>
              Saved a new version.
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
