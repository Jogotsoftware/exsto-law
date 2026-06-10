import { withSuperuser } from '@exsto/shared'

export interface ResolvedActor {
  actorId: string
  tenantId: string
  displayName: string
  email: string
}

// Cross-tenant lookup by email. Runs as superuser because we don't know which
// tenant the email belongs to yet — that's literally the question. Returns
// null if no active human actor with that email exists.
//
// If the same email exists in multiple tenants (future multi-firm), this
// returns the most recently created one. A real tenant picker UI is the right
// fix once that's a real scenario.
export async function lookupActorByEmail(email: string): Promise<ResolvedActor | null> {
  if (!email) return null
  return withSuperuser(async (client) => {
    const res = await client.query<{
      id: string
      tenant_id: string
      display_name: string
      email: string
    }>(
      `SELECT id, tenant_id, display_name, email
       FROM actor
       WHERE lower(email) = lower($1)
         AND actor_type = 'human'
         AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [email],
    )
    const row = res.rows[0]
    if (!row) return null
    return {
      actorId: row.id,
      tenantId: row.tenant_id,
      displayName: row.display_name,
      email: row.email,
    }
  })
}
