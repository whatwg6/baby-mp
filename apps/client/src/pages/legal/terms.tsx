import { termsContent } from './content'
import { LegalDocument } from './LegalDocument'

import './terms.scss'

export default function TermsPage() {
  return <LegalDocument content={termsContent} />
}
