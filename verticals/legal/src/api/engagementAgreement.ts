// ENGAGEMENT-DOC-1 P2 — turn the attorney's uploaded engagement letter into the
// firm's engagement-agreement TEMPLATE, in one recorded flow:
//
//   parsed letter markdown ──AI──▶ template body ({{merge fields}} for the
//   client-specific values, {{sign:client}}/{{date:client}} markers for the
//   acceptance block) + parsed details (rates, retainer) ──▶ createTemplate
//   (template_esign_config: client signs, firm pre-signed) ──▶
//   legal.firm.set_engagement_template pointer.
//
// The AI step deliberately KEEPS every word of the firm's letter — it converts,
// it does not rewrite. Firm constants (rates, retainer, addresses) stay literal
// text; only the counterparty identity becomes merge fields, using the canonical
// MERGE_SLOT_FIELDS ids so buildMergeData fills them without new plumbing.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { callClaudeDrafter } from '../adapters/claude.js'
import { createTemplate } from './standaloneTemplates.js'
import { setEngagementTemplate, getEngagementTemplate } from './engagement.js'
import {
  readContactEngagementOverride,
  readMatterEngagementOverride,
} from '../handlers/engagement.js'
import { getStandaloneTemplate } from '../queries/templates.js'
import { getContact } from '../queries/contacts.js'
import { getTenantSettings } from './tenantSettings.js'
import { renderTemplate, longDate } from './templateMerge.js'
import { readFirmDefault, formatRateUsd } from './rates.js'
import {
  DETAILS_DELIM,
  parseImportOutput,
  type EngagementAgreementDetails,
} from './engagementImportParse.js'
import { ENGAGEMENT_LETTER_DOC_KIND, hasDefaultEngagementLetter } from './engagementLibrary.js'

export interface EngagementAgreementImportResult {
  templateId: string
  templateName: string
  body: string
  details: EngagementAgreementDetails
  version: number
  /** True when this letter became the firm default (the first one added). */
  isDefault: boolean
}

export { parseImportOutput, type EngagementAgreementDetails }

// Unfenced JSON after ===DETAILS=== on purpose: callClaudeDrafter's
// splitDocumentAndTrace claims a TRAILING fenced ```json block as the reasoning
// trace — a fenced details block would be eaten before we ever saw it.
function buildImportPrompt(letterMarkdown: string): string {
  return [
    "You are converting a law firm's existing engagement letter into a reusable merge template.",
    'Rules — follow exactly:',
    "1. PRESERVE the letter's full text, structure, and ordering. Do not rewrite, summarize, or improve the language. Output GitHub-flavored markdown.",
    '2. Replace ONLY the client-specific values with these merge tokens (use them verbatim, do not invent new field names):',
    "   {{company_name}} — the client entity/company name; {{client_name}} — the individual signer's full name; {{client_email}} — the client's email; {{client_address}} — the client's street address block; {{letter_date}} — the letter's date line.",
    '3. Keep every firm-side constant LITERAL: firm name/address, attorney name/email/phone, hourly rates, retainer amounts, all Terms of Engagement text.',
    "4. The firm's own signature block stays literal text (it is pre-signed): keep the attorney name; render the signature line as the attorney's name in italics.",
    '5. Rebuild the CLIENT acceptance block at the end as:',
    '   a "By:" line containing exactly {{sign:client}}',
    '   a line with {{client_name}}',
    '   a line with the signer title from the letter (literal text)',
    '   a "Dated:" line containing exactly {{date:client}}',
    '6. After the document, output a line containing exactly ' +
      DETAILS_DELIM +
      ' followed by ONE line of raw JSON (no code fence):',
    '   {"hourly_rate":"…","litigation_rate":"…","retainer":"…","attorney_name":"…","signer_label":"…"}',
    '   Use decimal strings for money (e.g. "350.00"); omit keys the letter does not state. signer_label = the client signer\'s title ("Managing Member", …).',
    '',
    'The letter:',
    '',
    letterMarkdown,
  ].join('\n')
}

