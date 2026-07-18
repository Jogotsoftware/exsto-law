// ASSISTANT-ACTS-1 — compose a client email from chat into the firm's REAL
// composer. The assistant drafts subject + body; the chat opens an edit/send
// modal (prefilled, attachment-capable) and the ATTORNEY sends. This replaces
// the old dead-end where an "email" was a generic produce_document card and the
// model claimed it would reach a review queue it never touched. The tool itself
// writes nothing and resolves no recipient — the app owns the client's address
// (the model must never type one), and the attorney's edit-and-send in the
// composer IS the review.
import type { ClientTool } from '../adapters/claude.js'

// Everything the client needs to open the compose modal without another
// round-trip. attachDocumentTitles reference documents produced via
// produce_document THIS turn (matched client-side by exact title).
export interface EmailComposeCapture {
  subject: string
  bodyMarkdown: string
  attachDocumentTitles: string[]
}

const COMPOSE_EMAIL_TOOL_DEF = {
  name: 'compose_email',
  description:
    "Open the firm's REAL email composer for the attorney, prefilled with a draft you write, when they ask you to email, message, or send something to the CLIENT on this matter. The composer resolves the client's address itself — never type or guess an email address. This tool does NOT send anything: the attorney reviews, edits, attaches documents, and sends from the composer (their review there replaces any approval queue — never say the email is 'queued' or 'in the review queue'). To attach a document you produced THIS turn with produce_document, list its exact title in attach_document_titles. Put the email ONLY in this call; your chat reply must then be ONE short sentence pointing them to the composer. Never claim the email was sent.",
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'The email subject line.',
      },
      body_markdown: {
        type: 'string',
        description:
          'The COMPLETE email body in markdown. Do NOT include a signature block — the firm signature is appended automatically at send.',
      },
      attach_document_titles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exact titles of documents you produced with produce_document THIS turn to attach to the email (optional).',
      },
    },
    required: ['subject', 'body_markdown'],
    additionalProperties: false,
  },
}

// Build the compose_email ClientTool for this turn. run() captures the draft
// into `captured` (surfaced after the model loop as an email_compose event that
// opens the modal) and acks with the no-repeat / no-sent-claim discipline. No
// substrate write, no recipient resolution — both are the app's job.
export function buildComposeEmailTool(captured: EmailComposeCapture[]): ClientTool {
  return {
    definition: COMPOSE_EMAIL_TOOL_DEF,
    name: 'compose_email',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        subject?: string
        body_markdown?: string
        attach_document_titles?: unknown
      }
      const subject = (args.subject ?? '').trim()
      const bodyMarkdown = (args.body_markdown ?? '').trim()
      if (!bodyMarkdown) return 'No email body was provided, so the composer was not opened.'
      const attachDocumentTitles = Array.isArray(args.attach_document_titles)
        ? args.attach_document_titles
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean)
        : []
      captured.push({
        subject: subject || 'Message from your attorney',
        bodyMarkdown,
        attachDocumentTitles,
      })
      return `The composer is open for the attorney with your draft prefilled${attachDocumentTitles.length ? ` (attaching: ${attachDocumentTitles.join('; ')})` : ''}. They will review, edit, and send it themselves. Reply with ONE short sentence pointing them to the composer; do NOT repeat the email text and do NOT say it was sent or queued.`
    },
  }
}
