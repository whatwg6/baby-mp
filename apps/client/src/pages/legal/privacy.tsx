import { privacyContent } from './content'
import { LegalDocument } from './LegalDocument'

import './privacy.scss'

export default function PrivacyPage() {
  return <LegalDocument content={privacyContent} />
}
