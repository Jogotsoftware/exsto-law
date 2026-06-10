import { randomUUID } from 'crypto'
import type { Hlc } from '@exsto/shared'

// HLC source_id is stable per process instance.
// Multiple HLCs from the same process share this identifier, so distributed
// ordering can disambiguate clock collisions across processes (invariant 15,
// ADR 0015).
const SOURCE_ID = randomUUID()

let lastPhysicalMs = 0
let lastLogical = 0

export function nextHlc(): Hlc {
  const now = Date.now()
  if (now > lastPhysicalMs) {
    lastPhysicalMs = now
    lastLogical = 0
  } else {
    lastLogical += 1
  }

  return {
    physical_time: new Date(lastPhysicalMs).toISOString(),
    logical_counter: lastLogical,
    source_id: SOURCE_ID,
  }
}

export function currentSourceId(): string {
  return SOURCE_ID
}
