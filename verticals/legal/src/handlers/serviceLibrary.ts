// ───────────────────────────────────────────────────────────────────────────
// legal.service.upsert / legal.service.set_active — the Service Library write
// path (PR1). Service offerings are workflow_definition rows (seeded in 0001);
// these handlers make them editable in-app as VERSIONED config.
//
// "Update" is never an in-place edit: it SEALS the current active row
// (valid_to = now(), status = 'deprecated') and INSERTs version+1, so the
// history of every service definition is immutable (invariant 17 — config
// version binding). Writing workflow_definition from a handler is allowed: the
// handler IS the action layer (hard rule 1). Each change also appends a
// configuration_change row (invariant 18, the audit of who changed config).
//
// Why a vertical handler and not the foundation's workflow.define: that handler
// always inserts version=1 and never seals the prior version (and the directive
// forbids changing the foundation). Versioning is the whole point here.
// ───────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
// Pure completeness rules shared with the API/UI. Importing from the api module is
// safe (no cycle): services.ts depends only on the substrate/templates, never on
// handlers. The gate logic lives in ONE place so the handler guard and the UI's
// readiness check can never drift apart.
import { completenessFromTransitions } from '../api/services.js'
// Lifecycle graph validation (ADR 0045). Editing the workflow rides this same
// service-save (Joe's Q3): a provided `states` is validated here and written as part
// of the new version — no separate action.
import { validateLifecycle, type Lifecycle } from '../lifecycle/index.js'

interface ServiceTransitions {
  route?: string
  intake_form_id?: string
  documents?: string[]
  on_transcript?: string
  sort_order?: number
  notify?: string
  // Contract G (WP2.3): how a document is produced. 'template_merge' is the
  // deterministic default (renderTemplate, no AI); 'ai_draft' is opt-in.
  generation_mode?: string
  [k: string]: unknown
}

interface ServiceWorkflowRow {
  id: string
  version: number
  states: unknown
  transitions: ServiceTransitions
  participating_entity_kinds: unknown
  display_name: string
  description: string | null
  status: string
}

// Slugify a display name into a stable kind_name. Mirrors the (deleted)
// templates.ts slug/unique pattern, but the write goes through this handler.
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'service'
  )
}

async function uniqueKindName(client: DbClient, tenantId: string, base: string): Promise<string> {
  let key = base
  let n = 2
  // Check ALL versions (not just active) so a re-created service never collides
  // with a deprecated history row's kind_name.
  for (;;) {
    const res = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM workflow_definition WHERE tenant_id = $1 AND kind_name = $2
       ) AS exists`,
      [tenantId, key],
    )
    if (!res.rows[0]?.exists) return key
    key = `${base}_${n}`
    n += 1
  }
}

async function currentActive(
  client: DbClient,
  tenantId: string,
  kindName: string,
): Promise<ServiceWorkflowRow | null> {
  const res = await client.query<ServiceWorkflowRow>(
    `SELECT id, version, states, transitions, participating_entity_kinds, display_name, description, status
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [tenantId, kindName],
  )
  return res.rows[0] ?? null
}

