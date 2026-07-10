// MACHINE-COMMS-1 (WP1) — notes: the memory primitive. A note is a runtime-defined
// `note` entity (seed-comms-kinds.ts) attached to a matter or a client via `note_of`,
// optionally pointing at its source via `note_about` (e.g. the transcript it was
// extracted from). Everything flows through EXISTING core actions — entity.create /
// attribute.set / entity.archive — no bespoke action kinds (kind.define cannot mint
// those, and none are needed: the action rows carry author + intent already).
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

export type NoteSource = 'attorney' | 'ai_summary' | 'ai_extraction'

export interface CreateNoteInput {
  body: string
  // Exactly one attachment point is required: a matter or a client.
  matterEntityId?: string
  clientEntityId?: string
  // Optional source entity the note derives from (e.g. a transcript).
  aboutEntityId?: string
  // Defaults to 'attorney' (a human writing a note). AI callers pass their kind
  // and MUST also pass provenance (sourceType 'agent' + the model identity).
  source?: NoteSource
  sourceType?: 'human' | 'agent'
  sourceRef?: string
  // Extra metadata stored on the note entity (e.g. reasoning_trace_id for AI notes).
  metadata?: Record<string, unknown>
}

export interface CreateNoteResult {
  noteEntityId: string
}

export async function createNote(
  ctx: ActionContext,
  input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('A note needs a body.')
  const target = input.matterEntityId?.trim() || input.clientEntityId?.trim()
  if (!target || (input.matterEntityId && input.clientEntityId)) {
    throw new Error('A note attaches to exactly one matter OR one client.')
  }
  const source: NoteSource = input.source ?? 'attorney'
  const sourceType = input.sourceType ?? 'human'
  const sourceRef = input.sourceRef ?? ctx.actorId

  const created = await submitAction(ctx, {
    actionKindName: 'entity.create',
    intentKind: 'reflection',
    payload: {
      entity_kind_name: 'note',
      // A short display name: the first line, clipped. The full text lives in note_body.
      name: body.split('\n')[0]!.slice(0, 80),
      attributes: [
        {
          attributeKindName: 'note_body',
          value: body,
          confidence: 1.0,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
          sourceType,
          sourceRef,
        },
        {
          attributeKindName: 'note_source',
          value: source,
          confidence: 1.0,
          knowabilityState: 'observed',
          timePrecision: 'exact_instant',
          sourceType,
          sourceRef,
        },
      ],
    },
  })
  const noteEntityId = (created.effects[0] as { entityId?: string })?.entityId
  if (!noteEntityId) throw new Error('entity.create returned no entityId for the note.')

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    // entity.create has no metadata param; stamp it tenant-scoped on the fresh row.
    await withActionContext(ctx, async (client) => {
      await client.query(
        `UPDATE entity SET metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb
          WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, noteEntityId, JSON.stringify(input.metadata)],
      )
    })
  }

  await submitAction(ctx, {
    actionKindName: 'relationship.create',
    intentKind: 'reflection',
    payload: {
      source_entity_id: noteEntityId,
      target_entity_id: target,
      relationship_kind_name: 'note_of',
    },
  })
  if (input.aboutEntityId?.trim()) {
    await submitAction(ctx, {
      actionKindName: 'relationship.create',
      intentKind: 'reflection',
      payload: {
        source_entity_id: noteEntityId,
        target_entity_id: input.aboutEntityId.trim(),
        relationship_kind_name: 'note_about',
      },
    })
  }
  return { noteEntityId }
}

// Edit = append-only supersession of note_body (attribute.set closes the prior value).
export async function updateNote(
  ctx: ActionContext,
  input: { noteEntityId: string; body: string },
): Promise<void> {
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('A note needs a body.')
  await submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: 'correction',
    payload: {
      entity_id: input.noteEntityId,
      attribute_kind_name: 'note_body',
      value: body,
      confidence: 1.0,
      knowability_state: 'observed',
      time_precision: 'exact_instant',
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
}

// Retire = entity.archive (status flip; the note and its history stay queryable).
export async function retireNote(ctx: ActionContext, noteEntityId: string): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'entity.archive',
    intentKind: 'adjustment',
    payload: { entity_id: noteEntityId },
  })
}
