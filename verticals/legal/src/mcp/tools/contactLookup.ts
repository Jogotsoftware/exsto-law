import { registerTool, type Tool } from '@exsto/mcp-tools'
import { withActionContext, type ActionContext } from '@exsto/substrate'

interface Input {
  entityId: string
}

interface Output {
  entityId: string
  kind: 'client_contact' | 'referral_partner' | 'other_attorney' | null
}

// Cheap lookup the contact detail page uses to figure out which kind-specific
// route/render to use. Returns null if the entity doesn't exist or isn't a
// contact-shaped kind.
registerTool({
  name: 'legal.contact.lookup',
  description:
    'Resolve an entity id to its contact kind (client_contact, referral_partner, other_attorney) so the UI can route to the right detail view.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    return withActionContext(ctx, async (client) => {
      const res = await client.query<{ kind_name: string }>(
        `SELECT ekd.kind_name
         FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE e.tenant_id = $1 AND e.id = $2`,
        [ctx.tenantId, input.entityId],
      )
      const kind = res.rows[0]?.kind_name as Output['kind']
      const valid: Output['kind'][] = ['client_contact', 'referral_partner', 'other_attorney']
      return { entityId: input.entityId, kind: kind && valid.includes(kind) ? kind : null }
    })
  },
} satisfies Tool<Input, Output>)
