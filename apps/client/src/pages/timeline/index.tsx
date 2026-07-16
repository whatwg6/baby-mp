import { Text, View } from '@tarojs/components'

import { PageState } from '../../components/PageState'

export default function TimelinePage() {
  return (
    <View className="page-shell">
      <View className="page-heading">
        <Text className="page-title">时间轴</Text>
        <Text className="page-description">按时间浏览家庭共同记录的成长片段。</Text>
      </View>
      <PageState kind="empty" title="还没有成长记录" description="记录功能将在后续里程碑开放。" />
    </View>
  )
}
