import net from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { closeDbPool, withSuperuser } from '@exsto/shared'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

const results: CheckResult[] = []

function record(name: string, status: CheckResult['status'], detail: string): void {
  results.push({ name, status, detail })
  const symbol = status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗'
  const color = status === 'pass' ? '\x1b[32m' : status === 'warn' ? '\x1b[33m' : '\x1b[31m'
  console.log(`${color}${symbol}\x1b[0m ${name.padEnd(42)} ${detail}`)
}

async function checkDatabaseUrl(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    record('DATABASE_URL set', 'fail', 'Missing; set it in .env.local')
    return
  }
  record('DATABASE_URL set', 'pass', maskUrl(process.env.DATABASE_URL))
}

async function checkDatabaseReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  try {
    await withSuperuser(async (client) => {
      await client.query('SELECT 1')
    })
    record('Database reachable', 'pass', 'SELECT 1 succeeded')
    return true
  } catch (error) {
    record('Database reachable', 'fail', error instanceof Error ? error.message : String(error))
    return false
  }
}

async function checkMigrationsApplied(): Promise<boolean> {
  try {
    const required = [
      'tenant',
      'actor',
      'action_kind_definition',
      'action',
      'entity_kind_definition',
      'attribute_kind_definition',
      'relationship_kind_definition',
      'entity',
      'attribute',
      'relationship',
      'reasoning_trace',
      'raw_event_log',
      'content_blob',
      'document_version',
    ]
    const missing: string[] = []
    await withSuperuser(async (client) => {
      const res = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [required],
      )
      const present = new Set(res.rows.map((r) => r.table_name))
      for (const t of required) {
        if (!present.has(t)) missing.push(t)
      }
    })
    if (missing.length > 0) {
      record('Migrations applied', 'fail', `missing tables: ${missing.join(', ')}`)
      return false
    }
    record('Migrations applied', 'pass', `all ${required.length} tables present`)
    return true
  } catch (error) {
    record('Migrations applied', 'fail', error instanceof Error ? error.message : String(error))
    return false
  }
}

async function checkSeedDataPresent(): Promise<void> {
  try {
    let counts = { matters: 0, questionnaires: 0, transcripts: 0, drafts: 0 }
    await withSuperuser(async (client) => {
      const matterRes = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name = 'matter'`,
        [TENANT_ID],
      )
      counts.matters = matterRes.rows[0]?.c ?? 0

      const qRes = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name = 'questionnaire_response'`,
        [TENANT_ID],
      )
      counts.questionnaires = qRes.rows[0]?.c ?? 0

      const tRes = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE e.tenant_id = $1 AND ekd.kind_name = 'transcript'`,
        [TENANT_ID],
      )
      counts.transcripts = tRes.rows[0]?.c ?? 0

      const dRes = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM document_version
         WHERE tenant_id = $1`,
        [TENANT_ID],
      )
      counts.drafts = dRes.rows[0]?.c ?? 0
    })

    if (counts.matters === 0) {
      record('Demo seed data present', 'fail', 'no matters found — run pnpm seed:demo')
      return
    }
    if (counts.questionnaires === 0 || counts.transcripts === 0 || counts.drafts === 0) {
      record(
        'Demo seed data present',
        'warn',
        `partial: matters=${counts.matters} q=${counts.questionnaires} t=${counts.transcripts} drafts=${counts.drafts}`,
      )
      return
    }
    record(
      'Demo seed data present',
      'pass',
      `${counts.matters} matter(s), ${counts.questionnaires} questionnaire(s), ${counts.transcripts} transcript(s), ${counts.drafts} draft version(s)`,
    )
  } catch (error) {
    record('Demo seed data present', 'fail', error instanceof Error ? error.message : String(error))
  }
}

