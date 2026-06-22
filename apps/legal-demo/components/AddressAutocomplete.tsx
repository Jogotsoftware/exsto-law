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

// Minimal local typings for the Places API (NEW) surface we use — kept local so
// this component doesn't depend on a specific @types/google.maps version having
// the new classes. (Migrated off the legacy google.maps.places.Autocomplete
// widget, which Google no longer serves to projects created after March 2025.)
interface GAddressComponent {
  longText?: string | null
  shortText?: string | null
  types: string[]
}
interface GPlace {
  formattedAddress?: string | null
  addressComponents?: GAddressComponent[]
  location?: { lat(): number; lng(): number } | null
  fetchFields(opts: { fields: string[] }): Promise<unknown>
}
interface GPlacePrediction {
  placeId: string
  text: { toString(): string }
  toPlace(): GPlace
}
interface GSuggestion {
  placePrediction?: GPlacePrediction | null
}
interface GPlacesLib {
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string
      sessionToken?: unknown
      region?: string
      language?: string
    }): Promise<{ suggestions: GSuggestion[] }>
  }
  AutocompleteSessionToken: new () => unknown
}

let placesPromise: Promise<GPlacesLib> | null = null

function loadPlaces(): Promise<GPlacesLib> {
  if (placesPromise) return placesPromise
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  if (!apiKey) {
    placesPromise = Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'))
    return placesPromise
  }
  setOptions({ key: apiKey, v: 'weekly' })
  // The Places library (loaded via the Maps JavaScript API) carries both the new
  // AutocompleteSuggestion data API and the session-token type.
  placesPromise = importLibrary('places') as unknown as Promise<GPlacesLib>
  return placesPromise
}

interface Suggestion {
  id: string
  label: string
  prediction: GPlacePrediction
}

const EMPTY = (formatted: string): StructuredAddress => ({
  formatted_address: formatted,
  street: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  lat: null,
  lng: null,
})

// Field-level address autocomplete backed by the Google Places API (New). The
// attorney/client types into a normal (form-styled) input; we fetch predictions
// from AutocompleteSuggestion and render our own dropdown, so a selection writes
// a fully structured address. Degrades to a plain text input (the typed string
// goes into formatted_address) when the Google library can't load — e.g. no API
// key, or the key lacks Maps JavaScript API / Places API (New) access.
export function AddressAutocomplete({ label, required, value, onChange }: Props) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState(value?.formatted_address ?? '')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Surfaced when the Places *lookup* itself fails (key loaded, but the request is
  // rejected — e.g. Places API (New) not enabled, or an HTTP-referrer restriction).
  // Previously this failed silently, which read to the user as "nothing happens".
  const [lookupError, setLookupError] = useState<string | null>(null)
  const fieldId = useId()

  const libRef = useRef<GPlacesLib | null>(null)
  const tokenRef = useRef<unknown>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the latest onChange so async selection callbacks never call a stale
  // parent closure (which would clobber edits made since mount).
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    let cancelled = false
    loadPlaces()
      .then((lib) => {
        if (cancelled) return
        libRef.current = lib
        tokenRef.current = new lib.AutocompleteSessionToken()
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (blurRef.current) clearTimeout(blurRef.current)
    }
  }, [])

  async function fetchSuggestions(input: string) {
    const lib = libRef.current
    if (!lib || input.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    try {
      const { suggestions: raw } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: tokenRef.current ?? undefined,
        region: 'us',
        language: 'en-US',
      })
      const mapped: Suggestion[] = (raw ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is GPlacePrediction => Boolean(p))
        .map((p) => ({ id: p.placeId, label: p.text.toString(), prediction: p }))
      setSuggestions(mapped)
      setOpen(mapped.length > 0)
      setLookupError(null)
    } catch (err) {
      // A failed lookup (key restricted to wrong referrer, Places API (New) not
      // enabled, billing/quota) yields no suggestions. Surface it instead of
      // failing silently, and log the full error for diagnosis. The typed text is
      // still committed as a partial address.
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[AddressAutocomplete] Places lookup failed:', msg)
      setLookupError(msg)
      setSuggestions([])
      setOpen(false)
    }
  }

  function onType(v: string) {
    setText(v)
    // Commit the typed text as a partial immediately, so validation/state reflect
    // what's visible even before (or without) a suggestion is chosen.
    onChange(EMPTY(v))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void fetchSuggestions(v), 250)
  }

  async function select(s: Suggestion) {
    try {
      const place = s.prediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'addressComponents', 'location'] })
      const parsed = parsePlace(place, s.label)
      const addr = parsed ?? EMPTY(s.label)
      setText(addr.formatted_address)
      onChangeRef.current(addr)
    } catch {
      setText(s.label)
      onChangeRef.current(EMPTY(s.label))
    } finally {
      setSuggestions([])
      setOpen(false)
      // A fresh session token starts the next autocomplete session (billing).
      const lib = libRef.current
      if (lib) tokenRef.current = new lib.AutocompleteSessionToken()
    }
  }

  return (
    <label htmlFor={fieldId}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <div style={{ position: 'relative' }}>
        <input
          id={fieldId}
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={text}
          placeholder={t('addr.placeholder')}
          aria-autocomplete="list"
          aria-expanded={open}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          onBlur={() => {
            // Close after a tick so an onMouseDown selection still registers.
            blurRef.current = setTimeout(() => setOpen(false), 150)
            // Defensive commit: whatever is visible gets written to parent state,
            // preserving any structured fields already resolved for this address.
            const live = inputRef.current?.value?.trim() ?? ''
            if (!live || value?.formatted_address?.trim() === live) return
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
        {open && suggestions.length > 0 && (
          <ul
            role="listbox"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 50,
              margin: '2px 0 0',
              padding: 0,
              listStyle: 'none',
              background: 'var(--surface, #fff)',
              border: '1px solid var(--border, #d1d5db)',
              borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {suggestions.map((s) => (
              <li
                key={s.id}
                role="option"
                aria-selected={false}
                // onMouseDown (not onClick) + preventDefault so the input's onBlur
                // doesn't fire and cancel the selection first.
                onMouseDown={(e) => {
                  e.preventDefault()
                  void select(s)
                }}
                style={{ padding: '0.5rem 0.7rem', cursor: 'pointer', fontSize: '0.9rem' }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--surface-2, #f3f4f6)')
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {loadError && (
        <div className="help" style={{ color: 'var(--warn)' }}>
          {t('addr.unavailable')}
        </div>
      )}
      {!loadError && lookupError && (
        <div className="help" style={{ color: 'var(--warn)' }}>
          {t('addr.unavailable')}
        </div>
      )}
    </label>
  )
}

function parsePlace(place: GPlace, fallbackFormatted?: string): StructuredAddress | null {
  const formatted = place.formattedAddress || fallbackFormatted?.trim() || ''
  if (!formatted) return null
  const comps = place.addressComponents ?? []
  const get = (type: string, useShort = false): string => {
    const c = comps.find((c) => c.types.includes(type))
    if (!c) return ''
    return (useShort ? c.shortText : c.longText) ?? ''
  }
  const streetNumber = get('street_number')
  const route = get('route')
  let lat: number | null = null
  let lng: number | null = null
  try {
    lat = place.location?.lat() ?? null
    lng = place.location?.lng() ?? null
  } catch {
    lat = null
    lng = null
  }
  return {
    formatted_address: formatted,
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: get('locality') || get('postal_town') || get('sublocality_level_1'),
    state: get('administrative_area_level_1', true),
    postal_code: get('postal_code'),
    country: get('country', true),
    lat,
    lng,
  }
}
