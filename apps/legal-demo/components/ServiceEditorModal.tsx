'use client'

// BUILDER-UX-2 WP-2 — the service-shell editor pop-up: the REAL shared service-settings
// form (ServiceSettingsFields — the same inputs the manual service page renders), opened
// directly in edit mode and seeded from the in-memory proposal. No View/Edit toggle, no
// JSON textarea. Save/Cancel at the top.
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { EditorActionRow } from '@/components/EditorActionRow'
import {
  ServiceSettingsFields,
  AppointmentRequiredField,
  type ServiceSettingsValue,
} from '@/components/ServiceSettingsFields'

export function ServiceEditorModal({
  title,
  initialValue,
  onSave,
  onClose,
}: {
  title: string
  initialValue: ServiceSettingsValue
  onSave: (value: ServiceSettingsValue) => Promise<void> | void
  onClose: () => void
}): React.ReactElement {
  const [value, setValue] = useState<ServiceSettingsValue>(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = value.displayName.trim().length > 0

  async function save() {
    if (!canSave) {
      setError('A display name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <EditorActionRow
        busy={busy}
        error={error}
        canSave={canSave}
        onCancel={onClose}
        onSave={save}
      />
      <ServiceSettingsFields value={value} onChange={setValue} />
      <fieldset className="svc-fieldset">
        <legend>Bookings</legend>
        <AppointmentRequiredField
          value={value.appointmentRequired}
          onChange={(v) => setValue({ ...value, appointmentRequired: v })}
        />
      </fieldset>
    </Modal>
  )
}
