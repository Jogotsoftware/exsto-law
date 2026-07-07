// Guard (hard rule 9, worker extension): in the VERTICAL + WORKER trees the
// Supabase SERVICE-ROLE key is quarantined to exactly one module —
// verticals/legal/src/adapters/storage.ts (the read-only Storage adapter the
// document-review worker uses) — and that module must never touch the substrate
// Postgres tables (those go through DATABASE_URL + RLS) and must stay
// DOWNLOAD-ONLY (no upload/remove/signed-URL surface; writes belong to the
// app's quarantined documentStorage module). Mirrors
// tests/invariants/document-upload-guard.test.ts, which covers apps/legal-demo.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = [join(process.cwd(), 'verticals'), join(process.cwd(), 'workers')]
const STORAGE_MODULE = 'verticals/legal/src/adapters/storage.ts'

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

describe('vertical/worker storage — service-role isolation (hard rule 9)', () => {
  const files = ROOTS.flatMap((r) => walkTs(r))

  it('SUPABASE_SERVICE_ROLE_KEY appears ONLY in the quarantined storage adapter', () => {
    const offenders = files
      .filter((f) => !f.endsWith(STORAGE_MODULE))
      .filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1))
    expect(offenders).toEqual([])
  })

  it('the adapter uses the service-role client ONLY for Storage (never DB tables)', () => {
    const src = readFileSync(join(process.cwd(), STORAGE_MODULE), 'utf8')
    expect(src).toMatch(/\.storage\.from\(/)
    // Every `.from(` must be `.storage.from(` or `Buffer.from(` — a bare client
    // `.from(` would be PostgREST table access on the privileged client.
    const allFrom = (src.match(/\.from\(/g) ?? []).length
    const storageFrom = (src.match(/\.storage\.from\(/g) ?? []).length
    const bufferFrom = (src.match(/Buffer\.from\(/g) ?? []).length
    expect(allFrom).toBe(storageFrom + bufferFrom)
  })

  it('the adapter is DOWNLOAD-ONLY (no upload/remove/move/signed URLs)', () => {
    const src = readFileSync(join(process.cwd(), STORAGE_MODULE), 'utf8')
    for (const forbidden of ['.upload(', '.remove(', '.move(', '.copy(', 'createSignedUrl']) {
      expect(src.includes(forbidden), `adapter must not call ${forbidden}`).toBe(false)
    }
  })
})
