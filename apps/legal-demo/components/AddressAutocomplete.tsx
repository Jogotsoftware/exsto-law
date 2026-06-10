'use client'

import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'

export interface StructuredAddress {
  formatted_address: string
  street: string
  city: string
  state: string
  postal_code: string
  country: string
  lat: number | null
  lng: number | null
}

interface Props {
  label: string
  required?: boolean
  value?: StructuredAddress | null
  onChange: (value: StructuredAddress | null) => void
}

let placesPromise: Promise<google.maps.PlacesLibrary> | null = null

function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  if (placesPromise) return placesPromise
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  if (!apiKey) {
    placesPromise = Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'))
    return placesPromise
  }
  setOptions({ key: apiKey, v: 'weekly' })
  placesPromise = importLibrary('places')
  return placesPromise
}

// Field-level address autocomplete backed by Google Places. Stores a
// structured address on selection. Falls back to a plain text input if the
// Google library can't load (e.g. no API key in dev) — the typed string still
// goes into formatted_address.
export function AddressAutocomplete({ label, required, value, onChange }: Props) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const acRef = useRef<google.maps.places.Autocomplete | null>(null)
  const [text, setText] = useState(value?.formatted_address ?? '')
  const [loadError, setLoadError] = useState<string | null>(null)
  const fieldId = useId()

  // Keep the latest onChange in a ref so the place_changed listener (installed
  // once on mount) doesn't capture a stale parent closure. Without this,
  // clicking a Google suggestion would call onChange with a reference to parent
  // state from mount time and clobber any field edits made since.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    let cancelled = false
    let placeListener: google.maps.MapsEventListener | null = null
    let attachedAc: google.maps.places.Autocomplete | null = null
    loadPlaces()
      .then((places) => {
        if (cancelled || !inputRef.current) return
        const ac = new places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'address_components', 'geometry'],
          types: ['address'],
        })
        placeListener = ac.addListener('place_changed', () => {
          const place = ac.getPlace()
          // Use the live input value as a fallback in case Google's place
          // payload is missing formatted_address (happens occasionally with
          // partial matches and certain place types).
          const liveInputValue = inputRef.current?.value ?? ''
          const parsed = parsePlace(place, liveInputValue)
          if (parsed) {
            setText(parsed.formatted_address)
            onChangeRef.current(parsed)
            return
          }
          const raw = (place.name ?? liveInputValue ?? '').trim()
          if (raw) {
            setText(raw)
            onChangeRef.current({
              formatted_address: raw,
              street: '',
              city: '',
              state: '',
              postal_code: '',
              country: '',
              lat: null,
              lng: null,
            })
          }
        })
        attachedAc = ac
        acRef.current = ac
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      if (placeListener) {
        google.maps.event.removeListener(placeListener)
      }
      if (attachedAc) {
        google.maps.event.clearInstanceListeners(attachedAc)
      }
    }
  }, [])

  return (
    <label htmlFor={fieldId}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        id={fieldId}
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={text}
        placeholder={t('addr.placeholder')}
        onChange={(e) => {
          setText(e.target.value)
          // Free-typed text is stored as a partial; selecting a suggestion
          // overwrites it with the structured address.
          onChange({
            formatted_address: e.target.value,
            street: '',
            city: '',
            state: '',
            postal_code: '',
            country: '',
            lat: null,
            lng: null,
          })
        }}
        onBlur={() => {
          // Defensive commit: whatever is currently visible in the input gets
          // written to parent state. Catches the case where Google's
          // place_changed fired but didn't propagate (e.g. partial match,
          // selection-by-keyboard quirks). Without this, the user sees an
          // address but validation reads empty state.
          const live = inputRef.current?.value?.trim() ?? ''
          if (!live) return
          if (value?.formatted_address?.trim() === live) return
          setText(live)
          onChangeRef.current({
            formatted_address: live,
            street: value?.street ?? '',
            city: value?.city ?? '',
            state: value?.state ?? '',
            postal_code: value?.postal_code ?? '',
            country: value?.country ?? '',
            lat: value?.lat ?? null,
            lng: value?.lng ?? null,
          })
        }}
      />
      {loadError && (
        <div className="help" style={{ color: 'var(--warn)' }}>
          {t('addr.unavailable')}
        </div>
      )}
    </label>
  )
}

function parsePlace(
  place: google.maps.places.PlaceResult,
  fallbackFormatted?: string,
): StructuredAddress | null {
  const formatted = place.formatted_address || fallbackFormatted?.trim() || ''
  if (!formatted) return null
  const comps = place.address_components ?? []
  const get = (type: string, useShort = false): string => {
    const c = comps.find((c) => c.types.includes(type))
    if (!c) return ''
    return useShort ? c.short_name : c.long_name
  }
  const streetNumber = get('street_number')
  const route = get('route')
  return {
    formatted_address: formatted,
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: get('locality') || get('postal_town') || get('sublocality_level_1'),
    state: get('administrative_area_level_1', true),
    postal_code: get('postal_code'),
    country: get('country', true),
    lat: place.geometry?.location?.lat() ?? null,
    lng: place.geometry?.location?.lng() ?? null,
  }
}
