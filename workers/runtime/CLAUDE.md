# Worker runtime package

This package contains the runtime for background worker jobs.

## Rules

- Worker jobs must execute with tenant context set via `withTenant`.
- Worker handlers should be registered in `src/handlers` and invoked from the dispatcher.
- The runtime is not a place for business rules; it is an execution host for registered handlers.
