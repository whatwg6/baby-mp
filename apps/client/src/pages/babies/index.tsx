import { Button, Image, Text, View } from '@tarojs/components'
import { useEffect } from 'react'

import { PageState } from '../../components/PageState'
import { loadBabies, selectBaby, useBabyState } from '../../features/babies/store'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { platform } from '../../platform'

import './index.scss'

export default function BabiesPage() {
  const ready = useProtectedPage()
  const state = useBabyState()
  useEffect(() => { if (ready) void loadBabies().catch(() => undefined) }, [ready])
  return <View className="page-shell"><View className="page-heading"><Text className="page-title">宝宝档案</Text>
    <Text className="page-description">选择当前宝宝，或管理你有权限的档案。</Text></View>
    {state.status === 'loading' ? <PageState kind="loading" /> : null}
    {state.status === 'error' ? <PageState kind="error" description={state.error} actionLabel="重新加载" onAction={() => void loadBabies()} /> : null}
    {state.status === 'ready' && state.babies.length === 0 ? <PageState kind="empty" title="还没有宝宝档案" actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} /> : null}
    {state.babies.map((baby) => <View className="surface-card list-card" key={baby.id} onClick={() => void selectBaby(baby.id)}>
      {baby.avatarUrl
        ? <Image className="baby-list-avatar" src={baby.avatarUrl} mode="aspectFill" lazyLoad />
        : <View className="baby-list-avatar baby-list-avatar--fallback">宝</View>}
      <View className="baby-list-body"><Text className="list-card__title">{baby.name}{state.current?.id === baby.id ? ' · 当前' : ''}</Text><Text className="list-card__meta">{baby.role}</Text></View>
      {baby.role === 'admin' ? <Button className="link-button" onClick={(event) => { event.stopPropagation(); void platform.navigateTo(`/pages/babies/edit?id=${baby.id}`) }}>编辑</Button> : null}
    </View>)}
    {state.babies.length > 0 ? <Button className="secondary-button" onClick={() => void platform.navigateTo('/pages/babies/create')}>创建另一个宝宝</Button> : null}
  </View>
}
