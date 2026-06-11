// Security boundary: the unauthenticated client portal (/api/client/mcp) may
// only reach an explicit allowlist of legal tools. A prior review found that
// without it, every registered tool — attorney research, settings, matter
// history, billable AI calls — was reachable as the public intake actor.
// This locks the boundary: research + write tools must NOT be client-callable,
// and the allowlist must contain only known-safe read/booking tools.
import { describe, it, expect } from 'vitest'
import { CLIENT_PORTAL_TOOLS, isClientPortalTool } from '@exsto/legal/mcp'
import { findTool } from '@exsto/mcp-tools'
import '@exsto/legal/mcp' // register the tools so findTool can resolve them

describe('client portal tool allowlist (no DB)', () => {
  it('blocks the research tools and attorney-only write/admin tools', () => {
    for (const blocked of [
      'legal.research.ask',
      'legal.research.list',
      'legal.draft.generate',
      'legal.settings.update',
      'legal.integration.connect',
      'legal.integration.list',
      'legal.matter.history',
      'legal.mail.reply',
    ]) {
      expect(isClientPortalTool(blocked)).toBe(false)
    }
  })

  it('allows exactly the four public booking + shared-draft tools', () => {
    expect([...CLIENT_PORTAL_TOOLS].sort()).toEqual(
      [
        'legal.booking.submit',
        'legal.calendar.availability',
        'legal.draft.get',
        'legal.service.list',
      ].sort(),
    )
  })

  it('every allowlisted tool is actually registered (no dead names)', () => {
    for (const name of CLIENT_PORTAL_TOOLS) {
      expect(findTool(name), `${name} should resolve in the registry`).toBeTruthy()
    }
  })

  it('no allowlisted tool is a write-mode tool (public portal must not mutate via attorney paths)', () => {
    // legal.booking.submit is the one intentional public write (intake); it is
    // mode:write by necessity. Everything else allowlisted must be read-mode.
    for (const name of CLIENT_PORTAL_TOOLS) {
      const tool = findTool(name) as { mode?: string } | undefined
      if (name === 'legal.booking.submit') continue
      expect(tool?.mode, `${name} should be read-mode`).toBe('read')
    }
  })
})
