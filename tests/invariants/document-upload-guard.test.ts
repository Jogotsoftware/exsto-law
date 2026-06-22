// Guard (hard rule 9): the Supabase SERVICE-ROLE key and storage client are
// quarantined to ONE module — apps/legal-demo/lib/documentStorage.ts — and used
// ONLY for the Storage API, never against the substrate Postgres tables (those go
// through DATABASE_URL + RLS). This fails the build the moment a future change
// leaks the key elsewhere or points the service-role client at a DB table.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = join(process.cwd(), 'apps/legal-demo')
const STORAGE_MODULE = 'lib/documentStorage.ts'

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkTs(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

describe('document upload — service-role isolation (hard rule 9)', () => {
  const files = walkTs(APP)

  it('the SERVICE-ROLE key (SUPABASE_SERVICE_ROLE_KEY) appears ONLY in lib/documentStorage.ts', () => {
    // Scope this to the SERVICE-ROLE key specifically. A bare `createClient` is
    // fine elsewhere (e.g. the client portal's Supabase Auth uses the public
    // NEXT_PUBLIC_SUPABASE_ANON_KEY) — hard rule 9 is about the privileged
    // service-role key, which must stay quarantined to the storage module.
    const offenders = files
      .filter((f) => !f.endsWith(STORAGE_MODULE))
      .filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(APP.length + 1))
    expect(offenders).toEqual([])
  })

  it('the storage module uses the service-role client ONLY for Storage (never DB tables)', () => {
    const src = readFileSync(join(APP, STORAGE_MODULE), 'utf8')
    // It must reach Storage via .storage.from(...).
    expect(src).toMatch(/\.storage\.from\(/)
    // Every `.from(` must be either `.storage.from(` (Storage access) or
    // `Buffer.from(` — NEVER a bare client `.from(` (postgREST table access on
    // the service-role client, which would breach hard rule 9).
    const allFrom = (src.match(/\.from\(/g) ?? []).length
    const storageFrom = (src.match(/\.storage\.from\(/g) ?? []).length
    const bufferFrom = (src.match(/Buffer\.from\(/g) ?? []).length
    expect(allFrom).toBe(storageFrom + bufferFrom)
  })
})
