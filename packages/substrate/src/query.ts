import type { ActionContext } from './context.js'
import { withActionContext } from './context.js'
import { withSpan } from '@exsto/shared'
import type { QueryResultRow } from 'pg'

export interface QueryResult<T extends QueryResultRow> {
  rows: T[]
  rowCount: number | null
}

// Read-side query helper that runs under the action context so RLS is engaged.
// Uses the same transaction-scoped session vars as write paths, so it sees
// the caller's own writes.
export async function executeQuery<T extends QueryResultRow>(
  ctx: ActionContext,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return withSpan('substrate.query', () =>
    withActionContext(ctx, async (client) => {
      const result = await client.query<T>(sql, params)
      return { rows: result.rows, rowCount: result.rowCount }
    }),
  )
}
