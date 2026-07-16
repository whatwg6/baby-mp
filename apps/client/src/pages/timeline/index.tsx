import { Text, View } from '@tarojs/components'
import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { useBabyState } from '../../features/babies/store'
import { platform } from '../../platform'

export default function TimelinePage() {
  useProtectedPage(); const state = useBabyState()
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">时间轴</Text>
    <Text className="page-description">{state.current ? `${state.current.name}的成长片段` : '按时间浏览家庭共同记录的成长片段。'}</Text></View>
    {!state.current ? <PageState kind="empty" title="先创建宝宝档案" actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} />
      : <PageState kind="empty" title="还没有成长记录" description="第一条成长记录会在这里出现。" />}
  </View>
}
