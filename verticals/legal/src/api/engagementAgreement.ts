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
import type { ActionContext } from '@exsto/substrate'
import { callClaudeDrafter } from '../adapters/claude.js'
import { createTemplate } from './standaloneTemplates.js'
import { setEngagementTemplate, getEngagementTemplate } from './engagement.js'
import { getStandaloneTemplate } from '../queries/templates.js'
import { getContact } from '../queries/contacts.js'
import { getTenantSettings } from './tenantSettings.js'
import { renderTemplate, longDate } from './templateMerge.js'
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

export async function getClientEngagementAgreement(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientEngagementAgreement | null> {
  const pointer = await getEngagementTemplate(ctx)
  if (!pointer) return null
  const [template, contact, settings] = await Promise.all([
    getStandaloneTemplate(ctx, pointer.template_id),
    getContact(ctx, clientContactId),
    getTenantSettings(ctx),
  ])
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
  }
  const rendered = renderTemplate(template.body, data)
  // The contact has no stored street address — an address block that cannot
  // fill is dropped rather than shown as a broken marker to the client.
  const markdown = rendered.markdown
    .split('\n')
    .filter((line) => line.trim() !== '[[MISSING: client_address]]')
    .join('\n')

  const details = pointer.details as { signer_label?: unknown }
  return {
    markdown,
    templateId: pointer.template_id,
    templateVersion: pointer.version,
    missingFields: rendered.missingFields.filter((f) => f !== 'client_address'),
    signerLabel: typeof details.signer_label === 'string' ? details.signer_label : null,
  }
}
