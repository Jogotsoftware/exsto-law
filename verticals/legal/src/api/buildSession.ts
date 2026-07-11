// UI-BUILDER-FIX-1 Phase 5 — service-build session scoping. ONE guided build in
// the assistant = ONE service_build_session entity (runtime kinds, see
// demo/seed-build-session-kinds.ts): started on the build's first turn, messages
// appended per exchange, closed when the service enables or the attorney moves
// on. New build = new session, ALWAYS — sessions are never reopened or reused.
//
// Scope: the SERVICE BUILDER only. The general chatbot's chat history is a
// separate thread (S-queue item #13, owned by S2) — do not wire it here.
//
// Everything flows through EXISTING core actions (entity.create / attribute.set /
// event.record): kind.define cannot mint action kinds (MACHINE-COMMS-1 precedent,
// api/notes.ts), and none are needed — the action rows carry author + intent.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

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
    const content = (m.content ?? '').trim()
    if (!content) continue
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
