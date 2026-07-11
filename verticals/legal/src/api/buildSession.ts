// UI-BUILDER-FIX-1 Phase 5 — service-build session scoping. ONE guided build in
// the assistant = ONE service_build_session entity (runtime kinds, see
// demo/seed-build-session-kinds.ts): started on the build's first turn, messages
// appended per exchange, closed when the service enables or the attorney moves
// on. New build = new session, ALWAYS — sessions are never reopened or reused.
//
// Scope: the SERVICE BUILDER only. The general chatbot's conversations are the
// sibling assistant_chat_session (api/chatSession.ts, HARDENING-RESIDUALS-1
// WP-D2) — a distinct kind on the same pattern; do not merge the row-spaces.
//
// Everything flows through EXISTING core actions (entity.create / attribute.set /
// event.record): kind.define cannot mint action kinds (MACHINE-COMMS-1 precedent,
// api/notes.ts), and none are needed — the action rows carry author + intent.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { containsMachinery, stripMachinerySpans } from './assistantMachinery.js'

const SESSION_KIND = 'service_build_session'
// Message text is capped per event: the session is a scoping/audit record; the
// full turn (uncapped) is already persisted as the referenced assistant.turn.
const MESSAGE_CAP = 8_000

export interface BuildMessage {
  role: 'user' | 'assistant'
  content: string
  // The assistant.turn event this message came from (set once the turn persists).
  turnEventId?: string | null
}

export async function startBuildSession(
  ctx: ActionContext,
  input?: { serviceKey?: string | null },
): Promise<{ buildSessionId: string }> {
  const created = await submitAction(ctx, {
    actionKindName: 'entity.create',
    intentKind: 'exploration',
    payload: {
      entity_kind_name: SESSION_KIND,
      name: `Service build ${new Date().toISOString()}`,
      attributes: [
        {
          attributeKindName: 'build_session_status',
          value: 'open',
          confidence: 1.0,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
          sourceType: 'human',
          sourceRef: ctx.actorId,
        },
        ...(input?.serviceKey?.trim()
          ? [
              {
                attributeKindName: 'build_session_service_key',
                value: input.serviceKey.trim(),
                confidence: 1.0,
                knowabilityState: 'observed',
                timePrecision: 'exact_instant',
                sourceType: 'human',
                sourceRef: ctx.actorId,
              },
            ]
          : []),
      ],
    },
  })
  const buildSessionId = (created.effects[0] as { entityId?: string })?.entityId
  if (!buildSessionId) throw new Error('entity.create returned no entityId for the build session.')

  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'exploration',
    payload: {
      event_kind_name: 'service_build.session.started',
      primary_entity_id: buildSessionId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { service_key: input?.serviceKey?.trim() || null },
    },
  })
  return { buildSessionId }
}

// Append one exchange's messages (user + assistant) to their session. Two events
// per exchange, so the receipt's per-session message count reads exactly what was
// said in that build. Best-effort ordering: user first.
export async function appendBuildMessages(
  ctx: ActionContext,
  buildSessionId: string,
  messages: BuildMessage[],
): Promise<void> {
  for (const m of messages) {
    const raw = (m.content ?? '').trim()
    if (!raw) continue
    // WP-D6 — orchestration text (the ⟦…⟧ driver/continuation machinery the app
    // injects) is never persisted as anyone's words: the sentinel spans are
    // stripped and the message is flagged synthetic_driver instead. A message
    // that was ONLY machinery still lands (flagged, with its plain-text lead if
    // any), so the session's message count stays one-per-exchange.
    const synthetic = containsMachinery(raw)
    const content = synthetic ? stripMachinerySpans(raw) : raw
    await submitAction(ctx, {
      actionKindName: 'event.record',
      intentKind: 'exploration',
      payload: {
        event_kind_name: 'service_build.message.appended',
        primary_entity_id: buildSessionId,
        source_type: 'human',
        source_ref: ctx.actorId,
        data: {
          role: m.role,
          content: content.slice(0, MESSAGE_CAP),
          synthetic_driver: synthetic || null,
          turn_event_id: m.turnEventId ?? null,
        },
      },
    })
  }
}

// Stamp the service under construction once it's known (first shell approve).
// Append-only supersession — a later stamp records the switch honestly.
export async function setBuildSessionService(
  ctx: ActionContext,
  buildSessionId: string,
  serviceKey: string,
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: 'adjustment',
    payload: {
      entity_id: buildSessionId,
      attribute_kind_name: 'build_session_service_key',
      value: serviceKey.trim(),
      confidence: 1.0,
      knowability_state: 'observed',
      time_precision: 'exact_instant',
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
}

export async function closeBuildSession(
  ctx: ActionContext,
  buildSessionId: string,
  reason: 'completed' | 'switched' | 'abandoned' = 'completed',
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: 'adjustment',
    payload: {
      entity_id: buildSessionId,
      attribute_kind_name: 'build_session_status',
      value: 'closed',
      confidence: 1.0,
      knowability_state: 'observed',
      time_precision: 'exact_instant',
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'adjustment',
    payload: {
      event_kind_name: 'service_build.session.closed',
      primary_entity_id: buildSessionId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { reason },
    },
  })
}

