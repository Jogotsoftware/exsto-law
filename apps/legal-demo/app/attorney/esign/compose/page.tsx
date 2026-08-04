'use client'

// ESIGN-UNIFY-1 (ES-5, design §8) — the unified EsignComposer, full-page. THE
// deep-linkable eSign entry point: with no params it opens in any-PDF upload
// mode (the eSign list's "eSign" CTA, chat's blank launches); with
// ?documentVersionId=… it opens in document mode on that version (the review
// reader + runner review toolbar's "eSign" action navigates here with the
// matter pre-attached).
import { Suspense, type ReactElement } from 'react'
import { useSearchParams } from 'next/navigation'
import { EsignComposer } from '@/components/esign/EsignComposer'
import { composerSourceFromParams } from '@/lib/esignComposeSource'

function ComposerFromParams(): ReactElement {
  const params = useSearchParams()
  const source = composerSourceFromParams((k) => params.get(k))

  return (
    <div className="li-esign li-esign-prepare">
      <div className="li-esign-head">
        <div>
          <h1 className="li-esign-title">eSign</h1>
        </div>
      </div>
      <div className="li-esign-wiz-card">
        <EsignComposer source={source} />
      </div>
    </div>
  )
}

export default function EsignComposePage(): ReactElement {
  // useSearchParams requires a Suspense boundary for prerender (Next 15).
  return (
    <Suspense fallback={null}>
      <ComposerFromParams />
    </Suspense>
  )
}
