import { Button, Image, Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { formatBabyAge } from '../../features/babies/validation'
import {
  getBabyContext,
  loadBabies,
  refreshBabiesAfterAccessError,
  selectBaby,
  useBabyState,
} from '../../features/babies/store'
import { listRecords } from '../../features/records/api'
import { RecordCard } from '../../features/records/RecordCard'
import type { GrowthRecord, RecordType } from '../../features/records/types'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './index.scss'

const roleLabels = { admin: '管理员', editor: '可编辑成员', viewer: '只读成员' }
const quickRecordTypes: Array<{ label: string; type: RecordType }> = [
  { label: '图文', type: 'note' },
  { label: '测量', type: 'measurement' },
  { label: '里程碑', type: 'milestone' },
]

export default function HomePage() {
  const ready = useProtectedPage()
  const state = useBabyState()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [recentRecords, setRecentRecords] = useState<GrowthRecord[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string>()
  const babyId = state.current?.id

  const loadRecent = useCallback(() => {
    if (!babyId) { setRecentRecords([]); setRecentError(undefined); return }
    const context = getBabyContext()
    let active = true
    setRecentLoading(true)
    setRecentError(undefined)
    listRecords(babyId, { limit: 3 }).then((page) => {
      const latest = getBabyContext()
      if (!active || latest.babyId !== context.babyId || latest.generation !== context.generation) return
      setRecentRecords(page.data)
    }).catch((cause) => {
      const latest = getBabyContext()
      if (!active || latest.babyId !== context.babyId || latest.generation !== context.generation) return
      if (isResourceAccessError(cause)) setRecentRecords([])
      setRecentError(cause instanceof Error ? cause.message : '最近记录加载失败')
      void refreshBabiesAfterAccessError(cause, babyId)
    }).finally(() => { if (active) setRecentLoading(false) })
    return () => { active = false }
  }, [babyId])

  useEffect(() => loadRecent(), [loadRecent])
  useDidShow(() => { loadRecent() })

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
      {quickRecordTypes.map((item) => <Button key={item.type} onClick={() => void platform.navigateTo(`/pages/records/edit?type=${item.type}&babyId=${baby.id}&source=home`)}>{item.label}</Button>)}
    </View></View> : null}
    <View className="home-section"><Text className="section-title">最近记录</Text>
      <View className="home-recent-content">
        {recentLoading
          ? <PageState kind="loading" title="正在读取最近记录" />
          : recentError
            ? <PageState kind="error" title="最近记录加载失败" description={recentError} actionLabel="前往时间轴重试" onAction={() => void platform.switchTab('/pages/timeline/index')} />
            : recentRecords.length > 0
              ? <View className="home-recent-list">
                {recentRecords.map((record) => <RecordCard key={record.id} record={record} onClick={() => void platform.navigateTo(`/pages/records/detail?id=${record.id}`)} />)}
                <Button className="link-button" onClick={() => void platform.switchTab('/pages/timeline/index')}>查看全部记录</Button>
              </View>
              : <View className="surface-card first-record"><Text className="first-record__title">记录宝宝的第一个成长瞬间</Text>
                <Text className="first-record__description">这里会展示最近的家庭成长记录。</Text>
                {canEdit ? <Button className="secondary-button" onClick={() => void platform.navigateTo(`/pages/records/edit?babyId=${baby.id}&source=home`)}>添加第一条记录</Button> : null}
              </View>}
      </View>
    </View>
    {switcherOpen ? <View className="switcher-overlay" onClick={() => setSwitcherOpen(false)}><View className="switcher-panel" onClick={(event) => event.stopPropagation()}>
      <Text className="switcher-panel__title">切换宝宝</Text>
      {state.babies.map((item) => <View className={`switcher-item${item.id === baby.id ? ' is-current' : ''}`} key={item.id}
        onClick={() => void selectBaby(item.id).then(() => setSwitcherOpen(false))}>
        {item.avatarUrl
          ? <Image className="switcher-item__avatar" src={item.avatarUrl} mode="aspectFill" lazyLoad />
          : <View className="switcher-item__avatar switcher-item__avatar--fallback">宝</View>}
        <View className="switcher-item__body"><Text className="switcher-item__name">{item.name}</Text><Text className="switcher-item__role">{roleLabels[item.role]}</Text></View>
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
