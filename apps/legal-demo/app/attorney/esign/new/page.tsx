// ESIGN-UNIFY-1 (ES-5, design §8/§11) — the old any-PDF wizard route is gone
// (NewEnvelopeWizard deleted with it); old links land on the ONE composer.
import { redirect } from 'next/navigation'

export default function NewEnvelopePage(): never {
  redirect('/attorney/esign/compose')
}
