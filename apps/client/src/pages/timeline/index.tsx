import { Button, Text, View } from '@tarojs/components'
import { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PageState } from '../../components/PageState'
import { useProtectedPage } from '../../features/auth/use-protected-page'
import { BabySwitcher } from '../../features/babies/BabySwitcher'
import { getBabyContext, loadBabies, useBabyState } from '../../features/babies/store'
import { listRecords } from '../../features/records/api'
import { RecordCard } from '../../features/records/RecordCard'
import type { GrowthRecord, RecordType } from '../../features/records/types'
import { platform } from '../../platform'
import { isResourceAccessError } from '../../services/api-error'

import './index.scss'

const filters: Array<{ label: string; value?: RecordType }> = [
  { label: '全部' }, { label: '图文', value: 'note' }, { label: '测量', value: 'measurement' }, { label: '里程碑', value: 'milestone' },
]

export default function TimelinePage() {
  const ready = useProtectedPage()
  const babyState = useBabyState()
  const baby = babyState.current
  const [filter, setFilter] = useState<RecordType>()
  const [records, setRecords] = useState<GrowthRecord[]>([])
  const [recordsScope, setRecordsScope] = useState<string>()
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const generation = useRef(0)
  const scope = baby?.id ? `${baby.id}:${filter ?? 'all'}` : undefined

  const refresh = useCallback(async () => {
    if (!baby?.id) return
    const requestGeneration = ++generation.current
    const babyContext = getBabyContext()
    const requestScope = `${baby.id}:${filter ?? 'all'}`
    setRecordsScope(requestScope)
    setRecords([])
    setCursor(null)
    setLoading(true)
    setLoadingMore(false)
    setError(undefined)
    try {
      const page = await listRecords(baby.id, { type: filter, limit: 20 })
      const latestContext = getBabyContext()
      if (requestGeneration !== generation.current || latestContext.babyId !== babyContext.babyId || latestContext.generation !== babyContext.generation) return
      setRecords(page.data)
      setCursor(page.meta.nextCursor)
    } catch (cause) {
      if (requestGeneration === generation.current) {
        if (isResourceAccessError(cause)) {
          setRecords([])
          setCursor(null)
          void loadBabies().catch(() => undefined)
        }
        setError(cause instanceof Error ? cause.message : '时间轴加载失败')
      }
    } finally {
      if (requestGeneration === generation.current) setLoading(false)
    }
  }, [baby?.id, filter])

  const loadMore = useCallback(async () => {
    if (!baby?.id || recordsScope !== scope || !cursor || loading || loadingMore) return
    const requestGeneration = generation.current
    const babyContext = getBabyContext()
    setLoadingMore(true)
    try {
      const page = await listRecords(baby.id, { type: filter, cursor, limit: 20 })
      const latestContext = getBabyContext()
      if (requestGeneration !== generation.current || latestContext.babyId !== babyContext.babyId || latestContext.generation !== babyContext.generation) return
      setRecords((current) => {
        const ids = new Set(current.map((record) => record.id))
        return [...current, ...page.data.filter((record) => !ids.has(record.id))]
      })
      setCursor(page.meta.nextCursor)
      setError(undefined)
    } catch (cause) {
      if (requestGeneration === generation.current) {
        if (isResourceAccessError(cause)) {
          setRecords([])
          setCursor(null)
          void loadBabies().catch(() => undefined)
        }
        setError(cause instanceof Error ? cause.message : '加载更多失败，请重试')
      }
    } finally {
      if (requestGeneration === generation.current) setLoadingMore(false)
    }
  }, [baby?.id, cursor, filter, loading, loadingMore, recordsScope, scope])

  useEffect(() => { setRecords([]); setCursor(null); void refresh() }, [refresh])
  useDidShow(() => { void refresh() })
  usePullDownRefresh(() => void refresh().finally(() => platform.stopPullDownRefresh()))
  useReachBottom(() => { void loadMore() })

  const chooseFilter = (next?: RecordType) => {
    setFilter(next)
    void platform.scrollToTop()
  }

  if (!ready || babyState.status === 'idle' || babyState.status === 'loading') return <View className="page-shell"><PageState kind="loading" title="正在准备时间轴" /></View>
  if (babyState.status === 'error') return <View className="page-shell"><PageState kind="error" description={babyState.error} actionLabel="重新加载" onAction={() => void loadBabies()} /></View>
  if (!baby) return <View className="page-shell"><PageState kind="empty" title="先创建宝宝档案" description="有了宝宝档案，成长记录才有温暖的归处。" actionLabel="创建宝宝" onAction={() => void platform.navigateTo('/pages/babies/create')} /></View>

  const scopedRecords = recordsScope === scope ? records : []
  const scopedCursor = recordsScope === scope ? cursor : null
  const scopedError = recordsScope === scope ? error : undefined
  const scopedLoading = recordsScope === scope ? loading : true
  const scopedLoadingMore = recordsScope === scope ? loadingMore : false

  return <View className="page-shell timeline-page">
    <View className="timeline-baby" onClick={() => setSwitcherOpen(true)}><View><Text className="timeline-baby__label">当前宝宝</Text><Text className="timeline-baby__name">{baby.name}的成长时间轴</Text></View><Text>⌄</Text></View>
    <View className="timeline-filters">{filters.map((item) => <Button key={item.label} className={`timeline-filter${filter === item.value ? ' is-active' : ''}`} onClick={() => chooseFilter(item.value)}>{item.label}</Button>)}</View>

    {scopedLoading && scopedRecords.length === 0 ? <PageState kind="loading" title="正在翻阅成长片段" /> : null}
    {!scopedLoading && scopedError && scopedRecords.length === 0 ? <PageState kind="error" title="时间轴加载失败" description={scopedError} actionLabel="重新加载" onAction={() => void refresh()} /> : null}
    {!scopedLoading && !scopedError && scopedRecords.length === 0 ? <PageState kind="empty" title={filter ? '没有这类成长记录' : '还没有成长记录'} description="记录宝宝的第一个成长瞬间吧。" actionLabel={baby.role === 'viewer' ? undefined : '添加记录'} onAction={baby.role === 'viewer' ? undefined : () => void platform.navigateTo(`/pages/records/edit?babyId=${baby.id}&source=timeline`)} /> : null}
    {scopedRecords.map((record) => <RecordCard key={record.id} record={record} onClick={() => void platform.navigateTo(`/pages/records/detail?id=${record.id}`)} />)}
    {scopedError && scopedRecords.length > 0 ? <View className="timeline-inline-error"><Text>{scopedError}</Text><Button size="mini" onClick={() => void loadMore()}>重新加载</Button></View> : null}
    {scopedLoadingMore ? <Text className="timeline-footer">正在加载更多…</Text> : null}
    {!scopedCursor && scopedRecords.length > 0 ? <Text className="timeline-footer">已经看完了</Text> : null}
    {baby.role !== 'viewer' ? <Button className="timeline-add" onClick={() => void platform.navigateTo(`/pages/records/edit?babyId=${baby.id}&source=timeline`)}>＋</Button> : null}

    <BabySwitcher open={switcherOpen} currentId={baby.id} onClose={() => setSwitcherOpen(false)} />
  </View>
}