async function recordConfigChange(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    targetId: string
    // configuration_change.change_kind is constrained to these three
    // (core migration 0010_config_and_capability.sql).
    changeKind: 'create' | 'update' | 'deprecate'
    before: Record<string, unknown> | null
    after: Record<string, unknown>
  },
) {
  await client.query(
    `INSERT INTO configuration_change
       (tenant_id, action_id, target_table, target_id, change_kind,
        before_value, after_value, authoring_actor_id)
     VALUES ($1, $2, 'workflow_definition', $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      args.tenantId,
      args.actionId,
      args.targetId,
      args.changeKind,
      args.before ? JSON.stringify(args.before) : null,
      JSON.stringify(args.after),
      args.actorId,
    ],
  )
}

interface ServiceUpsertPayload {
  service_key?: string // existing kind_name; omit to create a new service
  display_name: string
  description?: string | null
  route?: string // 'auto' | 'manual'
  documents?: string[]
  sort_order?: number
  // Additional transitions keys to merge in (e.g. intake_form_id later). The
  // preserved keys (intake_form_id/route/documents/on_transcript) always win
  // from the prior row unless explicitly overridden here.
  transitions_patch?: Record<string, unknown>
  // The matter lifecycle stage graph (ADR 0045). When provided, it is validated and
  // written into workflow_definition.states as part of this version; when omitted,
  // the prior row's states is carried forward verbatim.
  states?: unknown
}

registerActionHandler('legal.service.upsert', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ServiceUpsertPayload
  const displayName = p.display_name?.trim()
  if (!displayName) throw new Error('display_name is required')

  const isUpdate = Boolean(p.service_key)
  const prior = isUpdate ? await currentActive(client, ctx.tenantId, p.service_key!) : null
  if (isUpdate && !prior) throw new Error(`Service not found: ${p.service_key}`)

  const kindName = isUpdate
    ? p.service_key!
    : await uniqueKindName(client, ctx.tenantId, slugify(displayName))

  // Merge transitions: start from the prior row's config so intake_form_id,
  // route, documents, on_transcript and any other operational keys survive an
  // edit verbatim unless the caller overrides them. Metadata edits (route,
  // documents, sort_order) layer on top.
  const baseTransitions: ServiceTransitions = prior ? { ...prior.transitions } : {}
  const merged: ServiceTransitions = { ...baseTransitions, ...(p.transitions_patch ?? {}) }
  if (p.route !== undefined) merged.route = p.route
  if (p.documents !== undefined) merged.documents = p.documents
  if (p.sort_order !== undefined) merged.sort_order = p.sort_order
  // A brand-new service has no intake form bound yet (deferred to a later PR);
  // default route to manual so it never auto-drafts before a form exists.
  if (!isUpdate && merged.route === undefined) merged.route = 'manual'
  // Contract G (WP2.3): default document generation to the deterministic
  // template merge; 'ai_draft' stays available but opt-in (never the default).
  if (merged.generation_mode === undefined) merged.generation_mode = 'template_merge'

  // Lifecycle (ADR 0045): a provided graph is validated and written; otherwise the
  // prior row's states is carried forward (an edit to another tab never disturbs it).
  let states: unknown = prior ? prior.states : []
  if (p.states !== undefined) {
    const lc = p.states as Lifecycle
    const v = validateLifecycle(lc)
    if (!v.ok) throw new Error(`Invalid lifecycle: ${v.errors.join('; ')}`)
    states = lc
  }
  const participating = prior
    ? prior.participating_entity_kinds
    : ['matter', 'client_contact', 'questionnaire_response', 'call_session', 'transcript']
  const nextVersion = prior ? prior.version + 1 : 1

  // Seal the prior active row FIRST (bitemporal close: valid_to set, status
  // deprecated). The new version then becomes the sole active row.
  if (prior) {
    await client.query(
      `UPDATE workflow_definition
          SET valid_to = now(), status = 'deprecated'
        WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, prior.id],
    )
  }

  // Status on the new version (PR4):
  //  - CREATE: a brand-new service starts 'deprecated' (disabled) — it is not yet
  //    complete (no questionnaire), so it must NOT appear on the public booking
  //    page until the attorney finishes it and explicitly enables it through the
  //    gated set_active path. (The table default is 'active', so this is set
  //    explicitly.)
  //  - UPDATE: carry the prior row's status forward, so saving a new version of a
  //    LIVE service keeps it live and editing a disabled one keeps it disabled.
  //    Enable/disable stays the sole job of set_active.
  const status = isUpdate ? (prior?.status ?? 'active') : 'deprecated'
  const newId = randomUUID()
  await client.query(
    `INSERT INTO workflow_definition
       (id, tenant_id, action_id, kind_name, display_name, description,
        states, transitions, participating_entity_kinds, version, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      newId,
      ctx.tenantId,
      actionId,
      kindName,
      displayName,
      p.description ?? prior?.description ?? null,
      JSON.stringify(states),
      JSON.stringify(merged),
      JSON.stringify(participating),
      nextVersion,
      status,
    ],
  )

  await recordConfigChange(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    targetId: newId,
    changeKind: isUpdate ? 'update' : 'create',
    before: prior
      ? { kind_name: kindName, version: prior.version, transitions: prior.transitions }
      : null,
    after: {
      kind_name: kindName,
      version: nextVersion,
      display_name: displayName,
      transitions: merged,
    },
  })

  return { workflowDefinitionId: newId, serviceKey: kindName, version: nextVersion }
})

interface ServiceSetActivePayload {
  service_key: string
  active: boolean
}

registerActionHandler('legal.service.set_active', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ServiceSetActivePayload
  if (!p.service_key) throw new Error('service_key is required')

  // Find the current row REGARDLESS of status (re-enable must reach a
  // deprecated row). The current row is the latest version that is not sealed
  // by a newer version, i.e. valid_to IS NULL. Pull transitions too so the enable
  // gate can read the service's config directly (PR4).
  const res = await client.query<{ id: string; status: string; transitions: ServiceTransitions }>(
    `SELECT id, status, transitions
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [ctx.tenantId, p.service_key],
  )
  const row = res.rows[0]
  if (!row) throw new Error(`Service not found: ${p.service_key}`)

  // ENABLE GATE (PR4): a service must be complete before it can go live. A
  // service with no questionnaire — or an auto-route service missing a drafting
  // prompt + required slots for any document kind — is not bookable. Disabling is
  // always allowed (an incomplete service should be disableable). The rules come
  // from the shared pure helper so they match the API/UI completeness check.
  if (p.active) {
    const completeness = completenessFromTransitions(p.service_key, row.transitions)
    if (!completeness.ready) {
      throw new Error(
        `Cannot enable "${p.service_key}" — it is not complete yet: ${completeness.missing.join('; ')}.`,
      )
    }
  }

  const nextStatus = p.active ? 'active' : 'deprecated'
  await client.query(
    `UPDATE workflow_definition SET status = $3
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, row.id, nextStatus],
  )

  await recordConfigChange(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    targetId: row.id,
    changeKind: p.active ? 'update' : 'deprecate',
    before: { status: row.status },
    after: { status: nextStatus, kind_name: p.service_key },
  })

  return { serviceKey: p.service_key, status: nextStatus }
})

interface ServiceRetirePayload {
  service_key: string
}

// legal.service.retire — permanently retire a service WITHOUT a replacement
// version. Unlike set_active (a status flip that leaves the row current) and
// upsert (seal-then-insert), retire seals the current row (valid_to = now()) and
// inserts NO successor, so the service leaves every listing (all reads filter
// valid_to IS NULL) while its history stays immutable. Used to clear leftover
// test-fixture services from the config table (beta sprint Obj 12).
registerActionHandler('legal.service.retire', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ServiceRetirePayload
  if (!p.service_key) throw new Error('service_key is required')

  const row = await currentActive(client, ctx.tenantId, p.service_key)
  if (!row) throw new Error(`Service not found (or already retired): ${p.service_key}`)

  await client.query(
    `UPDATE workflow_definition
        SET valid_to = now(), status = 'deprecated'
      WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, row.id],
  )

  await recordConfigChange(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    targetId: row.id,
    changeKind: 'deprecate',
    before: { status: row.status, kind_name: p.service_key, valid_to: null },
    after: { status: 'deprecated', kind_name: p.service_key, retired: true },
  })

  return { serviceKey: p.service_key, retired: true }
})
