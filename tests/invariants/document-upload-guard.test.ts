// Guard (hard rule 9): the Supabase SERVICE-ROLE key is quarantined to exactly
// two modules — apps/legal-demo/lib/documentStorage.ts (the Storage API) and
// apps/legal-demo/lib/supabaseAdmin.ts (the GoTrue Auth admin API) — and NEITHER
// is allowed to touch the substrate Postgres tables (those go through
// DATABASE_URL + RLS + the action layer). This fails the build the moment a
// future change leaks the key elsewhere or points the service-role client at a DB
// table (a bare `.from(...)` call).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = join(process.cwd(), 'apps/legal-demo')
const STORAGE_MODULE = 'lib/documentStorage.ts'
const AUTH_ADMIN_MODULE = 'lib/supabaseAdmin.ts'
// The only modules permitted to read the privileged service-role key.
const SERVICE_ROLE_MODULES = [STORAGE_MODULE, AUTH_ADMIN_MODULE]

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

  it('the SERVICE-ROLE key (SUPABASE_SERVICE_ROLE_KEY) appears ONLY in the two quarantined modules', () => {
    // Scope this to the SERVICE-ROLE key specifically. A bare `createClient` is
    // fine elsewhere (e.g. the client portal's Supabase Auth uses the public
    // NEXT_PUBLIC_SUPABASE_ANON_KEY) — hard rule 9 is about the privileged
    // service-role key, which must stay quarantined to Storage + Auth-admin.
    const offenders = files
      .filter((f) => !SERVICE_ROLE_MODULES.some((m) => f.endsWith(m)))
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

  it('the auth-admin module uses the service-role client ONLY for Auth (never DB tables)', () => {
    const src = readFileSync(join(APP, AUTH_ADMIN_MODULE), 'utf8')
    // It must reach GoTrue via .auth.admin.*
    expect(src).toMatch(/\.auth\.admin\./)
    // No PostgREST table access on the service-role client: the only `.from(`
    // allowed is Buffer.from( — a bare client `.from(` would breach hard rule 9.
    const allFrom = (src.match(/\.from\(/g) ?? []).length
    const bufferFrom = (src.match(/Buffer\.from\(/g) ?? []).length
    expect(allFrom).toBe(bufferFrom)
  })
})
