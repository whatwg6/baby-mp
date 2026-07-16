import { Text, View } from '@tarojs/components'

import { PageState } from '../../components/PageState'

export default function GrowthPage() {
  return (
    <View className="page-shell">
      <View className="page-heading">
        <Text className="page-title">成长</Text>
        <Text className="page-description">查看身高与体重的变化趋势。</Text>
      </View>
      <PageState kind="empty" title="还没有测量数据" description="成长趋势功能将在后续里程碑开放。" />
    </View>
  )
}