// HARDENING-RESIDUALS-1 (WP-D5) — the anti-shredding fallback, SCOPED TO THE
// BUILD. Prod showed one build fragmented into SIX+ single-exchange sessions: a
// client that never resends the session id (stale bundle, dropped ref) minted a
// fresh session per TURN. A build turn arriving with no/invalid session id
// reuses the caller's most-recent open session FOR THE SAME SERVICE — matched on
// the session's build_session_service_key — instead of silently minting another.
//
// The service-key match is load-bearing: an early fix reused the actor's most-
// recent open session of ANY build, so starting a brand-new build (service B)
// while an unrelated session for build A was still open hijacked A's session and
// appended B's messages to it. A build only ever reuses its OWN service's open
// session; without a serviceKey (the pre-shell turns of a genuinely new build)
// it mints fresh — and the caller then closes the actor's stale open sessions,
// which self-heals any strays a prior stale client left behind.
export async function findOpenBuildSessionForActor(
  ctx: ActionContext,
  serviceKey?: string | null,
): Promise<string | null> {
  const key = serviceKey?.trim()
  if (!key) return null // a new build with no service key yet: mint fresh, never hijack another build
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       JOIN event ev ON ev.primary_entity_id = e.id AND ev.tenant_id = e.tenant_id
       JOIN event_kind_definition ek ON ek.id = ev.event_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
         AND ek.kind_name = 'service_build.session.started'
         AND ev.source_ref = $3
         AND (
           SELECT a.value #>> '{}'
             FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
              AND akd.kind_name = 'build_session_status'
            ORDER BY a.valid_from DESC LIMIT 1
         ) = 'open'
         AND (
           SELECT a.value #>> '{}'
             FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
              AND akd.kind_name = 'build_session_service_key'
            ORDER BY a.valid_from DESC LIMIT 1
         ) = $4
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [ctx.tenantId, SESSION_KIND, ctx.actorId, key],
    )
    return r.rows[0]?.id ?? null
  })
}

// When a genuinely NEW build session is minted, the caller's other open
// sessions are stale by definition (one build = one session; a new build
// supersedes an abandoned one). Closing them keeps the record honest and
// self-heals the fragmentation a stale client left behind. Best-effort: a
// close failure never blocks the new session.
export async function closeStaleBuildSessionsForActor(
  ctx: ActionContext,
  keepBuildSessionId: string,
): Promise<void> {
  const ids = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       JOIN event ev ON ev.primary_entity_id = e.id AND ev.tenant_id = e.tenant_id
       JOIN event_kind_definition ek ON ek.id = ev.event_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = $2 AND e.status = 'active'
         AND ek.kind_name = 'service_build.session.started'
         AND ev.source_ref = $3
         AND e.id <> $4
         AND (
           SELECT a.value #>> '{}'
             FROM attribute a
             JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
            WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
              AND akd.kind_name = 'build_session_status'
            ORDER BY a.valid_from DESC LIMIT 1
         ) = 'open'`,
      [ctx.tenantId, SESSION_KIND, ctx.actorId, keepBuildSessionId],
    )
    return r.rows.map((row) => row.id)
  })
  for (const id of ids) {
    try {
      await closeBuildSession(ctx, id, 'abandoned')
    } catch (err) {
      console.error(`buildSession: failed to close stale session ${id}`, err)
    }
  }
}

// True when the id names an OPEN service_build_session in this tenant — the
// chat's recording half calls this so a stale client-held id (closed session,
// foreign row) starts a fresh session instead of appending to the wrong one.
export async function isOpenBuildSession(
  ctx: ActionContext,
  buildSessionId: string,
): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ status: string | null }>(
      `SELECT (
         SELECT a.value #>> '{}'
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
          WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
            AND akd.kind_name = 'build_session_status'
          ORDER BY a.valid_from DESC LIMIT 1
       ) AS status
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = $3 AND e.status = 'active'`,
      [ctx.tenantId, buildSessionId, SESSION_KIND],
    )
    return r.rows[0]?.status === 'open'
  })
}

// HARDENING-RESIDUALS-1 (WP-H1) — record that the attorney HAND-EDITED a
// proposed artifact in the pop-up editor before approving it, so the build
// session's trail honestly reads proposal → human edit → approval. An
// observation event (core-seeded, no state change) through the action layer,
// threaded on the build session when one is open.
export async function recordBuildArtifactEdited(
  ctx: ActionContext,
  input: { buildSessionId?: string | null; note: string },
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'adjustment',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: input.buildSessionId ?? null,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: { tag: 'build_artifact_human_edited', note: input.note },
    },
  })
}
