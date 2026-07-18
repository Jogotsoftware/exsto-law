// Exposes the pure house-voice checker (api/emailVoiceChecks.ts) as a READ-mode
// MCP tool. The compose/reply modal shows advisory violation chips as the
// attorney types, but client components must not import @exsto/legal values
// directly (the package index is side-effectful) — so the pure checker rides
// over MCP like every other client-facing read. No substrate reads/writes, no
// model call: this just calls checkEmailVoice and returns its result.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import { checkEmailVoice, type VoiceViolation } from '../../api/emailVoiceChecks.js'

const emailVoiceCheckTool: Tool<
  { subject?: string; body: string },
  { violations: VoiceViolation[] }
> = {
  name: 'legal.email.voice_check',
  description:
    'Deterministic house-voice check for an email draft (em dash, banned phrases, filler adverbs, newsletter-style headers, sign-off shape) — the mechanical subset of the doctrine in templates/house-voice.md. Advisory only: returns the violation list, never blocks.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Optional; an omitted subject is treated as empty.',
      },
      body: { type: 'string' },
    },
    required: ['body'],
    additionalProperties: false,
  },
  handler: async (_ctx: ActionContext, input) => ({
    violations: checkEmailVoice(input.subject ?? '', input.body),
  }),
}

registerTool(emailVoiceCheckTool)
