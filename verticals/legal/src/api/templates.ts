import { withActionContext, type ActionContext } from '@exsto/substrate'
import { extractVariables, htmlToMarkdown, markdownToHtml } from '../templates/bodyConversion.js'

export type TemplateVariableType = 'text' | 'longtext' | 'date' | 'number' | 'email' | 'select'

export interface TemplateVariable {
  name: string
  label: string
  type: TemplateVariableType
  sample: string | null
  description: string | null
  required: boolean
  options: string[] | null // only meaningful when type === 'select'
}

export interface DocumentTemplate {
  id: string
  templateKey: string
  displayName: string
  description: string | null
  bodyMd: string
  bodyHtml: string
  variableSchema: TemplateVariable[]
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

interface TemplateRow {
  id: string
  template_key: string
  display_name: string
  description: string | null
  body_md: string
  body_html: string | null
  variable_schema: TemplateVariable[] | null
  is_active: boolean
  sort_order: number
  updated_at: Date
}

function rowToTemplate(r: TemplateRow): DocumentTemplate {
  const bodyMd = r.body_md ?? ''
  const bodyHtml = r.body_html ?? (bodyMd ? markdownToHtml(bodyMd) : '')
  return {
    id: r.id,
    templateKey: r.template_key,
    displayName: r.display_name,
    description: r.description,
    bodyMd,
    bodyHtml,
    variableSchema: Array.isArray(r.variable_schema) ? r.variable_schema : [],
    isActive: r.is_active,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at.toISOString(),
  }
}

const SELECT_COLUMNS = `id, template_key, display_name, description, body_md, body_html, variable_schema, is_active, sort_order, updated_at`

export async function listTemplates(ctx: ActionContext): Promise<DocumentTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM document_template
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY sort_order, display_name`,
      [ctx.tenantId],
    )
    return res.rows.map(rowToTemplate)
  })
}

export async function getTemplate(
  ctx: ActionContext,
  templateKey: string,
): Promise<DocumentTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM document_template
       WHERE tenant_id = $1 AND template_key = $2`,
      [ctx.tenantId, templateKey],
    )
    const r = res.rows[0]
    return r ? rowToTemplate(r) : null
  })
}

export interface CreateTemplateInput {
  templateKey?: string // auto-generated from displayName if omitted
  displayName: string
  description?: string | null
  bodyMd?: string
  bodyHtml?: string
  variableSchema?: TemplateVariable[]
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'template'
  )
}

async function uniqueKey(
  client: import('@exsto/shared').DbClient,
  tenantId: string,
  base: string,
): Promise<string> {
  let key = base
  let n = 2
  while (true) {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM document_template WHERE tenant_id = $1 AND template_key = $2`,
      [tenantId, key],
    )
    if (res.rows.length === 0) return key
    key = `${base}_${n}`
    n += 1
  }
}

export async function createTemplate(
  ctx: ActionContext,
  input: CreateTemplateInput,
): Promise<DocumentTemplate> {
  return withActionContext(ctx, async (client) => {
    const baseKey = input.templateKey?.trim() || slugify(input.displayName)
    const key = await uniqueKey(client, ctx.tenantId, baseKey)

    // Normalize both bodies. Editor sends HTML; we derive markdown.
    const bodyHtml = input.bodyHtml ?? (input.bodyMd ? markdownToHtml(input.bodyMd) : '')
    const bodyMd = input.bodyMd ?? (bodyHtml ? htmlToMarkdown(bodyHtml) : '')
    const schema = input.variableSchema ?? []

    const res = await client.query<TemplateRow>(
      `INSERT INTO document_template
         (tenant_id, template_key, display_name, description, body_md, body_html, variable_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${SELECT_COLUMNS}`,
      [
        ctx.tenantId,
        key,
        input.displayName,
        input.description ?? null,
        bodyMd,
        bodyHtml,
        JSON.stringify(schema),
      ],
    )
    return rowToTemplate(res.rows[0]!)
  })
}

export interface CloneTemplateInput {
  templateKey: string // source
  newDisplayName?: string // defaults to "<source> (copy)"
  newTemplateKey?: string // defaults to "<source>_copy" (collision-free)
}

export async function cloneTemplate(
  ctx: ActionContext,
  input: CloneTemplateInput,
): Promise<DocumentTemplate> {
  return withActionContext(ctx, async (client) => {
    const src = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM document_template
       WHERE tenant_id = $1 AND template_key = $2`,
      [ctx.tenantId, input.templateKey],
    )
    const row = src.rows[0]
    if (!row) throw new Error(`Template not found: ${input.templateKey}`)
    const baseKey = input.newTemplateKey?.trim() || `${row.template_key}_copy`
    const key = await uniqueKey(client, ctx.tenantId, baseKey)
    const displayName = input.newDisplayName?.trim() || `${row.display_name} (copy)`

    const res = await client.query<TemplateRow>(
      `INSERT INTO document_template
         (tenant_id, template_key, display_name, description, body_md, body_html, variable_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${SELECT_COLUMNS}`,
      [
        ctx.tenantId,
        key,
        displayName,
        row.description,
        row.body_md,
        row.body_html,
        JSON.stringify(row.variable_schema ?? []),
      ],
    )
    return rowToTemplate(res.rows[0]!)
  })
}

export async function deleteTemplate(
  ctx: ActionContext,
  templateKey: string,
): Promise<{ deleted: boolean }> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query(
      `DELETE FROM document_template WHERE tenant_id = $1 AND template_key = $2`,
      [ctx.tenantId, templateKey],
    )
    return { deleted: (res.rowCount ?? 0) > 0 }
  })
}

export interface UpdateTemplateInput {
  templateKey: string
  displayName?: string
  description?: string | null
  bodyHtml?: string // canonical source from the editor
  bodyMd?: string // optional override if the caller is markdown-native
  variableSchema?: TemplateVariable[]
  isActive?: boolean
}

export async function updateTemplate(
  ctx: ActionContext,
  input: UpdateTemplateInput,
): Promise<DocumentTemplate> {
  // Convert HTML → markdown server-side so the drafting prompt stays markdown.
  let bodyHtml = input.bodyHtml ?? null
  let bodyMd = input.bodyMd ?? null
  if (bodyHtml !== null && bodyMd === null) {
    bodyMd = htmlToMarkdown(bodyHtml)
  } else if (bodyMd !== null && bodyHtml === null) {
    bodyHtml = markdownToHtml(bodyMd)
  }

  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(
      `UPDATE document_template
       SET display_name     = COALESCE($3, display_name),
           description      = COALESCE($4, description),
           body_md          = COALESCE($5, body_md),
           body_html        = COALESCE($6, body_html),
           variable_schema  = COALESCE($7::jsonb, variable_schema),
           is_active        = COALESCE($8, is_active),
           updated_at       = now()
       WHERE tenant_id = $1 AND template_key = $2
       RETURNING ${SELECT_COLUMNS}`,
      [
        ctx.tenantId,
        input.templateKey,
        input.displayName ?? null,
        input.description ?? null,
        bodyMd,
        bodyHtml,
        input.variableSchema ? JSON.stringify(input.variableSchema) : null,
        input.isActive ?? null,
      ],
    )
    const r = res.rows[0]
    if (!r) throw new Error(`Template not found: ${input.templateKey}`)
    return rowToTemplate(r)
  })
}

// Re-export the conversion helpers — the create/clone APIs use them but
// frontend code (e.g. PDF import) also needs them.
export { extractVariables, htmlToMarkdown, markdownToHtml }
