// Consistent error envelope for the REST adapter. Every failure returns
// { error: { code, message, details? } } with an appropriate HTTP status.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
}

// Map an operation (handler) error name to an HTTP status. The core throws plain
// Errors today; named substrate errors get a precise status, everything else is
// an operation failure (422 — understood, but could not be completed).
const STATUS_BY_NAME: Record<string, { status: number; code: string }> = {
  TenancyViolation: { status: 403, code: 'tenancy_violation' },
  GovernanceDenied: { status: 403, code: 'governance_denied' },
  ContestationDetected: { status: 409, code: 'contestation_detected' },
}

export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
    }
  }
  const name = err instanceof Error ? err.name : ''
  const mapped = STATUS_BY_NAME[name]
  const message = err instanceof Error ? err.message : String(err)
  if (mapped) {
    return { status: mapped.status, body: { error: { code: mapped.code, message } } }
  }
  // A handler reached the core and threw: the request was understood but the
  // operation could not be completed.
  return { status: 422, body: { error: { code: 'operation_failed', message } } }
}
