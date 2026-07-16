import { Text, View } from '@tarojs/components'
import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { useBabyState } from '../../features/babies/store'
import { platform } from '../../platform'

export default function GrowthPage() {
  useProtectedPage(); const state = useBabyState()
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">成长</Text>
    <Text className="page-description">{state.current ? `查看${state.current.name}的身高与体重变化。` : '查看身高与体重的变化趋势。'}</Text></View>
    {!state.current ? <PageState kind="empty" title="先创建宝宝档案" actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} />
      : <PageState kind="empty" title="还没有测量数据" description="添加身高或体重后，成长趋势会显示在这里。" />}
  </View>
}
