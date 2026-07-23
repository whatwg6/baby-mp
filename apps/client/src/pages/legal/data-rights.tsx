import { View } from '@tarojs/components'

import { DataRightsRequestPanel } from '../../features/data-rights/DataRightsRequestPanel'
import { dataRightsContent } from './content'
import { LegalDocument } from './LegalDocument'

import './data-rights.scss'

export default function DataRightsPage() {
  return (
    <>
      <LegalDocument content={dataRightsContent} />
      <View className="page-shell data-rights-page__actions">
        <DataRightsRequestPanel />
      </View>
    </>
  )
}
