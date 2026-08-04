'use client'

// Calendar page — a thin wrapper over the shared CalendarWorkspace component
// (UIWALK-1). The home page embeds the SAME component, so the two calendars
// are identical by construction; all calendar logic lives in
// components/CalendarWorkspace.tsx.
import { CalendarWorkspace } from '@/components/CalendarWorkspace'

export default function CalendarPage() {
  return (
    <main>
      <CalendarWorkspace />
    </main>
  )
}