async function checkVerticalLedger(): Promise<void> {
  try {
    let n = 0
    await withSuperuser(async (client) => {
      const res = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM private.vertical_migration`,
      )
      n = res.rows[0]?.c ?? 0
    })
    if (n >= 6) {
      record('Vertical migrations applied', 'pass', `${n} recorded in private.vertical_migration`)
    } else {
      record(
        'Vertical migrations applied',
        'fail',
        `only ${n} recorded — run pnpm migrate:vertical`,
      )
    }
  } catch (error) {
    record(
      'Vertical migrations applied',
      'fail',
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function checkIntegrationConnections(): Promise<void> {
  try {
    const rows: Array<{ provider: string; status: string; account_email: string | null }> = []
    await withSuperuser(async (client) => {
      const res = await client.query<{
        provider: string
        status: string
        account_email: string | null
      }>(
        `SELECT provider, status, account_email FROM legal_integration_connection
         WHERE tenant_id = $1 ORDER BY provider`,
        [TENANT_ID],
      )
      rows.push(...res.rows)
    })
    const google = rows.find((r) => r.provider === 'google')
    if (google?.status === 'connected') {
      record('Google connection', 'pass', `connected as ${google.account_email ?? '?'}`)
    } else if (google?.status === 'error') {
      record('Google connection', 'warn', 'connection in ERROR state — reconnect in Settings')
    } else {
      record(
        'Google connection',
        'warn',
        'not connected — calendar sync, invites, and email use fallbacks until connected in Settings',
      )
    }
    const granola = rows.find((r) => r.provider === 'granola')
    record(
      'Granola connection',
      granola?.status === 'connected' ? 'pass' : 'warn',
      granola?.status === 'connected'
        ? 'connected'
        : 'not connected — call ingestion uses the stub driver until connected in Settings',
    )
  } catch (error) {
    record(
      'Integration connections',
      'fail',
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function checkAnthropicKey(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    record(
      'ANTHROPIC_API_KEY set',
      'warn',
      'Missing — Regenerate Draft button will fail at demo time',
    )
    return
  }
  record('ANTHROPIC_API_KEY set', 'pass', 'present')

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await client.messages.create({
      model: process.env.LEGAL_DRAFTING_MODEL ?? 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    })
    const text = res.content.find((b) => b.type === 'text')
    if (text && text.type === 'text' && text.text.toLowerCase().includes('ok')) {
      record('Anthropic API reachable', 'pass', `model ${res.model} replied`)
    } else {
      record(
        'Anthropic API reachable',
        'warn',
        'Unexpected response; API works but reply was off-shape',
      )
    }
  } catch (error) {
    record(
      'Anthropic API reachable',
      'fail',
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function checkPortAvailable(port: number, label: string): Promise<void> {
  const inUse = await isPortInUse(port)
  if (inUse) {
    record(`Port ${port} (${label})`, 'warn', 'already in use — process may already be running')
  } else {
    record(`Port ${port} (${label})`, 'pass', 'free')
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolveOuter) => {
    const tester = net.createServer()
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolveOuter(true)
      } else {
        resolveOuter(false)
      }
    })
    tester.once('listening', () => {
      tester.close(() => resolveOuter(false))
    })
    tester.listen(port, '127.0.0.1')
  })
}

function maskUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ':***@')
}

function checkOauthStateSecret(): void {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s) {
    record(
      'OAUTH_STATE_SECRET set',
      'fail',
      'Missing — Google sign-in + calendar/mail connect FAIL CLOSED. Generate: openssl rand -base64 32',
    )
    return
  }
  if (s.length < 16) {
    record('OAUTH_STATE_SECRET set', 'fail', `Too short (${s.length} chars); need ≥16.`)
    return
  }
  record('OAUTH_STATE_SECRET set', 'pass', 'present (≥16 chars)')
}

async function main(): Promise<void> {
  console.log('Pacheco Law wedge — pre-flight check\n')

  await checkDatabaseUrl()
  const dbReachable = await checkDatabaseReachable()
  let migrationsOk = false
  if (dbReachable) {
    migrationsOk = await checkMigrationsApplied()
    if (migrationsOk) {
      await checkSeedDataPresent()
    }
  }
  if (dbReachable) {
    await checkVerticalLedger()
    await checkIntegrationConnections()
  }
  await checkAnthropicKey()
  checkOauthStateSecret()
  await checkPortAvailable(4000, 'MCP server')
  await checkPortAvailable(3000, 'Web app (attorney + portal)')

  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  console.log('')
  if (failed > 0) {
    console.log(`\x1b[31m${failed} check(s) failed.\x1b[0m Fix above issues before demo time.`)
    process.exit(1)
  }
  if (warned > 0) {
    console.log(`\x1b[33m${warned} warning(s).\x1b[0m Demo can proceed; review warnings.`)
  } else {
    console.log('\x1b[32mAll checks passed.\x1b[0m The demo is ready.')
  }
}

main()
  .then(async () => {
    await closeDbPool()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('Preflight crashed:', error)
    try {
      await closeDbPool()
    } catch {
      // ignore
    }
    process.exit(1)
  })
