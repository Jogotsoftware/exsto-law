import type { ActionContext } from '@exsto/substrate'
import { listServices, getDocumentTemplate } from './services.js'
import { listNotificationTemplateRefs } from './notificationTemplates.js'

// Templates catalog (beta sprint Obj 9) — a single read that aggregates the
// firm's templates across THREE categories for the Templates nav tab:
//   • form     — each service's intake questionnaire
//   • document — each service's body template, per configured document kind
//   • email    — the firm's notification templates
//
// This is a pure read OVER the existing library layer (config-as-data in
// workflow_definition.transitions + the notification template set). There is NO
// parallel template store — the catalog composes the existing per-service read
// functions, so an edit through the service library shows up here immediately.

export type TemplateCategory = 'form' | 'document' | 'email'

export interface TemplateCatalogEntry {
  category: TemplateCategory
  // Stable id for routing/selection in the UI.
  key: string
  title: string
  // The owning service (null for global email templates).
  serviceKey: string | null
  serviceName: string | null
  // The document kind, for the 'document' category only.
  documentKind: string | null
  // Where the content resolves from. 'config' = attorney-authored; 'repo' =
  // bundled body; 'builtin' = system email template; 'none' = not authored yet.
  source: 'config' | 'repo' | 'builtin' | 'none' | null
  hasContent: boolean
  // The owning service's enabled state (null for email templates).
  isActive: boolean | null
}

export interface TemplatesCatalog {
  forms: TemplateCatalogEntry[]
  documents: TemplateCatalogEntry[]
  emails: TemplateCatalogEntry[]
}

function humanizeKind(kind: string): string {
  return kind.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function listTemplatesCatalog(ctx: ActionContext): Promise<TemplatesCatalog> {
  // Active services only — the Templates tab shows the firm's live templates, not
  // draft/disabled service rows (which today are only leftover test fixtures).
  const services = await listServices(ctx)

  const forms: TemplateCatalogEntry[] = services.map((svc) => {
    const fieldCount = svc.intakeSchema.sections.reduce(
      (n, sec) => n + (sec.fields?.length ?? 0),
      0,
    )
    return {
      category: 'form' as const,
      key: `form:${svc.serviceKey}`,
      title: svc.displayName,
      serviceKey: svc.serviceKey,
      serviceName: svc.displayName,
      documentKind: null,
      source: null,
      hasContent: fieldCount > 0,
      isActive: svc.isActive,
    }
  })

  // One document-template entry per (service, configured document kind). Each
  // resolves its own source/hasContent through the shared resolver.
  const documents: TemplateCatalogEntry[] = []
  for (const svc of services) {
    for (const kind of svc.documents) {
      const doc = await getDocumentTemplate(ctx, svc.serviceKey, kind)
      documents.push({
        category: 'document',
        key: `document:${svc.serviceKey}:${kind}`,
        title: `${humanizeKind(kind)} — ${svc.displayName}`,
        serviceKey: svc.serviceKey,
        serviceName: svc.displayName,
        documentKind: kind,
        source: doc?.source ?? 'none',
        hasContent: Boolean(doc?.templateText),
        isActive: svc.isActive,
      })
    }
  }

  const emails: TemplateCatalogEntry[] = listNotificationTemplateRefs().map((t) => ({
    category: 'email' as const,
    key: `email:${t.ref}`,
    title: t.title,
    serviceKey: null,
    serviceName: null,
    documentKind: null,
    source: 'builtin',
    hasContent: true,
    isActive: null,
  }))

  return { forms, documents, emails }
}