// Derive a human template name from the uploaded filename ("Engagement
// Letter_Mi Rey LLC_2026.pdf" → "Engagement Letter Mi Rey LLC 2026"), else a
// generic default. The attorney renames it in the template editor.
function engagementLetterName(sourceFilename?: string): string {
  const stem = (sourceFilename ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return stem || 'Engagement Agreement'
}

export async function importEngagementAgreement(
  ctx: ActionContext,
  input: { markdown: string; sourceFilename?: string; name?: string },
): Promise<EngagementAgreementImportResult> {
  const letter = input.markdown.trim()
  if (!letter) throw new Error('The uploaded document contained no readable text.')

  const res = await callClaudeDrafter(ctx.tenantId, {
    task: 'draft_generate',
    prompt: buildImportPrompt(letter),
    maxTokens: 16_000,
  })
  const { body, details } = parseImportOutput(res.documentMarkdown)
  if (!body.includes('{{sign:client}}')) {
    throw new Error(
      'The converted agreement is missing its client signature marker — try the upload again.',
    )
  }

  const template = await createTemplate(ctx, {
    name: input.name?.trim() || engagementLetterName(input.sourceFilename),
    category: 'document',
    // ENGAGEMENT-TEMPLATES-1 — tag it so the engagement-letter library can list
    // it (it's an ordinary standalone template otherwise, editable in the editor).
    docKind: ENGAGEMENT_LETTER_DOC_KIND,
    body,
    esignConfig: {
      signable: true,
      roles: [
        {
          key: 'client',
          label: details.signer_label ?? 'Client',
          recipientRole: 'needs_to_sign',
          // The engagement gate is firm-level and PRE-matter: the signer is
          // whichever portal client is accepting, resolved by the gate flow at
          // send time — no matter/contact-role bind can know that ahead of time.
          bind: 'manual',
          order: 1,
        },
      ],
    },
  })

  // Library semantics: the FIRST engagement letter a firm adds becomes the
  // default; later uploads just join the library (the attorney picks the default
  // in settings) so a new upload never silently replaces the live agreement.
  const alreadyHasDefault = await hasDefaultEngagementLetter(ctx)
  let version = 1
  let isDefault = false
  if (!alreadyHasDefault) {
    const set = await setEngagementTemplate(ctx, {
      templateId: template.templateEntityId,
      sourceFilename: input.sourceFilename,
      details: details as Record<string, unknown>,
    })
    version = set.version ?? 1
    isDefault = true
  }

  return {
    templateId: template.templateEntityId,
    templateName: template.name,
    body,
    details,
    version,
    isDefault,
  }
}

// ── P4 — the client-facing merged agreement ──────────────────────────────────
// The gate renders the FULL agreement, merged for THIS client, before acceptance.
// {{sign:client}} / {{date:client}} markers survive the merge (SLOT_RE has no
// colon) — the portal UI swaps them for the live signature line and date.
export interface ClientEngagementAgreement {
  markdown: string
  templateId: string
  templateVersion: number
  /** Merge slots that stayed unfilled — the UI shows an honest heads-up. */
  missingFields: string[]
  signerLabel: string | null
}

// ENGAGEMENT-TEMPLATES-1 Phase 2 — the per-contact engagement-letter override.
// getContactEngagementOverride returns the template id THIS client signs instead
// of the firm default, or null. Tolerant of the 0191 kind not existing yet.
export async function getContactEngagementOverride(
  ctx: ActionContext,
  clientContactId: string,
): Promise<string | null> {
  return withActionContext(ctx, (client) =>
    readContactEngagementOverride(client, ctx.tenantId, clientContactId),
  )
}

// Attorney picks which engagement letter a specific client signs (templateId), or
// clears it back to the firm default (null).
export async function setContactEngagementLetter(
  ctx: ActionContext,
  clientContactId: string,
  templateId: string | null,
): Promise<{ templateId: string | null }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.contact.set_engagement_letter',
    intentKind: 'adjustment',
    payload: { client_contact_id: clientContactId, template_id: templateId },
  })
  const eff = res.effects[0] as { template_id: string | null }
  return { templateId: eff.template_id }
}

