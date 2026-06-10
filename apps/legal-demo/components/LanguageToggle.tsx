'use client'

import { useI18n, type Lang } from '@/lib/i18n'

const LANGS: Array<{ key: Lang; label: string; aria: string }> = [
  { key: 'en', label: 'EN', aria: 'English' },
  { key: 'es', label: 'ES', aria: 'Español' },
]

export function LanguageToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.key}
          type="button"
          aria-pressed={lang === l.key}
          aria-label={l.aria}
          className={`lang-toggle-btn ${lang === l.key ? 'active' : ''}`}
          onClick={() => setLang(l.key)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
