// ITEM 1 (assistant full context): a matter-scoped chat must feed the model the
// matter's real content — email BODIES, intake answers (and transcripts/drafts) —
// not just subject lines, controlled by a depth setting, WITHOUT leaking client
// PII to the external research framing. This seeds a matter with an email body +
// intake answer and pins: bodies read returns the full body; `full` context
// carries body + intake inside the untrusted-data delimiter; `framing` carries
// neither (nor the client email); and depth scales the prompt (lean < balanced).
// DB-gated; no model key needed.
import { describe, it, expect, afterAll } from 'vitest'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import { buildMatterAssistantContext, matterCommunicationBodies } from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'
import { closeDbPool } from '@exsto/shared'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PUBLIC_INTAKE = '00000000-0000-0000-0001-000000000005'
const ctx: ActionContext = { tenantId: TENANT, actorId: PUBLIC_INTAKE }

run('assistant context depth + privacy boundary (live DB)', { timeout: 120_000 }, () => {
  const tag = `ctxd-${Date.now()}`
  const emailMarker = `${tag}-EMAILMARKER`
  const intakeMarker = `${tag}-INTAKEMARKER`
  const clientEmail = `${tag}@pilot.test`
  // ~1200 chars: longer than the lean cap (800) so lean truncates it, shorter
  // than the balanced cap (1500) so balanced keeps it whole.
  const emailBody = `${emailMarker} ${'word '.repeat(240)}`.trim()

  afterAll(async () => {
    await closeDbPool()
  })

  it('grounds the model in email bodies + intake, keeps them out of framing, and scales with depth', async () => {
    const intake = await submitAction(ctx, {
      actionKindName: 'intake.submit',
      intentKind: 'enforcement',
      payload: {
        client_full_name: `${tag} Dana`,
        client_email: clientEmail,
        client_phone: null,
        client_company_name: `${tag} Co`,
        service_key: 'nc_llc_single_member',
        intake_form_id: null,
        intake_responses: { dissolution_plan: intakeMarker },
      },
    })
    const { clientEntityId: contactId, questionnaireEntityId } = intake.effects[0] as {
      clientEntityId: string
      questionnaireEntityId: string
    }

    const opened = await submitAction(ctx, {
      actionKindName: 'matter.open',
      intentKind: 'enforcement',
      payload: {
        service_key: 'nc_llc_single_member',
        workflow_route: 'manual',
        client_entity_id: contactId,
        questionnaire_entity_id: questionnaireEntityId,
        client_display_name: `${tag} Co`,
      },
    })
    const matterId = (opened.effects[0] as { matterEntityId: string }).matterEntityId

    // Ingest an email whose full body lives in content_blob (not just a preview).
    await submitAction(ctx, {
      actionKindName: 'mail.ingest',
      intentKind: 'automatic_sync',
      payload: {
        gmail_thread_id: `${tag}-thread`,
        subject: `${tag} subject`,
        participant_emails: [clientEmail],
        matter_entity_id: matterId,
        messages: [
          {
            gmail_message_id: `${tag}-m1`,
            from: clientEmail,
            to: 'firm@pilot.test',
            sent_at: null,
            body_text: emailBody,
          },
        ],
      },
    })

    // The new read returns the FULL body (not the 280-char preview).
    const bodies = await matterCommunicationBodies(ctx, matterId, {
      maxMessages: 5,
      maxBodyChars: 2000,
    })
    expect(bodies.some((b) => b.body.includes(emailMarker))).toBe(true)
    expect(bodies.some((b) => b.body.length > 280)).toBe(true)

    // Balanced full context: email body + intake answer, wrapped in the
    // untrusted-data guard. Framing leaks none of it (nor the client email).
    const balanced = await buildMatterAssistantContext(ctx, matterId, 'balanced')
    expect(balanced).toBeTruthy()
    expect(balanced!.full).toContain(emailMarker)
    expect(balanced!.full).toContain(intakeMarker)
    expect(balanced!.full).toContain('BEGIN MATTER DATA')
    expect(balanced!.framing).not.toContain(emailMarker)
    expect(balanced!.framing).not.toContain(intakeMarker)
    expect(balanced!.framing).not.toContain(clientEmail)

    // Depth scales the prompt: lean truncates the body (cap 800) so its context
    // is strictly shorter than balanced's, while still grounding in the marker.
    const lean = await buildMatterAssistantContext(ctx, matterId, 'lean')
    const generous = await buildMatterAssistantContext(ctx, matterId, 'generous')
    expect(lean!.full).toContain(emailMarker)
    expect(lean!.full.length).toBeLessThan(balanced!.full.length)
    expect(balanced!.full.length).toBeLessThanOrEqual(generous!.full.length)
  })
})