// ENGAGEMENT-TEMPLATES-1 Phase 3 — the per-matter override (migration 0192). The
// engagement letter chosen for a specific matter, or null to defer to the
// per-contact override / firm default. Tolerant of the 0192 kind not existing.
export async function getMatterEngagementOverride(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<string | null> {
  return withActionContext(ctx, (client) =>
    readMatterEngagementOverride(client, ctx.tenantId, matterEntityId),
  )
}

// Attorney picks which engagement letter applies to a specific matter (templateId),
// or clears it back to the contact override / firm default (null).
export async function setMatterEngagementLetter(
  ctx: ActionContext,
  matterEntityId: string,
  templateId: string | null,
): Promise<{ templateId: string | null }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.matter.set_engagement_letter',
    intentKind: 'adjustment',
    payload: { matter_entity_id: matterEntityId, template_id: templateId },
  })
  const eff = res.effects[0] as { template_id: string | null }
  return { templateId: eff.template_id }
}

// Resolve the matter-level override that applies to THIS client's gate. The gate
// is per-contact and one-time, so we look across the contact's matters (same three
// relationship paths the CRM uses): if any matter carries an engagement-letter
// override, it sets the letter. Most recently created matter wins the tiebreak
// when several do. Null when none — the caller falls back to the contact override
// / firm default. Safe before 0192 applies (the kind join returns nothing → null).
export async function resolveContactMatterOverride(
  ctx: ActionContext,
  clientContactId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ template_id: string | null }>(
      `WITH contact_matter AS (
         SELECT r.target_entity_id AS matter_id
           FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
          WHERE r.tenant_id = $1 AND r.source_entity_id = $2::uuid
            AND rkd.kind_name = 'client_of' AND (r.valid_to IS NULL OR r.valid_to > now())
         UNION
         SELECT r.source_entity_id AS matter_id
           FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
          WHERE r.tenant_id = $1 AND r.target_entity_id = $2::uuid
            AND rkd.kind_name = 'matter_has_client' AND (r.valid_to IS NULL OR r.valid_to > now())
         UNION
         SELECT mo.source_entity_id AS matter_id
           FROM relationship co
           JOIN relationship_kind_definition cok ON cok.id = co.relationship_kind_id AND cok.kind_name = 'contact_of'
           JOIN relationship mo ON mo.target_entity_id = co.target_entity_id
           JOIN relationship_kind_definition mok ON mok.id = mo.relationship_kind_id AND mok.kind_name = 'matter_of'
          WHERE co.tenant_id = $1 AND co.source_entity_id = $2::uuid
            AND (co.valid_to IS NULL OR co.valid_to > now())
            AND (mo.valid_to IS NULL OR mo.valid_to > now())
       ),
       latest AS (
         SELECT DISTINCT ON (a.entity_id)
                a.entity_id, a.value #>> '{}' AS template_id, m.created_at
           FROM attribute a
           JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           JOIN entity m ON m.id = a.entity_id
          WHERE a.tenant_id = $1
            AND akd.kind_name = 'matter_engagement_letter_override'
            AND a.entity_id IN (SELECT matter_id FROM contact_matter)
          ORDER BY a.entity_id, a.valid_from DESC
       )
       SELECT template_id FROM latest
        WHERE template_id IS NOT NULL AND template_id <> ''
        ORDER BY created_at DESC
        LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    return res.rows[0]?.template_id?.trim() || null
  })
}

// The client's effective hourly rate for the engagement letter's rate merge slots:
// their client entity's explicit client_billable_rate if set (resolved via the
// contact's client parent, contact_of → client), otherwise the firm default. Both
// are decimal strings (ADR 0044) or null when unset.
export async function resolveContactEffectiveRate(
  ctx: ActionContext,
  clientContactId: string,
): Promise<{ firmDefault: string | null; effective: string | null }> {
  return withActionContext(ctx, async (client) => {
    const firmDefault = await readFirmDefault(client, ctx.tenantId)
    const own = await client.query<{ rate: string | null }>(
      `SELECT a.value #>> '{}' AS rate
         FROM relationship co
         JOIN relationship_kind_definition cok
           ON cok.id = co.relationship_kind_id AND cok.kind_name = 'contact_of'
         JOIN attribute a ON a.entity_id = co.target_entity_id
         JOIN attribute_kind_definition akd
           ON akd.id = a.attribute_kind_id AND akd.kind_name = 'client_billable_rate'
        WHERE co.tenant_id = $1 AND co.source_entity_id = $2::uuid
          AND (co.valid_to IS NULL OR co.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    const ownRate = own.rows[0]?.rate ?? null
    return { firmDefault, effective: ownRate ?? firmDefault }
  })
}

