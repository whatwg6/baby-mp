import { Text, View } from '@tarojs/components'

import { PageState } from '../../components/PageState'

export default function ProfilePage() {
  return (
    <View className="page-shell">
      <View className="page-heading">
        <Text className="page-title">我的</Text>
        <Text className="page-description">管理宝宝档案、家庭成员与隐私设置。</Text>
      </View>
      <PageState kind="empty" title="设置入口准备中" description="账号与家庭管理将在后续里程碑开放。" />
    </View>
  )
}
