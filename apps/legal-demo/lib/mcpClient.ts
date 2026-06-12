export interface McpCall<I = unknown> {
  toolName: string
  input?: I
  // Optional CAPTCHA token for public WRITE tools. The server route reads it as
  // `body.captchaToken` and verifies it via verifyCaptchaIfConfigured (a no-op
  // until TURNSTILE_SECRET/HCAPTCHA_SECRET is set). Reads omit it.
  captchaToken?: string
}

interface McpEnvelope<O> {
  result: O
}

export async function callClientMcp<O = unknown, I = unknown>(req: McpCall<I>): Promise<O> {
  // Only include captchaToken at the body top-level when one was passed, so
  // existing read calls keep posting exactly { toolName, input } as before.
  const body: { toolName: string; input?: I; captchaToken?: string } = {
    toolName: req.toolName,
    input: req.input,
  }
  if (req.captchaToken) body.captchaToken = req.captchaToken

  const res = await fetch('/api/client/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      const parsed = body ? JSON.parse(body) : null
      detail = parsed?.error ?? body
    } catch {
      // ignore
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as McpEnvelope<O>
  return data.result
}
