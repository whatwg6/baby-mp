import { Button, Image, Text, View } from '@tarojs/components'
import { useState } from 'react'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { formatBabyAge } from '../../features/babies/validation'
import { loadBabies, selectBaby, useBabyState } from '../../features/babies/store'
import { platform } from '../../platform'

import './index.scss'

const roleLabels = { admin: '管理员', editor: '可编辑成员', viewer: '只读成员' }

export default function HomePage() {
  const ready = useProtectedPage()
  const state = useBabyState()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  if (!ready || state.status === 'loading' || state.status === 'idle') {
    return <View className="page-shell"><PageState kind="loading" title="正在准备宝宝空间" /></View>
  }
  if (state.status === 'error') return <View className="page-shell"><PageState kind="error" description={state.error} actionLabel="重新加载" onAction={() => void loadBabies()} /></View>
  if (!state.current) return <View className="page-shell"><View className="page-heading"><Text className="page-title">宝宝成长记</Text></View>
    <PageState kind="empty" title="先创建宝宝档案" description="创建档案后，就可以和家人一起记录成长。收到家庭邀请时也可以通过邀请加入。"
      actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} /></View>

  const baby = state.current
  const canEdit = baby.role !== 'viewer'
  return <View className="page-shell">
    <View className="baby-header-card" onClick={() => setSwitcherOpen(true)}>
      {baby.avatarUrl ? <Image className="baby-header-card__avatar" src={baby.avatarUrl} mode="aspectFill" /> : <View className="baby-header-card__avatar baby-header-card__avatar--fallback">宝</View>}
      <View className="baby-header-card__body"><Text className="baby-header-card__name">{baby.name}</Text>
        <Text className="baby-header-card__meta">{formatBabyAge(baby.birthDate)} · {roleLabels[baby.role]}</Text></View>
      <Text className="baby-header-card__arrow">⌄</Text>
    </View>
    {canEdit ? <View className="home-section"><Text className="section-title">快速记录</Text><View className="quick-actions">
      {['图文', '测量', '里程碑'].map((label) => <Button key={label} onClick={() => void platform.showToast('记录功能将在下一里程碑开放')}>{label}</Button>)}
    </View></View> : null}
    <View className="home-section"><Text className="section-title">最近记录</Text>
      <View className="surface-card first-record"><Text className="first-record__title">记录宝宝的第一个成长瞬间</Text>
        <Text className="first-record__description">这里会展示最近的家庭成长记录。</Text>
        {canEdit ? <Button className="secondary-button" onClick={() => void platform.showToast('记录功能将在下一里程碑开放')}>添加第一条记录</Button> : null}
      </View>
    </View>
    {switcherOpen ? <View className="switcher-overlay" onClick={() => setSwitcherOpen(false)}><View className="switcher-panel" onClick={(event) => event.stopPropagation()}>
      <Text className="switcher-panel__title">切换宝宝</Text>
      {state.babies.map((item) => <View className={`switcher-item${item.id === baby.id ? ' is-current' : ''}`} key={item.id}
        onClick={() => void selectBaby(item.id).then(() => setSwitcherOpen(false))}>
        <View><Text className="switcher-item__name">{item.name}</Text><Text className="switcher-item__role">{roleLabels[item.role]}</Text></View>
        <Text>{item.id === baby.id ? '✓' : ''}</Text>
      </View>)}
      <Button className="secondary-button" onClick={() => {
        setSwitcherOpen(false)
        void platform.navigateTo('/pages/babies/create')
      }}>创建宝宝</Button>
      <Button className="link-button" onClick={() => {
        setSwitcherOpen(false)
        void platform.navigateTo('/pages/babies/index')
      }}>管理宝宝档案</Button>
    </View></View> : null}
  </View>
}
