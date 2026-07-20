import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listSkillCatalog,
  getSkillBySlug,
  createSkill,
  updateSkill,
  archiveSkill,
  type Skill,
  type SkillCatalogEntry,
  type UpsertSkillInput,
  type UpdateSkillInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Skills — reusable legal playbooks (ported from claude-for-legal), stored as
// substrate data so the firm can edit positions or add a skill without a code
// change. These tools are the sibling adapter over the SAME legal.skill.* actions
// the chatbot's load_skill tool reads (ADR 0024/0038 — one core). Attorney-only
// (not in CLIENT_PORTAL_TOOLS; clientPolicy.ts is default-deny).

const listTool: Tool<Record<string, never>, { skills: SkillCatalogEntry[] }> = {
  name: 'legal.skill.list',
  description:
    "List the firm's assistant skills (legal playbooks) — slug, name, practice area, description, when-to-use, and jurisdiction (if the skill is jurisdiction-specific). The lightweight catalog, without the (long) bodies.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ skills: await listSkillCatalog(ctx) }),
}

const getTool: Tool<{ slug: string }, { skill: Skill | null }> = {
  name: 'legal.skill.get',
  description: 'Fetch one skill by slug, including its full instruction body.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { slug: { type: 'string' } },
    required: ['slug'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ skill: await getSkillBySlug(ctx, input.slug) }),
}

const createTool: Tool<UpsertSkillInput, { skill: Skill }> = {
  name: 'legal.skill.create',
  description:
    'Create a skill: a stable slug, a name, a practice area, a when-to-use trigger, and the instruction body (markdown). Optionally a one-line description, userInvocable (default true), and jurisdiction (a US state code/name if this skill is jurisdiction-SPECIFIC, e.g. a Delaware-only playbook — leave unset for a jurisdiction-neutral skill).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Stable id, e.g. commercial.nda-review.' },
      name: { type: 'string' },
      practiceArea: { type: 'string' },
      description: { type: 'string' },
      whenToUse: { type: 'string', description: 'When the assistant should load this skill.' },
      body: { type: 'string', description: 'The full instruction markdown.' },
      userInvocable: { type: 'boolean' },
      jurisdiction: {
        type: 'string',
        description:
          'US state code or name this skill is SPECIFIC to (e.g. "DE" or "Delaware"). A matter resolved to a DIFFERENT jurisdiction never auto-loads this skill. Leave unset for a jurisdiction-neutral skill.',
      },
    },
    required: ['slug', 'name', 'practiceArea', 'whenToUse', 'body'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ skill: await createSkill(ctx, input) }),
}

const updateTool: Tool<UpdateSkillInput, { skill: Skill | null }> = {
  name: 'legal.skill.update',
  description:
    'Update a skill (by skillEntityId or slug): any of name / practiceArea / description / whenToUse / body / userInvocable / jurisdiction. Append-only: a new attribute version supersedes the prior. Send jurisdiction: "" to clear it back to jurisdiction-neutral.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      skillEntityId: { type: 'string' },
      slug: { type: 'string' },
      name: { type: 'string' },
      practiceArea: { type: 'string' },
      description: { type: 'string' },
      whenToUse: { type: 'string' },
      body: { type: 'string' },
      userInvocable: { type: 'boolean' },
      jurisdiction: {
        type: 'string',
        description: 'US state code or name this skill is SPECIFIC to; "" clears it.',
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ skill: await updateSkill(ctx, input) }),
}

const archiveTool: Tool<{ skillEntityId: string }, { skillEntityId: string; archived: true }> = {
  name: 'legal.skill.archive',
  description:
    'Archive a skill (status archived — kept as history, dropped from active listings). Append-only via the core entity.archive.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { skillEntityId: { type: 'string' } },
    required: ['skillEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => archiveSkill(ctx, input.skillEntityId),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