export async function getClientEngagementAgreement(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientEngagementAgreement | null> {
  // ENGAGEMENT-TEMPLATES-1 Phase 2 — resolve which letter THIS client signs:
  // their per-contact override if set, else the firm default. Always falls back
  // to the default (founder). getContactEngagementOverride is tolerant of the
  // 0191 kind not existing yet (returns null → default).
  const [contactOverride, matterOverride, pointer, contact, settings, rate] = await Promise.all([
    getContactEngagementOverride(ctx, clientContactId),
    resolveContactMatterOverride(ctx, clientContactId),
    getEngagementTemplate(ctx),
    getContact(ctx, clientContactId),
    getTenantSettings(ctx),
    resolveContactEffectiveRate(ctx, clientContactId),
  ])
  // Most-specific-wins: a matter override (a letter chosen for this client's
  // matter) beats the per-contact override, which beats the firm default.
  const override = matterOverride ?? contactOverride
  const defaultId = pointer?.template_id ?? null
  if (!override && !defaultId) return null

  // Prefer the override; if it points at a retired/missing template, fall back to
  // the firm default (never recurse).
  let template = override ? await getStandaloneTemplate(ctx, override) : null
  if (!template && defaultId && defaultId !== override) {
    template = await getStandaloneTemplate(ctx, defaultId)
  }
  if (!template || !contact) return null

  const now = new Date().toISOString()
  const clientName = contact.fullName?.trim() || undefined
  const data: Record<string, string | undefined> = {
    // An individual client without a company signs in their own name — the
    // letter then addresses the person, which is the correct reading, so
    // {{company_name}} deliberately falls back to the client's name.
    company_name: contact.companyName?.trim() || clientName,
    client_name: clientName,
    primary_client_name: clientName,
    client_email: contact.email?.trim() || undefined,
    letter_date: longDate(now),
    today: longDate(now),
    effective_date: longDate(now),
    firm_name: settings.firmName ?? undefined,
    attorney_name: settings.attorneyName ?? undefined,
    firm_email: settings.firmEmail ?? undefined,
    firm_phone: settings.firmPhone ?? undefined,
    firm_address: settings.firmAddress ?? undefined,
    // Rate merge slots (ENGAGEMENT-TEMPLATES-1 follow-up) — the letter shows the
    // firm's LIVE rate instead of a literal that drifts. firm_hourly_rate is the
    // firm default; client_hourly_rate is this client's effective rate (their own
    // negotiated rate if set, else the firm default). Both currency-formatted.
    firm_hourly_rate: formatRateUsd(rate.firmDefault),
    client_hourly_rate: formatRateUsd(rate.effective),
  }
  const rendered = renderTemplate(template.body, data)
  // The contact has no stored street address — an address block that cannot
  // fill is dropped rather than shown as a broken marker to the client.
  const markdown = rendered.markdown
    .split('\n')
    .filter((line) => line.trim() !== '[[MISSING: client_address]]')
    .join('\n')

  // signer_label lives on the firm-default pointer's parsed details; it only
  // applies when the resolved template IS the default (an override letter has no
  // stored details — its signer label falls back to null, filled by the letter's
  // own text).
  const usedDefault = template.templateEntityId === defaultId
  const details = (usedDefault ? pointer?.details : undefined) as
    | { signer_label?: unknown }
    | undefined
  return {
    markdown,
    templateId: template.templateEntityId,
    templateVersion: pointer?.version ?? 1,
    missingFields: rendered.missingFields.filter((f) => f !== 'client_address'),
    signerLabel: typeof details?.signer_label === 'string' ? details.signer_label : null,
  }
}
