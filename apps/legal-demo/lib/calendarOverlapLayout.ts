// Pure overlap-layout algorithm for the weekly/day hourly calendar grids
// (LI calendar comp-fidelity: "stacked events should show the same way this
// calendar does" — Google-Calendar-style side-by-side lanes, not a cascading
// inset). No DOM/React — just minutes-from-midnight in, column geometry out —
// so it's cheaply unit-testable and shared by every grid that positions timed
// events (the main attorney calendar AND the dashboard/matter "This week"
// widget).
//
// Algorithm (two passes, both O(n log n) for n events in a day):
//   1. Cluster: sweep events sorted by start time; consecutive events that
//      overlap the RUNNING cluster end (not just their immediate neighbor)
//      join the same cluster. This is the fix for the naive "pairwise overlap
//      group" approach (compare each event only to the others it directly
//      overlaps): a three-event chain A–B–C where A and C don't overlap each
//      other would otherwise get inconsistent per-event column counts (A vs C
//      each see only 2 neighbors, B sees 3) and visibly uneven widths.
//   2. Column assignment within a cluster: greedy interval-graph coloring —
//      each event takes the first column whose last-placed event already
//      ended by this event's start; otherwise it opens a new column. Every
//      event in the cluster shares that cluster's column COUNT (so widths
//      are consistent within the cluster), but only actually-overlapping
//      events end up in the same column-time-slice.

export interface OverlapInput {
  /** Unique within the set passed to one layoutOverlappingEvents() call. */
  id: string
  /** Minutes from an arbitrary common reference (e.g. midnight of the day). */
  startMin: number
  /** Must be > startMin; callers should clamp degenerate/zero-length events. */
  endMin: number
}

export interface OverlapResult {
  id: string
  /** 0-based lane within this event's overlap cluster. */
  columnIndex: number
  /** Total lanes in this event's cluster — width = 100 / columnCount. */
  columnCount: number
}

/**
 * Lay out a day's timed events into side-by-side columns. Events that don't
 * overlap anything get columnIndex 0 / columnCount 1 (full width). Order and
 * count of the returned array always matches the input array.
 */
export function layoutOverlappingEvents(events: OverlapInput[]): OverlapResult[] {
  if (events.length === 0) return []

  // Guard degenerate/inverted ranges so a bad endMin can't wedge the sweep.
  const normalized = events.map((e) => ({
    ...e,
    endMin: Math.max(e.endMin, e.startMin + 1),
  }))
  const sorted = [...normalized].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const results = new Map<string, OverlapResult>()
  let cluster: typeof sorted = []
  let clusterEnd = -Infinity

  const flushCluster = () => {
    if (cluster.length === 0) return
    assignColumns(cluster, results)
    cluster = []
  }

  for (const ev of sorted) {
    if (cluster.length > 0 && ev.startMin >= clusterEnd) {
      flushCluster()
      clusterEnd = -Infinity
    }
    cluster.push(ev)
    clusterEnd = Math.max(clusterEnd, ev.endMin)
  }
  flushCluster()

  // Return in the caller's original order (Map lookup, not sort order).
  return events.map((e) => {
    const r = results.get(e.id)
    // Unreachable in practice (every input id is placed exactly once above),
    // but keeps this total instead of throwing on a caller's duplicate id.
    return r ?? { id: e.id, columnIndex: 0, columnCount: 1 }
  })
}

function assignColumns(
  cluster: Array<{ id: string; startMin: number; endMin: number }>,
  out: Map<string, OverlapResult>,
): void {
  // columnEnds[c] = endMin of the last event placed in column c so far.
  const columnEnds: number[] = []
  const columnOf = new Map<string, number>()

  for (const ev of cluster) {
    let placed = -1
    for (let c = 0; c < columnEnds.length; c++) {
      if (columnEnds[c]! <= ev.startMin) {
        placed = c
        break
      }
    }
    if (placed === -1) {
      placed = columnEnds.length
      columnEnds.push(ev.endMin)
    } else {
      columnEnds[placed] = ev.endMin
    }
    columnOf.set(ev.id, placed)
  }

  const columnCount = columnEnds.length
  for (const ev of cluster) {
    out.set(ev.id, { id: ev.id, columnIndex: columnOf.get(ev.id)!, columnCount })
  }
}

/** leftPct/widthPct convenience for callers that just want CSS percentages. */
export function overlapResultToPct(r: OverlapResult): { leftPct: number; widthPct: number } {
  return { leftPct: (r.columnIndex * 100) / r.columnCount, widthPct: 100 / r.columnCount }
}
